/**
 * Schema for Cloudflare D1 session persistence: the explicit physical-layout
 * version stamp, the schema-ensure sequence, and durable row decode/encode.
 * Deliberately simpler than the SQLite backend's physical layout — one row
 * per event (no chunk-packing, no zstd compression) — since D1's REST access
 * pattern does not share the local-disk row-count incentive that packing
 * optimizes for; see the package README's Known Limitations.
 * @module @deepseek-ai/dsh-session-persistence-d1/schema
 */

import type { SessionEvent, SessionHeader, SurfaceEventType } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { D1Client } from '@deepseek-ai/dsh-d1-client'

/**
 * The on-disk physical layout version, stored in the single-row
 * `d1_session_schema_version` table. Independent from
 * `SESSION_PERSISTENCE_SQLITE`'s `SCHEMA_VERSION`: the two backends store the
 * same logical data in independent physical formats with independent
 * migration lifecycles. Bumped only on a breaking change to the table layout;
 * any other stamped version rejects — this unreleased format has no migrations.
 */
export const D1_SESSION_SCHEMA_VERSION = 1

/** A materialized session's metadata and monotonic revision counter. */
export interface SessionRow {
  readonly id: string
  readonly version: number
  readonly created_at: number
  readonly cwd: string | null
  readonly parent_session: string | null
  readonly seed_length: number | null
  readonly origin: 'subagent' | null
  readonly delegation_depth: number | null
  readonly agent_preset: string | null
  readonly incarnation: string
  readonly revision: number
}

/** One physical event row; unlike the SQLite backend, always exactly one logical event. */
export interface EventRow {
  readonly seq: number
  readonly type: string
  readonly time: number
  readonly data: string
  readonly source_event_seqs: string | null
  readonly surface_op: string | null
}

/**
 * Ensure the shared metadata tables exist and the physical layout version
 * matches. Runs once per backend instance (memoized by the caller).
 * @param client - Client bound to the target D1 database.
 * @returns resolution once the metadata tables exist and the version is confirmed compatible.
 */
export async function ensureSchema(client: D1Client): Promise<void> {
  await client.batch([
    { sql: 'CREATE TABLE IF NOT EXISTS d1_session_schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)' },
    {
      sql: `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        cwd TEXT,
        parent_session TEXT,
        seed_length INTEGER,
        origin TEXT,
        delegation_depth INTEGER,
        agent_preset TEXT,
        incarnation TEXT NOT NULL,
        revision INTEGER NOT NULL
      )`,
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS events (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        time INTEGER NOT NULL,
        data TEXT NOT NULL,
        source_event_seqs TEXT,
        surface_op TEXT,
        PRIMARY KEY (session_id, seq)
      )`,
    },
  ])
  const result = await client.query('SELECT version FROM d1_session_schema_version WHERE id = 1')
  const row = result.results[0] as { version: number } | undefined
  if (row === undefined) {
    await client.query('INSERT INTO d1_session_schema_version (id, version) VALUES (1, ?)', [D1_SESSION_SCHEMA_VERSION])
  } else if (row.version !== D1_SESSION_SCHEMA_VERSION) {
    throw new Error(
      `session D1 database schema is stamped version ${row.version}, incompatible with this build (${D1_SESSION_SCHEMA_VERSION})`,
    )
  }
}

/**
 * Reconstruct an immutable session header from a validated metadata row.
 * @param row - stored metadata row.
 * @returns the session header.
 */
export function rowToMeta(row: SessionRow): SessionHeader {
  return {
    version: row.version,
    id: SessionId(row.id),
    createdAt: row.created_at,
    ...row.cwd === null ? {} : { cwd: row.cwd },
    ...row.parent_session === null ? {} : { parentSession: SessionId(row.parent_session) },
    ...row.seed_length === null ? {} : { seedLength: row.seed_length },
    ...row.origin === null ? {} : { origin: row.origin },
    ...row.delegation_depth === null ? {} : { delegationDepth: row.delegation_depth },
    ...row.agent_preset === null ? {} : { agentPreset: row.agent_preset },
  }
}

/**
 * Decode one physical event row. Parse failures propagate to the caller,
 * which treats them as the start of a torn physical tail.
 * @param row - stored event row.
 * @returns the logical event.
 */
export function decodeEventRow(row: EventRow): SessionEvent {
  return {
    type: row.type,
    seq: row.seq,
    time: row.time,
    data: JSON.parse(row.data) as SessionEvent['data'],
    ...row.source_event_seqs === null ? {} : { sourceEventSeqs: JSON.parse(row.source_event_seqs) as number[] },
    ...row.surface_op === null ? {} : { surfaceOp: JSON.parse(row.surface_op) as SessionEvent<SurfaceEventType>['surfaceOp'] },
  } as SessionEvent
}

/**
 * Build the insert statement for one event row. Callers only ever receive
 * events already validated as losslessly JSON-serializable by
 * `PersistenceCoordinator`, so `JSON.stringify` here cannot throw.
 * @param id - owning session id.
 * @param event - the event to persist.
 * @returns the parameterized insert statement.
 */
export function insertEventStatement(id: SessionId, event: SessionEvent): { sql: string; params: readonly unknown[] } {
  const surface = event as SessionEvent<SurfaceEventType>
  return {
    sql: 'INSERT INTO events (session_id, seq, type, time, data, source_event_seqs, surface_op) VALUES (?, ?, ?, ?, ?, ?, ?)',
    params: [
      id,
      event.seq,
      event.type,
      event.time,
      JSON.stringify(event.data),
      surface.sourceEventSeqs === undefined ? null : JSON.stringify(surface.sourceEventSeqs),
      surface.surfaceOp === undefined ? null : JSON.stringify(surface.surfaceOp),
    ],
  }
}

/**
 * Validate and flatten physical event rows into their logical prefix. Unlike
 * the SQLite backend's packed-row scanner, one physical row is always exactly
 * one logical event, so a torn tail is simply the first row that fails to
 * parse or does not continue the expected seq.
 * @param rows - physical rows ordered by seq.
 * @param base - logical seq expected from the first row.
 * @returns the contiguous logical prefix and optional physical truncation point.
 */
export function scanEventRows(rows: readonly EventRow[], base = 0): { preserved: SessionEvent[]; tornFrom?: number } {
  const preserved: SessionEvent[] = []
  let expected = base
  for (const row of rows) {
    let event: SessionEvent | undefined
    try {
      event = decodeEventRow(row)
    } catch {
      return { preserved, tornFrom: row.seq }
    }
    if (event.seq !== expected) return { preserved, tornFrom: row.seq }
    preserved.push(event)
    expected += 1
  }
  return { preserved }
}

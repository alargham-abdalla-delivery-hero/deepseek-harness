/**
 * D1 storage primitives: append-batch writes, physical reads, revisions, and
 * repair — the `PersistenceBackend<number>` implementation `D1SessionPersistence`
 * delegates to `PersistenceCoordinator`. All revision tracking, write-behind
 * batching, prepare/inspect orchestration, and crash-repair sequencing live in
 * the coordinator; this store only speaks the physical D1 schema.
 * @module @deepseek-ai/dsh-session-persistence-d1/store
 */

import { randomUUID } from 'node:crypto'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import {
  SessionPersistenceRevision,
  type PersistenceBackend,
  type SessionPersistenceRevision as PersistenceRevision,
  type SessionPersistenceSnapshot,
  type StoredPrefix,
  type StoredSuffix,
} from '@deepseek-ai/dsh-session-persistence'
import { D1Client } from '@deepseek-ai/dsh-d1-client'
import type { D1HttpClient, D1Identity, D1Statement } from '@deepseek-ai/dsh-d1-client'
import { ensureSchema, insertEventStatement, rowToMeta, scanEventRows, type SessionRow, type EventRow } from './schema.ts'

/** D1 implementation of the coordinator's physical backend hooks. */
export class D1Store implements PersistenceBackend<number> {
  readonly name = 'session-persistence-d1'

  private readonly client: D1Client
  private readonly ready: Promise<void>

  /**
   * @param identity - D1 database identity and REST credential.
   * @param httpClient - Injectable HTTP call; defaults to global `fetch` (tests supply a double).
   */
  constructor(private readonly identity: D1Identity, httpClient?: D1HttpClient) {
    this.client = new D1Client(identity, httpClient)
    this.ready = ensureSchema(this.client)
    // Every primitive re-awaits `ready`, so an ensure-schema failure still
    // surfaces to each caller; this guard only prevents an unhandled-rejection
    // crash when the failure precedes the first use.
    this.ready.catch(() => {})
  }

  async loadStored(id: SessionId, signal?: AbortSignal): Promise<StoredPrefix<number> | undefined> {
    await this.observe(signal)
    const row = await this.sessionRow(id)
    if (row === undefined) return undefined
    const eventRows = await this.eventRows(id)
    signal?.throwIfAborted()
    const scanned = scanEventRows(eventRows)
    return {
      meta: rowToMeta(row),
      events: scanned.preserved,
      revision: this.d1Revision(row),
      ...scanned.tornFrom === undefined ? {} : { tornMarker: scanned.tornFrom },
    }
  }

  async readStoredRevision(id: SessionId, signal?: AbortSignal): Promise<PersistenceRevision | undefined> {
    await this.observe(signal)
    const row = await this.sessionRow(id)
    signal?.throwIfAborted()
    return row === undefined ? undefined : this.d1Revision(row)
  }

  async loadStoredFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<StoredSuffix | undefined> {
    await this.observe(signal)
    const row = await this.sessionRow(id)
    if (row === undefined) return undefined
    const eventRows = await this.eventRowsFrom(id, fromSeq)
    signal?.throwIfAborted()
    const scanned = scanEventRows(eventRows, fromSeq)
    return { meta: rowToMeta(row), events: scanned.preserved }
  }

  async appendBatch(meta: SessionHeader, events: readonly SessionEvent[], isMaterialized: boolean): Promise<void> {
    await this.ready
    if (events.length === 0) return
    const statements: D1Statement[] = []
    const first = events[0] as SessionEvent
    if (!isMaterialized) {
      if (first.seq !== 0) {
        throw new Error(`session "${meta.id}" append starts at seq ${first.seq}, stored next seq is 0`)
      }
      statements.push(insertSessionRowStatement(meta))
    } else {
      const currentLast = await this.lastEventSeq(meta.id)
      const expected = currentLast === undefined ? 0 : currentLast + 1
      if (first.seq !== expected) {
        throw new Error(`session "${meta.id}" append starts at seq ${first.seq}, stored next seq is ${expected}`)
      }
    }
    for (const event of events) statements.push(insertEventStatement(meta.id, event))
    statements.push({ sql: 'UPDATE sessions SET revision = revision + 1 WHERE id = ?', params: [meta.id] })
    await this.client.batch(statements)
  }

  async materializeHeader(meta: SessionHeader): Promise<void> {
    await this.ready
    const existing = await this.sessionRow(meta.id)
    if (existing !== undefined) return
    const statement = insertSessionRowStatement(meta)
    await this.client.query(statement.sql, statement.params)
  }

  async commitRepair(meta: SessionHeader, tornMarker: number | undefined, closers: readonly SessionEvent[]): Promise<void> {
    await this.ready
    if (tornMarker === undefined && closers.length === 0) return
    const row = await this.sessionRow(meta.id)
    if (row === undefined) throw new Error(`session "${meta.id}" metadata row is missing`)
    const eventRows = await this.eventRows(meta.id)
    const scanned = scanEventRows(eventRows)
    if (tornMarker !== undefined) {
      if (scanned.tornFrom !== tornMarker) {
        throw new Error(`session "${meta.id}" repair is stale: physical tail no longer starts at seq ${tornMarker}`)
      }
    } else if (scanned.tornFrom !== undefined) {
      throw new Error(`session "${meta.id}" repair omitted current torn tail at seq ${scanned.tornFrom}`)
    }
    const statements: D1Statement[] = []
    if (tornMarker !== undefined) {
      statements.push({ sql: 'DELETE FROM events WHERE session_id = ? AND seq >= ?', params: [meta.id, tornMarker] })
    }
    if (closers.length > 0) {
      const lastPreserved = scanned.preserved.at(-1)
      const expected = lastPreserved === undefined ? 0 : lastPreserved.seq + 1
      if (closers[0]?.seq !== expected) {
        throw new Error(`session "${meta.id}" repair is stale: closer starts at seq ${closers[0]?.seq}, stored next seq is ${expected}`)
      }
      for (const closer of closers) statements.push(insertEventStatement(meta.id, closer))
    }
    statements.push({ sql: 'UPDATE sessions SET revision = revision + 1 WHERE id = ?', params: [meta.id] })
    await this.client.batch(statements)
  }

  async list(signal?: AbortSignal): Promise<SessionHeader[]> {
    await this.observe(signal)
    const result = await this.client.query('SELECT * FROM sessions')
    signal?.throwIfAborted()
    return (result.results as unknown as SessionRow[]).map(rowToMeta)
  }

  /**
   * List every materialized session with its lightweight revision, without
   * loading any event log. Called directly by the glue class's `listSnapshots`.
   * @param signal - optional cancellation for the backend read.
   * @returns one header and revision per materialized session.
   */
  async listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]> {
    await this.observe(signal)
    const result = await this.client.query('SELECT * FROM sessions')
    signal?.throwIfAborted()
    return (result.results as unknown as SessionRow[]).map(row => ({
      header: rowToMeta(row),
      revision: this.d1Revision(row),
    }))
  }

  private async sessionRow(id: SessionId): Promise<SessionRow | undefined> {
    const result = await this.client.query('SELECT * FROM sessions WHERE id = ?', [id])
    return result.results[0] as SessionRow | undefined
  }

  private async eventRows(id: SessionId): Promise<EventRow[]> {
    const result = await this.client.query('SELECT * FROM events WHERE session_id = ? ORDER BY seq', [id])
    return result.results as unknown as EventRow[]
  }

  private async eventRowsFrom(id: SessionId, fromSeq: number): Promise<EventRow[]> {
    const result = await this.client.query('SELECT * FROM events WHERE session_id = ? AND seq >= ? ORDER BY seq', [id, fromSeq])
    return result.results as unknown as EventRow[]
  }

  private async lastEventSeq(id: SessionId): Promise<number | undefined> {
    const result = await this.client.query('SELECT MAX(seq) as max_seq FROM events WHERE session_id = ?', [id])
    const row = result.results[0] as { max_seq: number | null } | undefined
    return row?.max_seq ?? undefined
  }

  private async observe(signal: AbortSignal | undefined): Promise<void> {
    signal?.throwIfAborted()
    await this.ready
    signal?.throwIfAborted()
  }

  /** Revision token: identifies both this database and the session row's own materialization + write count. */
  private d1Revision(row: SessionRow): PersistenceRevision {
    return SessionPersistenceRevision(`d1:${this.identity.databaseId}:incarnation:${row.incarnation}:revision:${row.revision}`)
  }
}

/** Build the insert statement for a session's metadata row, revision 0. */
function insertSessionRowStatement(meta: SessionHeader): D1Statement {
  return {
    sql: `INSERT INTO sessions
      (id, version, created_at, cwd, parent_session, seed_length, origin, delegation_depth, agent_preset, incarnation, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    params: [
      meta.id,
      meta.version,
      meta.createdAt,
      meta.cwd ?? null,
      meta.parentSession ?? null,
      meta.seedLength ?? null,
      meta.origin ?? null,
      meta.delegationDepth ?? null,
      meta.agentPreset ?? null,
      randomUUID(),
    ],
  }
}

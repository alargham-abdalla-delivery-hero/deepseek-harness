/**
 * Cloudflare D1 durable session persistence, reached over D1's REST query API
 * (`fetch`, no Workers binding required) so this backend runs from any Node
 * process — including one hosted inside a Cloudflare Container. All revision
 * tracking, write-behind batching, prepare/inspect orchestration, and
 * crash-repair sequencing come from `PersistenceCoordinator`; this package
 * only implements the physical D1 read/write primitives it delegates to.
 * @module @deepseek-ai/dsh-session-persistence-d1
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  Session,
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionPreparation,
} from '@deepseek-ai/dsh-session'
import {
  DEFAULT_PREPARED_SESSION_CACHE_SIZE,
  DEFAULT_WRITE_BATCH_MAX_DELAY_MS,
  MAX_WRITE_BATCH_DELAY_MS,
  type BorrowedSessionSource,
  PersistenceCoordinator,
  SessionPersistence,
  type SessionInspection,
  type SessionLocation,
  type SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import { D1Store } from './store.ts'

export { D1_SESSION_SCHEMA_VERSION } from './schema.ts'

/** Plugin configuration: the D1 database identity, its REST credential, and coordinator tuning. */
export interface Config {
  /** Cloudflare account id owning the D1 database. */
  accountId: string
  /** D1 database id (from `wrangler d1 create`'s output — not the human-readable database name). */
  databaseId: string
  /**
   * Cloudflare API token authorizing D1 REST access (requires D1 Edit
   * permission on the account). Source this from an environment variable at
   * the cordis.yml layer (for example `!!js process.env.CLOUDFLARE_D1_API_TOKEN`)
   * — never commit a literal token.
   */
  apiToken: string
  /** Maximum cold Session preparations retained for history-to-resume reuse. */
  preparedSessionCacheSize?: number
  /** Fixed live-event coalescing window; not a backend completion deadline. */
  writeBatchMaxDelayMs?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  accountId: z.string().required(),
  databaseId: z.string().required(),
  apiToken: z.string().required(),
  preparedSessionCacheSize: z.number().step(1).min(1).default(DEFAULT_PREPARED_SESSION_CACHE_SIZE),
  writeBatchMaxDelayMs: z.number().step(1).min(1).max(MAX_WRITE_BATCH_DELAY_MS)
    .default(DEFAULT_WRITE_BATCH_MAX_DELAY_MS),
})

/**
 * D1 `SessionPersistence` provider: a thin glue layer delegating every
 * service method to one `PersistenceCoordinator` bound to a `D1Store`.
 */
export class D1SessionPersistence extends SessionPersistence {
  override readonly supportsRawArtifacts = false
  override readonly name = 'session-persistence-d1'

  static inject = ['sessions']

  private readonly store: D1Store
  private readonly coordinator: PersistenceCoordinator<number>

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    const preparedSessionCacheSize = config.preparedSessionCacheSize
      ?? DEFAULT_PREPARED_SESSION_CACHE_SIZE
    const writeBatchMaxDelayMs = config.writeBatchMaxDelayMs
      ?? DEFAULT_WRITE_BATCH_MAX_DELAY_MS
    this.store = new D1Store(config)
    this.coordinator = new PersistenceCoordinator(this.ctx, this.store, {
      preparedSessionCacheSize,
      writeBatchMaxDelayMs,
    })
  }

  /** D1 has one shared database, not an independent per-session artifact. */
  locate(_meta: SessionHeader): SessionLocation | undefined {
    return undefined
  }

  create(meta: SessionHeader): Promise<void> {
    return this.coordinator.create(meta)
  }

  override ensureMaterialized(session: Session): Promise<void> {
    return this.coordinator.ensureMaterialized(session)
  }

  append(id: SessionId, events: readonly SessionEvent[]): Promise<void> {
    return this.coordinator.append(id, events)
  }

  override prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation> {
    return this.coordinator.prepare(id, signal)
  }

  load(id: SessionId): Promise<SessionInspection> {
    return this.coordinator.load(id)
  }

  inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection> {
    return this.coordinator.inspect(id, signal)
  }

  override borrowSession(id: SessionId, signal?: AbortSignal): Promise<BorrowedSessionSource> {
    return this.coordinator.borrowSession(id, signal)
  }

  readFrom(
    id: SessionId,
    fromSeq: number,
    signal?: AbortSignal,
  ): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    return this.coordinator.readFrom(id, fromSeq, signal)
  }

  list(signal?: AbortSignal): Promise<SessionHeader[]> {
    return this.store.list(signal)
  }

  listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]> {
    return this.store.listSnapshots(signal)
  }
}

export default D1SessionPersistence

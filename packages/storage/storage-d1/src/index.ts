/**
 * Cloudflare D1 storage backend for the storage hub: one D1 database hosts
 * every routed unit, document-per-row (`key TEXT` / `value TEXT` JSON),
 * reached over D1's REST query API (`fetch`, no Workers binding required) so
 * this backend runs from any Node process — including one hosted inside a
 * Cloudflare Container. Registers as backend `d1`; the disposer unregisters
 * first, then closes the backend. There is no medium connection to release:
 * every call is a stateless HTTP request.
 * @module @deepseek-ai/dsh-storage-d1
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { D1Client } from '@deepseek-ai/dsh-d1-client'
import type { D1HttpClient } from '@deepseek-ai/dsh-d1-client'
import { StorageError, UNIT_NAME_RE, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'
import { ensureSchema, recordTableName } from './schema.ts'
import { D1KvUnit } from './unit.ts'

export { D1_SCHEMA_VERSION } from './schema.ts'
export { D1Client } from '@deepseek-ai/dsh-d1-client'
export type { D1HttpClient, D1Identity, D1QueryResult, D1Statement } from '@deepseek-ai/dsh-d1-client'

/** Cordis plugin name. */
export const name = 'storage-d1'
/** The backend registers on the storage hub. */
export const inject = ['storage']

/** Plugin configuration: the D1 database identity and the REST API credential that reaches it. */
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
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  accountId: z.string().required(),
  databaseId: z.string().required(),
  apiToken: z.string().required(),
})

/**
 * The D1 {@link StorageBackend}. Owns one {@link D1Client} bound to the
 * configured database; `kv.open` validates names, enforces the per-unit
 * version stamp in `units`, and ensures the unit's record tables — all over
 * D1's REST query API.
 */
export class D1StorageBackend implements StorageBackend {
  /** The key-value facet; the only shape this backend serves. */
  readonly kv: KvFacet = { open: descriptor => this.openUnit(descriptor) }

  private readonly client: D1Client
  private readonly ready: Promise<void>
  /** Open (or still-opening) units by name; presence is the double-open guard. */
  private readonly units = new Map<string, Promise<D1KvUnit>>()
  private closing: Promise<void> | undefined

  /**
   * @param config - Validated plugin configuration.
   * @param httpClient - Injectable HTTP call; defaults to global `fetch` (tests supply a double).
   */
  constructor(config: Config, httpClient?: D1HttpClient) {
    this.client = new D1Client(config, httpClient)
    this.ready = ensureSchema(this.client)
    // Every primitive re-awaits `ready`, so an ensure-schema failure still
    // surfaces to each caller; this guard only prevents an unhandled-rejection
    // crash when the failure precedes the first use.
    this.ready.catch(() => {})
  }

  private openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    if (this.closing !== undefined) {
      return Promise.reject(new StorageError('closed', 'd1 storage backend is closed'))
    }
    if (!UNIT_NAME_RE.test(descriptor.name)) {
      return Promise.reject(new Error(`kv unit name '${descriptor.name}' violates ${UNIT_NAME_RE}`))
    }
    for (const table of descriptor.tables) {
      if (!UNIT_NAME_RE.test(table)) {
        return Promise.reject(new Error(`kv table name '${table}' in unit '${descriptor.name}' violates ${UNIT_NAME_RE}`))
      }
    }
    if (this.units.has(descriptor.name)) {
      return Promise.reject(new Error(`kv unit '${descriptor.name}' is already open (double-open is a caller bug)`))
    }
    // Reserve the name synchronously so a concurrent second open of the same
    // name rejects instead of racing past the guard during the awaits below.
    const pending = this.materializeUnit(descriptor)
    this.units.set(descriptor.name, pending)
    pending.catch(() => this.units.delete(descriptor.name))
    return pending
  }

  private async materializeUnit(descriptor: KvUnitDescriptor): Promise<D1KvUnit> {
    await this.ready
    const result = await this.client.query('SELECT version FROM units WHERE name = ?', [descriptor.name])
    const row = result.results[0] as { version: number } | undefined
    if (row === undefined) {
      await this.client.query('INSERT INTO units (name, version) VALUES (?, ?)', [descriptor.name, descriptor.version])
    } else if (row.version !== descriptor.version) {
      throw new StorageError(
        'version-mismatch',
        `kv unit '${descriptor.name}' is stamped version ${row.version} on the medium, incompatible with descriptor version ${descriptor.version}`,
      )
    }
    if (descriptor.tables.length > 0) {
      await this.client.batch(descriptor.tables.map(table => ({
        sql: `CREATE TABLE IF NOT EXISTS "${recordTableName(descriptor.name, table)}" (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      })))
    }
    return new D1KvUnit(this.client, descriptor, () => {
      this.units.delete(descriptor.name)
    })
  }

  /**
   * Close every open unit. Idempotent; concurrent and repeated calls resolve
   * once teardown finishes.
   * @returns resolution after every open unit is released.
   */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    for (const pending of [...this.units.values()]) {
      const unit = await pending.catch(() => undefined)
      await unit?.close()
    }
  }
}

/**
 * Register the D1 backend as `d1` on the storage hub. The disposer
 * unregisters the name first, then closes the backend.
 * @param ctx - Plugin context (must inject `storage`).
 * @param config - Validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const backend = new D1StorageBackend(config)
  ctx.effect(() => {
    const dispose = ctx.storage.backend.register('d1', backend)
    return async () => {
      dispose()
      await backend.close()
    }
  }, 'storage-d1.registerBackend')
  ctx.provide(storageBackendServiceKey('d1'), backend)
}

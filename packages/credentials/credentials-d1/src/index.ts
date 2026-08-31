/**
 * Cloudflare D1 credentials provider: durable `CredentialRef`/`CredentialKey`
 * storage reached over D1's REST query API (`fetch`, no Workers binding
 * required), so this provider runs from any Node process — including one
 * hosted inside a Cloudflare Container. Unlike `dsh-credentials-local`'s
 * layered file/`.env`/inherited-environment stack, this deployment has one
 * durable, writable source: D1 is the sole source `set`/`unset`/`modifyRecord`
 * write to, so a write here never risks being shadowed by a higher-ranked
 * layer the way an inherited-environment value shadows a
 * `dsh-credentials-local` file write. The only other source this provider
 * reads at all is `process.env`, and only as a read-only fallback below D1
 * (see {@link D1CredentialProvider.resolve}).
 * @module @deepseek-ai/dsh-credentials-d1
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { D1Client } from '@deepseek-ai/dsh-d1-client'
import type { D1HttpClient } from '@deepseek-ai/dsh-d1-client'
import { CredentialProvider, isCredentialRefName, parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { ensureSchema } from './schema.ts'

export { D1_CREDENTIALS_SCHEMA_VERSION } from './schema.ts'
export { D1Client } from '@deepseek-ai/dsh-d1-client'
export type { D1HttpClient, D1Identity, D1QueryResult, D1Statement } from '@deepseek-ai/dsh-d1-client'

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

/**
 * Cloudflare D1 `CredentialProvider`. Every operation is one or two HTTP
 * round trips to D1's REST API; there is no local file, watcher, or
 * cross-process writer lock to manage, unlike `dsh-credentials-local` — this
 * provider is a thin translation of the abstract seam onto two D1 tables.
 */
export class D1CredentialProvider extends CredentialProvider {
  static Config: z<Config> = z.object({
    accountId: z.string().required(),
    databaseId: z.string().required(),
    apiToken: z.string().required(),
  })

  private readonly client: D1Client
  private readonly ready: Promise<void>

  /**
   * @param ctx - Cordis plugin context.
   * @param config - Validated plugin configuration.
   * @param httpClient - Injectable HTTP call; defaults to global `fetch` (tests supply a double).
   */
  constructor(ctx: Context, public config: Config, httpClient?: D1HttpClient) {
    super(ctx)
    this.client = new D1Client(config, httpClient)
    this.ready = ensureSchema(this.client)
    // Every primitive re-awaits `ready`, so an ensure-schema failure still
    // surfaces to each caller; this guard only prevents an unhandled-rejection
    // crash when the failure precedes the first use.
    this.ready.catch(() => {})
  }

  /**
   * Resolve one reference: a stored D1 row wins when present, otherwise
   * `process.env[ref]` is a read-only bootstrap fallback.
   *
   * Design decision: this deployment has no file or `.env` stack to layer the
   * way `dsh-credentials-local` does, but the container's own `process.env`
   * still carries deployment secrets forwarded once at container boot (for
   * example `DEEPSEEK_API_KEY` — see
   * `packages/cloudflare/cloudflare-worker/src/host-container.ts`'s `Env`).
   * D1 is checked *before* `process.env` — the reverse of
   * `dsh-credentials-local`'s "inherited environment wins" rule — because
   * here the roles are reversed: the env value is a fixed deploy-time
   * default nothing in this process can edit afterward, while D1 is the
   * Settings-UI-writable store, and a value a deployer sets through that UI
   * must take effect immediately, the same way a `dsh-credentials-local`
   * write to its managed file immediately becomes the effective value. This
   * keeps `process.env` useful as a zero-setup bootstrap path before anyone
   * opens the Models Settings UI, while guaranteeing that the first D1 write
   * for a reference permanently wins from then on — consistent with "D1 is
   * the sole writable source" above: nothing ranks over D1, so nothing can
   * shadow a write into apparent no-effect the way `dsh-credentials-local`
   * must guard against.
   * @param ref - the reference to resolve.
   * @returns the value and its source, or `undefined` while unconfigured.
   */
  override async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    await this.ready
    const stored = await this.readRef(ref)
    if (stored !== undefined) return { value: stored, source: 'd1' }
    const envValue = process.env[ref]
    if (envValue !== undefined && envValue.length > 0) return { value: envValue, source: 'env' }
    return undefined
  }

  override async describe(ref: CredentialRef): Promise<CredentialInfo> {
    await this.ready
    const stored = await this.readRef(ref)
    if (stored !== undefined) return { configured: true, source: 'd1', writable: true }
    const envValue = process.env[ref]
    // Writable even while currently sourced from env: D1 ranks above it, so a
    // set() here would immediately become the effective value, unlike
    // dsh-credentials-local's inherited-environment case where a write could
    // never take effect.
    if (envValue !== undefined && envValue.length > 0) return { configured: true, source: 'env', writable: true }
    return { configured: false, writable: true }
  }

  override async set(ref: CredentialRef, value: string): Promise<void> {
    if (value.length === 0) {
      throw new Error(`credentials-d1: an empty value cannot be stored for "${ref}"; use unset`)
    }
    await this.ready
    await this.client.query(
      'INSERT INTO credential_refs (ref, value) VALUES (?, ?) ON CONFLICT(ref) DO UPDATE SET value = excluded.value',
      [ref, value],
    )
    this.notifyUpdated(ref)
  }

  override async unset(ref: CredentialRef): Promise<void> {
    await this.ready
    const result = await this.client.query('DELETE FROM credential_refs WHERE ref = ?', [ref])
    // D1 always returns meta.changes for a write; the `?? 0` only satisfies
    // D1QueryResult's optional type, which exists for the read (SELECT) case.
    /* v8 ignore next */
    if ((result.meta.changes ?? 0) === 0) return
    this.notifyUpdated(ref)
  }

  override async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    await this.ready
    return this.readRecordRaw(key)
  }

  override async describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    await this.ready
    const stored = await this.readRecordRaw(key)
    // Presence is the whole fact here: no layer ranks above this table for a
    // record, so nothing can shadow one.
    if (stored === undefined) return { configured: false, writable: true }
    return { configured: true, kind: stored.kind, writable: true }
  }

  override async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    await this.ready
    const result = await this.client.query('SELECT key, value FROM credential_records')
    return result.results.map((row) => {
      const typed = row as { key: string; value: string }
      // Every stored key was admitted through modifyRecord's own write path,
      // which only ever persists a key parseCredentialKey already accepted.
      const key = parseCredentialKey(typed.key)
      const record = JSON.parse(typed.value) as CredentialRecord
      return { key, kind: record.kind }
    })
  }

  override async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    await this.ready
    // Read-modify-write over two independent HTTP round trips: D1's REST API
    // has no primitive for a cross-call transaction, so this sequence is
    // last-write-wins under concurrent callers rather than serialized —
    // documented in the README's Known Limitations, the same accepted
    // trade-off dsh-session-persistence-d1 documents for its own
    // read-then-batch-write sequence and for the same underlying reason.
    const current = await this.readRecordRaw(key)
    const next = await mutate(current)
    if (next === undefined) return current
    // Admitted before it is persisted: what the read path could not admit is
    // refused here first, so a caller can never persist a record a later
    // read would reject.
    assertStorableRecord(key, next)
    await this.client.query(
      'INSERT INTO credential_records (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(next)],
    )
    this.notifyRecordUpdated(key)
    return next
  }

  override async deleteRecord(key: CredentialKey): Promise<void> {
    await this.ready
    const result = await this.client.query('DELETE FROM credential_records WHERE key = ?', [key])
    // D1 always returns meta.changes for a write; the `?? 0` only satisfies
    // D1QueryResult's optional type, which exists for the read (SELECT) case.
    /* v8 ignore next */
    if ((result.meta.changes ?? 0) === 0) return
    this.notifyRecordUpdated(key)
  }

  private async readRef(ref: CredentialRef): Promise<string | undefined> {
    const result = await this.client.query('SELECT value FROM credential_refs WHERE ref = ?', [ref])
    const row = result.results[0] as { value: string } | undefined
    return row?.value
  }

  private async readRecordRaw(key: CredentialKey): Promise<CredentialRecord | undefined> {
    const result = await this.client.query('SELECT value FROM credential_records WHERE key = ?', [key])
    const row = result.results[0] as { value: string } | undefined
    return row === undefined ? undefined : JSON.parse(row.value) as CredentialRecord
  }
}

/** Reject a record this provider could not later admit on read, before it is persisted. */
function assertStorableRecord(key: CredentialKey, record: CredentialRecord): void {
  switch (record.kind) {
    case 'api-key':
      assertStorableApiKey(key, record.key, record.env)
      return
    case 'grant':
      assertJsonValue(`record "${key}" payload`, record.payload, new Set())
      return
    default:
      assertNever(record)
  }
}

/** Reject an api-key record the read path could not admit: an empty key or an empty/invalid env entry. */
function assertStorableApiKey(key: CredentialKey, apiKey: string | undefined, env: Readonly<Record<string, string>> | undefined): void {
  if (apiKey !== undefined && apiKey.length === 0) {
    throw new TypeError(`credentials-d1: record "${key}" has an empty key; omit the field instead`)
  }
  for (const [name, value] of Object.entries(env ?? {})) {
    if (!isCredentialRefName(name)) {
      throw new TypeError(`credentials-d1: record "${key}" env name "${name}" is not a valid credential ref`)
    }
    if (value.length === 0) {
      throw new TypeError(`credentials-d1: record "${key}" env "${name}" must be a non-empty string`)
    }
  }
}

/**
 * Reject a grant payload that cannot survive a JSON round trip: D1 stores the
 * record as JSON text, so a value `JSON.stringify` would silently coerce
 * (`Infinity`/`NaN` to `null`) or throw on (a `bigint`, a cyclic reference)
 * must be caught here instead, before the write.
 * @param where - the subject named in a diagnostic.
 * @param value - the payload or nested value to admit.
 * @param seen - objects on the current path, for cycle detection.
 */
function assertJsonValue(where: string, value: unknown, seen: Set<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw new TypeError(`credentials-d1: ${where} holds a non-finite number`)
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new TypeError(`credentials-d1: ${where} is cyclic`)
    if (Object.getPrototypeOf(value) === Object.prototype || Array.isArray(value)) {
      seen.add(value)
      for (const nested of Object.values(value)) assertJsonValue(where, nested, seen)
      seen.delete(value)
      return
    }
  }
  throw new TypeError(`credentials-d1: ${where} holds a value JSON cannot represent`)
}

function assertNever(value: never): never {
  throw new Error(`credentials-d1: unknown record kind ${JSON.stringify(value)}`)
}

export default D1CredentialProvider

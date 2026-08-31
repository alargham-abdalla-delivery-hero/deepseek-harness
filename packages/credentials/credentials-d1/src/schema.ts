/**
 * Schema for the Cloudflare D1 credentials provider: the physical layout
 * version stamp and the schema-ensure sequence. Two fixed tables hold this
 * seam's two disjoint key spaces (`CredentialRef` / `CredentialKey`; see
 * `@deepseek-ai/dsh-credentials`'s JSDoc): `credential_refs` and
 * `credential_records`. Unlike `dsh-storage-d1`'s per-unit
 * `u_<unit>_<table>` tables, this provider is not a `ctx.storageDomain`
 * backend and owns a fixed, small schema directly — the same choice
 * `dsh-session-persistence-d1` makes for its own `sessions`/`events` tables
 * rather than routing through `recordTableName`'s KV-unit convention.
 * @module @deepseek-ai/dsh-credentials-d1/schema
 */

import type { D1Client } from '@deepseek-ai/dsh-d1-client'

/**
 * The on-disk physical layout version, stored in the single-row
 * `d1_credentials_schema_version` table. Independent from `D1_SCHEMA_VERSION`
 * (`dsh-storage-d1`) and `D1_SESSION_SCHEMA_VERSION`
 * (`dsh-session-persistence-d1`): three independent D1-backed providers, three
 * independent physical formats with independent migration lifecycles. Any
 * other stamped version rejects rather than migrates (pre-release stance).
 */
export const D1_CREDENTIALS_SCHEMA_VERSION = 1

/**
 * Ensure the credentials tables exist and the physical layout version
 * matches. Runs once per provider instance (memoized by the caller); every
 * operation awaits this first.
 * @param client - Client bound to the target D1 database.
 * @returns resolution once the tables exist and the version is confirmed compatible.
 */
export async function ensureSchema(client: D1Client): Promise<void> {
  await client.batch([
    {
      sql: 'CREATE TABLE IF NOT EXISTS d1_credentials_schema_version'
        + ' (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)',
    },
    { sql: 'CREATE TABLE IF NOT EXISTS credential_refs (ref TEXT PRIMARY KEY, value TEXT NOT NULL)' },
    { sql: 'CREATE TABLE IF NOT EXISTS credential_records (key TEXT PRIMARY KEY, value TEXT NOT NULL)' },
  ])
  const result = await client.query('SELECT version FROM d1_credentials_schema_version WHERE id = 1')
  const row = result.results[0] as { version: number } | undefined
  if (row === undefined) {
    await client.query(
      'INSERT INTO d1_credentials_schema_version (id, version) VALUES (1, ?)',
      [D1_CREDENTIALS_SCHEMA_VERSION],
    )
  } else if (row.version !== D1_CREDENTIALS_SCHEMA_VERSION) {
    throw new Error(
      `credentials-d1: database schema is stamped version ${String(row.version)},`
      + ` incompatible with this build (${String(D1_CREDENTIALS_SCHEMA_VERSION)})`,
    )
  }
}

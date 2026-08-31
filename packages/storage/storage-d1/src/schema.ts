/**
 * Schema for the Cloudflare D1 storage backend: the explicit physical-layout
 * version stamp, the schema-ensure sequence, and record-table naming — the D1
 * REST counterpart of the SQLite backend's `PRAGMA user_version` open
 * sequence. D1's REST surface has no equivalent local-connection convenience,
 * so this backend stamps its own single-row version table instead.
 * @module @deepseek-ai/dsh-storage-d1/schema
 */

import { StorageError } from '@deepseek-ai/dsh-storage'
import { recordTableName } from '@deepseek-ai/dsh-d1-client'
import type { D1Client } from '@deepseek-ai/dsh-d1-client'

export { recordTableName }

/**
 * The on-disk physical layout version, stored in the single-row
 * `d1_schema_version` table. Orthogonal to each unit's own `version`
 * (stamped per unit in `units`). Bumped only on a breaking change to the
 * table layout; any other stamped version rejects — this unreleased format
 * has no migrations. Independent from `STORAGE_SQLITE_SCHEMA_VERSION`: the
 * two backends store the same logical data in independent physical formats
 * with independent migration lifecycles.
 */
export const D1_SCHEMA_VERSION = 1

/**
 * Ensure the shared metadata tables exist and the physical layout version
 * matches. Runs once per backend instance (memoized by the caller); every
 * unit open awaits this first.
 * @param client - Client bound to the target D1 database.
 * @returns resolution once the metadata tables exist and the version is confirmed compatible.
 */
export async function ensureSchema(client: D1Client): Promise<void> {
  await client.batch([
    { sql: 'CREATE TABLE IF NOT EXISTS d1_schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)' },
    { sql: 'CREATE TABLE IF NOT EXISTS units (name TEXT PRIMARY KEY, version INTEGER NOT NULL)' },
    { sql: 'CREATE TABLE IF NOT EXISTS unit_globals (unit TEXT PRIMARY KEY REFERENCES units(name), value TEXT NOT NULL)' },
  ])
  const result = await client.query('SELECT version FROM d1_schema_version WHERE id = 1')
  const row = result.results[0] as { version: number } | undefined
  if (row === undefined) {
    await client.query('INSERT INTO d1_schema_version (id, version) VALUES (1, ?)', [D1_SCHEMA_VERSION])
  } else if (row.version !== D1_SCHEMA_VERSION) {
    throw new StorageError(
      'version-mismatch',
      `d1 database schema is stamped version ${row.version}, incompatible with this build (${D1_SCHEMA_VERSION})`,
    )
  }
}

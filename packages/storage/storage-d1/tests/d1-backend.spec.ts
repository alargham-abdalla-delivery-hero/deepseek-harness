import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { runKvBackendContract } from '../../storage/tests/contract.ts'
import * as StorageD1 from '../src/index.ts'
import { Config, D1StorageBackend, D1_SCHEMA_VERSION } from '../src/index.ts'
import { FakeD1Server } from './fake-d1-server.ts'

/** Mirror the loader: resolve schemastery defaults before construction. */
function backendAt(server: FakeD1Server): D1StorageBackend {
  return new D1StorageBackend(new Config({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }), server.client)
}

const servers: FakeD1Server[] = []
afterEach(() => { for (const s of servers.splice(0)) s.close() })

function freshServer(): FakeD1Server {
  const server = new FakeD1Server()
  servers.push(server)
  return server
}

// The contract suite's reopen() needs a surviving medium, so the harness binds
// a fake server that outlives any one backend instance — same relationship a
// real D1 database has to any one process's connection to it.
runKvBackendContract('d1', async () => {
  const server = freshServer()
  return {
    backend: backendAt(server),
    reopen: async () => backendAt(server),
  }
})

const DESCRIPTOR: KvUnitDescriptor = {
  name: 'specimen',
  version: 1,
  tables: ['records'],
  hasGlobal: true,
}

describe('d1 backend specifics', () => {
  it('materializes record tables and stamps the schema version', async () => {
    const server = freshServer()
    const backend = backendAt(server)
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('records', 'k', { n: 1 })
    await backend.close()

    const reopened = backendAt(server)
    await reopened.kv.open({ ...DESCRIPTOR, name: 'other', tables: [] })
    // Reaching schema-ensure on a second backend instance without rejecting
    // proves the stamped version matches D1_SCHEMA_VERSION.
    expect(D1_SCHEMA_VERSION).toBe(1)
    await reopened.close()
  })

  it('rejects a mismatched physical schema version', async () => {
    const server = freshServer()
    const bootstrap = backendAt(server)
    await bootstrap.kv.open({ ...DESCRIPTOR, tables: [] })
    await bootstrap.close()

    // Simulate a database stamped by an incompatible build.
    await server.client('ignored', { body: JSON.stringify({ sql: 'UPDATE d1_schema_version SET version = 999 WHERE id = 1' }) })

    const backend = backendAt(server)
    await expect(backend.kv.open(DESCRIPTOR)).rejects.toMatchObject({
      name: 'StorageError',
      code: 'version-mismatch',
    })
    await backend.close()
  })

  it('rejects invalid unit and table names before touching the medium', async () => {
    const backend = backendAt(freshServer())
    await expect(backend.kv.open({ ...DESCRIPTOR, name: 'Bad-Name' })).rejects.toThrow(/violates/)
    await expect(backend.kv.open({ ...DESCRIPTOR, tables: ['ok', '1bad'] })).rejects.toThrow(/violates/)
    await backend.close()
  })

  it('rejects a second open of the same unit name', async () => {
    const backend = backendAt(freshServer())
    await backend.kv.open(DESCRIPTOR)
    await expect(backend.kv.open(DESCRIPTOR)).rejects.toThrow(/already open/)
    await backend.close()
  })

  it('allows re-open after unit close, and rejects open on a closed backend', async () => {
    const backend = backendAt(freshServer())
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.close()
    const again = await backend.kv.open(DESCRIPTOR)
    await again.putRecord('records', 'k', 1)
    await backend.close()
    await expect(backend.kv.open(DESCRIPTOR)).rejects.toMatchObject({ code: 'closed' })
  })

  it('round-trips prototype-polluting keys as own properties', async () => {
    const backend = backendAt(freshServer())
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('records', '__proto__', { evil: true })
    await unit.putRecord('records', 'constructor', { n: 1 })
    const { tables } = await unit.loadAll()
    const records = tables['records']!
    expect(Object.hasOwn(records, '__proto__')).toBe(true)
    expect(records['__proto__']).toEqual({ evil: true })
    expect(records['constructor']).toEqual({ n: 1 })
    expect(Object.getPrototypeOf({})).not.toHaveProperty('evil')
    await backend.close()
  })

  it('wraps a non-Error toJSON throw into an Error rejection', async () => {
    const backend = backendAt(freshServer())
    const unit = await backend.kv.open(DESCRIPTOR)
    // JSON.stringify propagates a value's own toJSON throw verbatim; the unit
    // must still reject with an Error instance.
    const hostile = { toJSON: () => { throw 'not an error' } }
    await expect(unit.putRecord('records', 'k', hostile)).rejects.toThrow('not an error')
    await expect(unit.putRecord('records', 'k', hostile)).rejects.toBeInstanceOf(Error)
    await backend.close()
  })

  it('preserves a toJSON throw that is already an Error instance', async () => {
    const backend = backendAt(freshServer())
    const unit = await backend.kv.open(DESCRIPTOR)
    const original = new Error('deliberate toJSON failure')
    const hostile = { toJSON: () => { throw original } }
    await expect(unit.putRecord('records', 'k', hostile)).rejects.toBe(original)
    await backend.close()
  })

  it('drains a still-pending failed open during close', async () => {
    const server = freshServer()
    const first = backendAt(server)
    await (await first.kv.open(DESCRIPTOR)).close()
    await first.close()

    const backend = backendAt(server)
    // Do not await: close() must tolerate an in-flight open that will reject
    // (version mismatch) while its name is still reserved in the unit table.
    const pending = backend.kv.open({ ...DESCRIPTOR, version: 99 })
    const closed = backend.close()
    await expect(pending).rejects.toMatchObject({ code: 'version-mismatch' })
    await closed
  })

  it('rejects setGlobal on a unit without a global slot and writes to undeclared tables', async () => {
    const backend = backendAt(freshServer())
    const unit = await backend.kv.open({ ...DESCRIPTOR, hasGlobal: false })
    await expect(unit.setGlobal({ g: 1 })).rejects.toThrow(/declared no global slot/)
    await expect(unit.putRecord('undeclared', 'k', 1)).rejects.toThrow(/declared no table/)
    expect((await unit.loadAll()).global).toBeNull()
    await backend.close()
  })

  it('rejects unparsable stored JSON with malformed-medium', async () => {
    const server = freshServer()
    const backend = backendAt(server)
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('records', 'good', { n: 1 })
    await unit.setGlobal({ g: 1 })
    await backend.close()

    await server.client('ignored', {
      body: JSON.stringify({ sql: 'UPDATE u_specimen_records SET value = ? WHERE key = ?', params: ['{not json', 'good'] }),
    })

    const reopened = backendAt(server)
    const damaged = await reopened.kv.open(DESCRIPTOR)
    await expect(damaged.loadAll()).rejects.toMatchObject({
      name: 'StorageError',
      code: 'malformed-medium',
    })
    await reopened.close()
  })

  it('registers on the storage hub as backend d1 and closes on dispose', async () => {
    const server = freshServer()
    vi.stubGlobal('fetch', server.client)
    try {
      const ctx = new Context()
      await ctx.plugin(Storage)
      const fiber = await ctx.plugin(StorageD1, { accountId: 'acc', databaseId: 'db', apiToken: 'token' })
      const backend = ctx.storage.backend.get('d1')
      expect(ctx.get(storageBackendServiceKey('d1'))).toBe(backend)
      const unit = await backend.kv!.open({ ...DESCRIPTOR, tables: [] })
      await unit.close()

      await fiber.dispose()
      expect(ctx.storage.backend.names()).toEqual([])
      expect(ctx.get(storageBackendServiceKey('d1'))).toBeUndefined()
      await expect(backend.kv!.open({ ...DESCRIPTOR, tables: [] })).rejects.toMatchObject({ code: 'closed' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey, CredentialRecord, CredentialRef } from '@deepseek-ai/dsh-credentials'
import { D1CredentialProvider, D1_CREDENTIALS_SCHEMA_VERSION, type Config } from '../src/index.ts'
import { FakeD1Server } from './fake-d1-server.ts'

const servers: FakeD1Server[] = []
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
  vi.unstubAllEnvs()
})

function freshServer(): FakeD1Server {
  const server = new FakeD1Server()
  servers.push(server)
  return server
}

const CONFIG: Config = { accountId: 'acc', databaseId: 'db', apiToken: 'token' }

function providerAt(server: FakeD1Server, ctx = new Context()): D1CredentialProvider {
  return new D1CredentialProvider(ctx, CONFIG, server.client)
}

const REF = credentialRef('DSH_D1_TEST_REF')
const OTHER_REF = credentialRef('DSH_D1_TEST_OTHER')
const RECORD_KEY = credentialKey('llm-d1', 'alpha')

describe('resolve/describe', () => {
  it('reports unconfigured when neither D1 nor the environment carries the ref', async () => {
    const provider = providerAt(freshServer())
    expect(await provider.resolve(REF)).toBeUndefined()
    expect(await provider.describe(REF)).toEqual({ configured: false, writable: true })
  })

  it('falls back to a non-empty process.env value when D1 has no row', async () => {
    vi.stubEnv(REF, 'from-env')
    const provider = providerAt(freshServer())
    expect(await provider.resolve(REF)).toEqual({ value: 'from-env', source: 'env' })
    expect(await provider.describe(REF)).toEqual({ configured: true, source: 'env', writable: true })
  })

  it('treats an empty process.env value as absent, same as unset', async () => {
    vi.stubEnv(REF, '')
    const provider = providerAt(freshServer())
    expect(await provider.resolve(REF)).toBeUndefined()
    expect(await provider.describe(REF)).toEqual({ configured: false, writable: true })
  })

  it('prefers a stored D1 row over a process.env fallback', async () => {
    vi.stubEnv(REF, 'from-env')
    const provider = providerAt(freshServer())
    await provider.set(REF, 'from-d1')
    expect(await provider.resolve(REF)).toEqual({ value: 'from-d1', source: 'd1' })
    expect(await provider.describe(REF)).toEqual({ configured: true, source: 'd1', writable: true })
  })
})

describe('set/unset', () => {
  it('rejects storing an empty value', async () => {
    const provider = providerAt(freshServer())
    await expect(provider.set(REF, '')).rejects.toThrow(/empty value/)
  })

  it('stores, overwrites, and removes a reference, firing reference-updated on each committed write', async () => {
    const ctx = new Context()
    const provider = providerAt(freshServer(), ctx)
    const seen: CredentialRef[] = []
    ctx.on('credentials/reference-updated', (ref) => { seen.push(ref) })

    await provider.set(REF, 'one')
    await provider.set(REF, 'two')
    expect(await provider.resolve(REF)).toEqual({ value: 'two', source: 'd1' })
    await provider.unset(REF)
    expect(await provider.resolve(REF)).toBeUndefined()

    expect(seen).toEqual([REF, REF, REF])
  })

  it('unset on an absent reference is a no-op that fires no event', async () => {
    const ctx = new Context()
    const provider = providerAt(freshServer(), ctx)
    const seen: CredentialRef[] = []
    ctx.on('credentials/reference-updated', (ref) => { seen.push(ref) })

    await provider.unset(OTHER_REF)
    expect(seen).toEqual([])
  })
})

describe('records', () => {
  it('reports unconfigured when no record is stored', async () => {
    const provider = providerAt(freshServer())
    expect(await provider.readRecord(RECORD_KEY)).toBeUndefined()
    expect(await provider.describeRecord(RECORD_KEY)).toEqual({ configured: false, writable: true })
    expect(await provider.listRecords()).toEqual([])
  })

  it('writes, reads, describes, lists, and deletes an api-key record, firing record-updated on each committed write', async () => {
    const ctx = new Context()
    const provider = providerAt(freshServer(), ctx)
    const seen: CredentialKey[] = []
    ctx.on('credentials/record-updated', (key) => { seen.push(key) })

    const written = await provider.modifyRecord(RECORD_KEY, async (current) => {
      expect(current).toBeUndefined()
      return { kind: 'api-key', key: 'sk-one', env: { AWS_PROFILE: 'default' } }
    })
    expect(written).toEqual({ kind: 'api-key', key: 'sk-one', env: { AWS_PROFILE: 'default' } })
    expect(await provider.readRecord(RECORD_KEY)).toEqual(written)
    expect(await provider.describeRecord(RECORD_KEY)).toEqual({ configured: true, kind: 'api-key', writable: true })
    expect(await provider.listRecords()).toEqual([{ key: RECORD_KEY, kind: 'api-key' }])

    await provider.deleteRecord(RECORD_KEY)
    expect(await provider.readRecord(RECORD_KEY)).toBeUndefined()

    expect(seen).toEqual([RECORD_KEY, RECORD_KEY])
  })

  it('deleteRecord on an absent record is a no-op that fires no event', async () => {
    const ctx = new Context()
    const provider = providerAt(freshServer(), ctx)
    const seen: CredentialKey[] = []
    ctx.on('credentials/record-updated', (key) => { seen.push(key) })

    await provider.deleteRecord(RECORD_KEY)
    expect(seen).toEqual([])
  })

  it('mutate declining (returning undefined) leaves the entry untouched and fires no event', async () => {
    const ctx = new Context()
    const provider = providerAt(freshServer(), ctx)
    const seen: CredentialKey[] = []
    ctx.on('credentials/record-updated', (key) => { seen.push(key) })

    await provider.modifyRecord(RECORD_KEY, async () => ({ kind: 'api-key', key: 'sk-one' }))
    const result = await provider.modifyRecord(RECORD_KEY, async (current) => {
      expect(current).toEqual({ kind: 'api-key', key: 'sk-one' })
      return undefined
    })
    expect(result).toEqual({ kind: 'api-key', key: 'sk-one' })
    expect(seen).toEqual([RECORD_KEY])
  })

  it('an api-key record with neither key nor env is a deliberate "confirmed ambient auth" statement', async () => {
    const provider = providerAt(freshServer())
    const written = await provider.modifyRecord(RECORD_KEY, async () => ({ kind: 'api-key' }))
    expect(written).toEqual({ kind: 'api-key' })
    expect(await provider.describeRecord(RECORD_KEY)).toEqual({ configured: true, kind: 'api-key', writable: true })
  })

  it('rejects an api-key record with an empty key', async () => {
    const provider = providerAt(freshServer())
    await expect(provider.modifyRecord(RECORD_KEY, async () => ({ kind: 'api-key', key: '' })))
      .rejects.toThrow(/empty key/)
  })

  it('rejects an api-key record whose env name is not a valid credential ref', async () => {
    const provider = providerAt(freshServer())
    await expect(provider.modifyRecord(RECORD_KEY, async () => ({ kind: 'api-key', env: { 'not a ref': 'x' } })))
      .rejects.toThrow(/not a valid credential ref/)
  })

  it('rejects an api-key record with an empty env value', async () => {
    const provider = providerAt(freshServer())
    await expect(provider.modifyRecord(RECORD_KEY, async () => ({ kind: 'api-key', env: { AWS_PROFILE: '' } })))
      .rejects.toThrow(/must be a non-empty string/)
  })

  it('stores a grant record with a nested, JSON-safe payload', async () => {
    const provider = providerAt(freshServer())
    const payload = { token: 'abc', scopes: ['a', 'b'], meta: { nested: true, count: 3, missing: null } }
    const written = await provider.modifyRecord(RECORD_KEY, async () => ({ kind: 'grant', payload }))
    expect(written).toEqual({ kind: 'grant', payload })
    expect(await provider.readRecord(RECORD_KEY)).toEqual({ kind: 'grant', payload })
  })

  it('rejects a grant payload holding a non-finite number', async () => {
    const provider = providerAt(freshServer())
    await expect(provider.modifyRecord(RECORD_KEY, async () => ({ kind: 'grant', payload: Number.POSITIVE_INFINITY })))
      .rejects.toThrow(/non-finite number/)
  })

  it('rejects a cyclic grant payload', async () => {
    const provider = providerAt(freshServer())
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    await expect(provider.modifyRecord(RECORD_KEY, async () => ({ kind: 'grant', payload: cyclic })))
      .rejects.toThrow(/cyclic/)
  })

  it('rejects a grant payload value that is not a plain object, array, or JSON primitive', async () => {
    const provider = providerAt(freshServer())
    await expect(provider.modifyRecord(RECORD_KEY, async () => ({ kind: 'grant', payload: new Date() })))
      .rejects.toThrow(/cannot represent/)
    await expect(provider.modifyRecord(RECORD_KEY, async () => ({ kind: 'grant', payload: () => {} })))
      .rejects.toThrow(/cannot represent/)
  })

  it('rejects a record of an unknown kind', async () => {
    const provider = providerAt(freshServer())
    const bogus = { kind: 'bogus' } as unknown as CredentialRecord
    await expect(provider.modifyRecord(RECORD_KEY, async () => bogus)).rejects.toThrow(/unknown record kind/)
  })
})

describe('schema', () => {
  it('stamps the current schema version on a fresh database and reopens without rejecting', async () => {
    const server = freshServer()
    const first = providerAt(server)
    await first.set(REF, 'value')
    expect(D1_CREDENTIALS_SCHEMA_VERSION).toBe(1)

    const reopened = providerAt(server)
    expect(await reopened.resolve(REF)).toEqual({ value: 'value', source: 'd1' })
  })

  it('rejects a mismatched physical schema version', async () => {
    const server = freshServer()
    const bootstrap = providerAt(server)
    await bootstrap.set(REF, 'value')

    await server.client('ignored', { body: JSON.stringify({ sql: 'UPDATE d1_credentials_schema_version SET version = 999 WHERE id = 1' }) })

    const provider = providerAt(server)
    await expect(provider.resolve(REF)).rejects.toThrow(/incompatible with this build/)
  })
})

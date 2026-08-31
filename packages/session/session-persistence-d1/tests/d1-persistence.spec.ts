import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { runPersistenceContract, meta, oneTurnLog, type ContractBackend } from '../../session-persistence/tests/contract.ts'
import D1SessionPersistence, { D1_SESSION_SCHEMA_VERSION } from '../src/index.ts'
import { D1Store } from '../src/store.ts'
import { FakeD1Server } from './fake-d1-server.ts'

/** Boot a fresh backend against a fresh fake D1 server, stubbing global fetch for the test's lifetime. */
async function makeD1Backend(): Promise<ContractBackend> {
  const server = new FakeD1Server()
  const originalFetch = globalThis.fetch
  globalThis.fetch = server.client as typeof fetch
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(D1SessionPersistence, { accountId: 'acc', databaseId: 'db', apiToken: 'token' })
  return {
    persistence: ctx.sessionPersistence,
    dispose: async () => {
      await ctx.fiber.dispose()
      globalThis.fetch = originalFetch
      server.close()
    },
  }
}

runPersistenceContract('d1', makeD1Backend)

describe('d1 store specifics', () => {
  it('rejects a mismatched physical schema version', async () => {
    const server = new FakeD1Server()
    const bootstrap = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    await bootstrap.list()

    await server.client('ignored', { body: JSON.stringify({ sql: 'UPDATE d1_session_schema_version SET version = 999 WHERE id = 1' }) })

    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    await expect(store.list()).rejects.toThrow(/incompatible with this build/)
    expect(D1_SESSION_SCHEMA_VERSION).toBe(1)
    server.close()
  })

  it('detects a torn physical tail (malformed row) and repairs it via commitRepair', async () => {
    const server = new FakeD1Server()
    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    const m: SessionHeader = meta('torn')
    await store.appendBatch(m, oneTurnLog(), false)

    // Simulate a torn physical row: unparsable JSON in the data column.
    await server.client('ignored', {
      body: JSON.stringify({ sql: 'INSERT INTO events (session_id, seq, type, time, data) VALUES (?, ?, ?, ?, ?)', params: [m.id, 6, 'turn/start', 7, '{not json'] }),
    })

    const stored = await store.loadStored(m.id)
    expect(stored?.tornMarker).toBe(6)
    expect(stored?.events).toHaveLength(6)

    await store.commitRepair(m, 6, [])
    const repaired = await store.loadStored(m.id)
    expect(repaired?.tornMarker).toBeUndefined()
    expect(repaired?.events).toHaveLength(6)
    server.close()
  })

  it('rejects a stale repair whose torn marker no longer matches the physical tail', async () => {
    const server = new FakeD1Server()
    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    const m: SessionHeader = meta('stale-repair')
    await store.appendBatch(m, oneTurnLog(), false)
    await expect(store.commitRepair(m, 999, [])).rejects.toThrow(/repair is stale/)
    server.close()
  })

  it('rejects commitRepair omitting a currently torn tail', async () => {
    const server = new FakeD1Server()
    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    const m: SessionHeader = meta('omitted-torn')
    await store.appendBatch(m, oneTurnLog(), false)
    await server.client('ignored', {
      body: JSON.stringify({ sql: 'INSERT INTO events (session_id, seq, type, time, data) VALUES (?, ?, ?, ?, ?)', params: [m.id, 6, 'turn/start', 7, '{not json'] }),
    })
    const closer: SessionEvent = { type: 'turn/end', seq: 6, time: 8, data: { turn: 2, reason: { kind: 'interrupted' } } }
    await expect(store.commitRepair(m, undefined, [closer])).rejects.toThrow(/omitted current torn tail/)
    server.close()
  })

  it('commitRepair is a no-op with no torn marker and no closers', async () => {
    const server = new FakeD1Server()
    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    const m: SessionHeader = meta('noop-repair')
    await store.appendBatch(m, oneTurnLog(), false)
    await expect(store.commitRepair(m, undefined, [])).resolves.toBeUndefined()
    server.close()
  })

  it('commitRepair rejects a missing session row', async () => {
    const server = new FakeD1Server()
    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    await expect(store.commitRepair(meta('absent'), 0, [])).rejects.toThrow(/metadata row is missing/)
    server.close()
  })

  it('materializeHeader is idempotent when the header already exists', async () => {
    const server = new FakeD1Server()
    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    const m: SessionHeader = meta('already-materialized')
    await store.materializeHeader(m)
    await expect(store.materializeHeader(m)).resolves.toBeUndefined()
    expect((await store.list()).map(header => header.id)).toEqual([SessionId('already-materialized')])
    server.close()
  })

  it('appendBatch is a no-op for an empty event list', async () => {
    const server = new FakeD1Server()
    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    const m: SessionHeader = meta('empty-append')
    await expect(store.appendBatch(m, [], false)).resolves.toBeUndefined()
    expect(await store.readStoredRevision(m.id)).toBeUndefined()
    server.close()
  })

  it('loadStoredFrom returns undefined for an absent session', async () => {
    const server = new FakeD1Server()
    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    await expect(store.loadStoredFrom(SessionId('absent'), 0)).resolves.toBeUndefined()
    server.close()
  })

  it('loadStoredFrom returns the physical suffix from the requested seq', async () => {
    const server = new FakeD1Server()
    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    const m: SessionHeader = meta('suffix')
    await store.appendBatch(m, oneTurnLog(), false)
    const suffix = await store.loadStoredFrom(m.id, 3)
    expect(suffix?.events.map(event => event.seq)).toEqual([3, 4, 5])
    server.close()
  })

  it('reopens an already-initialized database whose stamped version matches', async () => {
    const server = new FakeD1Server()
    const first = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    await first.list()
    const second = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    await expect(second.list()).resolves.toEqual([])
    server.close()
  })

  it('round-trips every optional header field through rowToMeta', async () => {
    const server = new FakeD1Server()
    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    const m: SessionHeader = {
      ...meta('full-header', '/work'),
      parentSession: SessionId('parent'),
      seedLength: 3,
      origin: 'subagent',
      delegationDepth: 1,
      agentPreset: 'preset-a',
    }
    await store.materializeHeader(m)
    const [loaded] = await store.list()
    expect(loaded).toEqual(m)
    server.close()
  })

  it('detects a physical seq gap (not just malformed JSON) as a torn tail', async () => {
    const server = new FakeD1Server()
    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    const m: SessionHeader = meta('gapped')
    await store.appendBatch(m, oneTurnLog(), false)
    // Well-formed JSON, but skips seq 6: a physical gap, not a parse failure.
    await server.client('ignored', {
      body: JSON.stringify({
        sql: 'INSERT INTO events (session_id, seq, type, time, data) VALUES (?, ?, ?, ?, ?)',
        params: [m.id, 7, 'turn/start', 8, JSON.stringify({ turn: 2 })],
      }),
    })
    const stored = await store.loadStored(m.id)
    expect(stored?.tornMarker).toBe(7)
    expect(stored?.events).toHaveLength(6)
    server.close()
  })

  it('rejects an append to an unmaterialized session that does not start at seq 0', async () => {
    const server = new FakeD1Server()
    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    const m: SessionHeader = meta('bad-first-append')
    const misaligned: SessionEvent[] = [{ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }]
    await expect(store.appendBatch(m, misaligned, false)).rejects.toThrow(/stored next seq is 0/)
    server.close()
  })

  it('appends to a materialized session with zero events, and rejects a misaligned append', async () => {
    const server = new FakeD1Server()
    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    const m: SessionHeader = meta('materialized-empty')
    await store.materializeHeader(m)
    expect(await store.readStoredRevision(m.id)).toBeDefined()

    const misaligned: SessionEvent[] = [{ type: 'turn/start', seq: 5, time: 1, data: { turn: 1 } }]
    await expect(store.appendBatch(m, misaligned, true)).rejects.toThrow(/stored next seq is 0/)

    await store.appendBatch(m, [{ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }], true)
    expect((await store.loadStored(m.id))?.events).toHaveLength(1)
    server.close()
  })

  it('rejects a stale closer whose seq does not continue the preserved log', async () => {
    const server = new FakeD1Server()
    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    const m: SessionHeader = meta('stale-closer')
    await store.appendBatch(m, oneTurnLog(), false)
    const wrongCloser: SessionEvent = { type: 'turn/end', seq: 99, time: 1, data: { turn: 2, reason: { kind: 'interrupted' } } }
    await expect(store.commitRepair(m, undefined, [wrongCloser])).rejects.toThrow(/repair is stale/)
    server.close()
  })

  it('accepts a closer on an empty preserved log starting at seq 0', async () => {
    const server = new FakeD1Server()
    const store = new D1Store({ accountId: 'acc', databaseId: 'db', apiToken: 'token' }, server.client)
    const m: SessionHeader = meta('empty-preserved-closer')
    await store.materializeHeader(m)
    // Insert a torn (malformed) row at seq 0 so the preserved prefix is empty.
    await server.client('ignored', {
      body: JSON.stringify({
        sql: 'INSERT INTO events (session_id, seq, type, time, data) VALUES (?, ?, ?, ?, ?)',
        params: [m.id, 0, 'turn/start', 1, '{not json'],
      }),
    })
    const closer: SessionEvent = { type: 'turn/end', seq: 0, time: 2, data: { turn: 1, reason: { kind: 'interrupted' } } }
    await store.commitRepair(m, 0, [closer])
    expect((await store.loadStored(m.id))?.events).toEqual([closer])
    server.close()
  })
})

describe('D1SessionPersistence glue', () => {
  it('locate always returns undefined (D1 has no per-session artifact)', async () => {
    const backend = await makeD1Backend()
    try {
      expect(backend.persistence.locate(meta('any'))).toBeUndefined()
    } finally {
      await backend.dispose()
    }
  })

  it('ensureMaterialized durably registers a live zero-event session', async () => {
    const server = new FakeD1Server()
    const originalFetch = globalThis.fetch
    globalThis.fetch = server.client as typeof fetch
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(D1SessionPersistence, { accountId: 'acc', databaseId: 'db', apiToken: 'token' })
      const session = ctx.sessions.create(SessionId('ensure-materialized'))
      await ctx.sessionPersistence.ensureMaterialized(session)
      expect((await ctx.sessionPersistence.list()).map(header => header.id)).toContain(SessionId('ensure-materialized'))
    } finally {
      await ctx.fiber.dispose()
      globalThis.fetch = originalFetch
      server.close()
    }
  })

  it('prepare returns an unpublished resumable Session for a stored, non-live id', async () => {
    const server = new FakeD1Server()
    const originalFetch = globalThis.fetch
    globalThis.fetch = server.client as typeof fetch
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(D1SessionPersistence, { accountId: 'acc', databaseId: 'db', apiToken: 'token' })
      const m = meta('prepare-target')
      await ctx.sessionPersistence.create(m)
      await ctx.sessionPersistence.append(m.id, oneTurnLog())
      const preparation = await ctx.sessionPersistence.prepare(m.id)
      try {
        expect(preparation.session.header.id).toBe(m.id)
      } finally {
        preparation[Symbol.dispose]()
      }
    } finally {
      await ctx.fiber.dispose()
      globalThis.fetch = originalFetch
      server.close()
    }
  })

  it('borrowSession returns a live source while the session is attached', async () => {
    const server = new FakeD1Server()
    const originalFetch = globalThis.fetch
    globalThis.fetch = server.client as typeof fetch
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(D1SessionPersistence, { accountId: 'acc', databaseId: 'db', apiToken: 'token' })
      const session = ctx.sessions.create(SessionId('borrow-live'))
      await ctx.sessionPersistence.ensureMaterialized(session)
      using observation = await ctx.sessionPersistence.borrowSession(session.id)
      expect(observation.source).toBe('live')
    } finally {
      await ctx.fiber.dispose()
      globalThis.fetch = originalFetch
      server.close()
    }
  })
})

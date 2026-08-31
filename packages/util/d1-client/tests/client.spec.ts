import { describe, expect, it } from 'vitest'
import { D1Client } from '../src/index.ts'
import type { D1HttpClient } from '../src/index.ts'

describe('D1Client', () => {
  it('sends a single query as a plain object body and returns its result', async () => {
    let capturedBody: string | undefined
    let capturedUrl: string | undefined
    let capturedAuth: string | undefined
    const httpClient: D1HttpClient = async (url, init) => {
      capturedUrl = url
      capturedBody = init?.body as string
      capturedAuth = (init?.headers as Record<string, string>)['Authorization']
      return new Response(JSON.stringify({ success: true, result: [{ results: [{ n: 1 }], success: true, meta: {} }] }), { status: 200 })
    }
    const client = new D1Client({ accountId: 'acc', databaseId: 'db', apiToken: 'tok' }, httpClient)
    const result = await client.query('SELECT 1', ['a'])
    expect(capturedUrl).toBe('https://api.cloudflare.com/client/v4/accounts/acc/d1/database/db/query')
    expect(JSON.parse(capturedBody!)).toEqual({ sql: 'SELECT 1', params: ['a'] })
    expect(capturedAuth).toBe('Bearer tok')
    expect(result).toEqual({ results: [{ n: 1 }], success: true, meta: {} })
  })

  it('sends multiple statements as an array body for batch()', async () => {
    let capturedBody: string | undefined
    const httpClient: D1HttpClient = async (_url, init) => {
      capturedBody = init?.body as string
      return new Response(JSON.stringify({
        success: true,
        result: [{ results: [], success: true, meta: {} }, { results: [], success: true, meta: {} }],
      }), { status: 200 })
    }
    const client = new D1Client({ accountId: 'acc', databaseId: 'db', apiToken: 'tok' }, httpClient)
    const results = await client.batch([{ sql: 'A' }, { sql: 'B', params: [1] }])
    expect(JSON.parse(capturedBody!)).toEqual([{ sql: 'A' }, { sql: 'B', params: [1] }])
    expect(results).toHaveLength(2)
  })

  it('defaults to global fetch when no httpClient is supplied', async () => {
    const original = globalThis.fetch
    let called = false
    globalThis.fetch = async () => {
      called = true
      return new Response(JSON.stringify({ success: true, result: [{ results: [], success: true, meta: {} }] }), { status: 200 })
    }
    try {
      const client = new D1Client({ accountId: 'acc', databaseId: 'db', apiToken: 'tok' })
      await client.query('SELECT 1')
      expect(called).toBe(true)
    } finally {
      globalThis.fetch = original
    }
  })

  it('propagates a network failure reaching D1 as a plain Error', async () => {
    const failing: D1HttpClient = async () => { throw new Error('fetch failed') }
    const client = new D1Client({ accountId: 'acc', databaseId: 'db', apiToken: 'tok' }, failing)
    await expect(client.query('SELECT 1')).rejects.toThrow(/D1 request to database 'db' failed/)
  })

  it('propagates an unparsable D1 response as a plain Error', async () => {
    const garbled: D1HttpClient = async () => new Response('not json', { status: 200 })
    const client = new D1Client({ accountId: 'acc', databaseId: 'db', apiToken: 'tok' }, garbled)
    await expect(client.query('SELECT 1')).rejects.toThrow(/not valid JSON/)
  })

  it('propagates a D1 API error response with an errors array as a plain Error', async () => {
    const failing: D1HttpClient = async () =>
      new Response(JSON.stringify({ success: false, errors: [{ message: 'no such table: bogus' }] }), { status: 400 })
    const client = new D1Client({ accountId: 'acc', databaseId: 'db', apiToken: 'tok' }, failing)
    await expect(client.query('SELECT 1')).rejects.toThrow(/no such table: bogus/)
  })

  it('propagates a D1 API error response with no errors array using the HTTP status', async () => {
    const failing: D1HttpClient = async () => new Response(JSON.stringify({ success: false }), { status: 503 })
    const client = new D1Client({ accountId: 'acc', databaseId: 'db', apiToken: 'tok' }, failing)
    await expect(client.query('SELECT 1')).rejects.toThrow(/HTTP 503/)
  })

  it('defaults a missing result array to empty on a successful response', async () => {
    const empty: D1HttpClient = async () => new Response(JSON.stringify({ success: true }), { status: 200 })
    const client = new D1Client({ accountId: 'acc', databaseId: 'db', apiToken: 'tok' }, empty)
    await expect(client.batch([{ sql: 'CREATE TABLE IF NOT EXISTS x (k TEXT)' }])).resolves.toEqual([])
  })
})

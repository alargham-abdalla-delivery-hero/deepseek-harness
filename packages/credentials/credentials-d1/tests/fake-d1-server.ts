/**
 * In-memory fake of Cloudflare's D1 REST query endpoint, backed by
 * `node:sqlite` — D1 IS SQLite under the hood, so executing real SQL against
 * a real (local) SQLite engine gives high-fidelity behavior without a live
 * D1 database. Package-local copy of the same fake `dsh-storage-d1` and
 * `dsh-session-persistence-d1` each keep under `tests/`, matching this repo's
 * precedent of not sharing test doubles across package boundaries.
 * @module
 */

import { DatabaseSync } from 'node:sqlite'
import type { D1HttpClient } from '@deepseek-ai/dsh-d1-client'

interface RequestBody {
  readonly sql: string
  readonly params?: unknown[]
}

/** One fake D1 database instance; `client` is the `D1HttpClient` double reaching it. */
export class FakeD1Server {
  private readonly db = new DatabaseSync(':memory:')
  private closed = false

  /** `D1HttpClient` double bound to this fake database. Request URL and auth header are ignored. */
  readonly client: D1HttpClient = async (_input, init) => {
    if (this.closed) return jsonResponse({ result: [], success: false, errors: [{ message: 'fake d1 server closed' }] }, 500)
    // Mirrors D1Client.send's real request body: a lone statement posts as a
    // bare object, two or more post as `{batch: [...]}` — Cloudflare's
    // documented multi-statement shape, not a bare array.
    const parsed = JSON.parse((init?.body as string | undefined) ?? '{}') as RequestBody | { batch: RequestBody[] }
    const statements = 'batch' in parsed ? parsed.batch : [parsed]
    try {
      const result = statements.map(({ sql, params = [] }) => this.run(sql, params))
      return jsonResponse({ result, success: true }, 200)
    } catch (error) {
      return jsonResponse(
        { result: [], success: false, errors: [{ message: error instanceof Error ? error.message : String(error) }] },
        500,
      )
    }
  }

  /** Run one statement against the fake database. */
  private run(sql: string, params: unknown[]): { results: Record<string, unknown>[]; success: boolean; meta: { changes?: number } } {
    const stmt = this.db.prepare(sql)
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      const results = stmt.all(...(params as never[])) as Record<string, unknown>[]
      return { results, success: true, meta: {} }
    }
    const info = stmt.run(...(params as never[]))
    return { results: [], success: true, meta: { changes: Number(info.changes) } }
  }

  /** Release the fake database. Subsequent requests fail like a real closed medium would. */
  close(): void {
    this.closed = true
    this.db.close()
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

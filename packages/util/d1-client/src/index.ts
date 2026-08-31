/**
 * HTTP client for Cloudflare D1's REST query API
 * (`/accounts/:id/d1/database/:id/query`), the documented path for reaching a
 * D1 database from outside the Workers runtime — no binding, so any D1-backed
 * provider built on this client runs from any Node process, including one
 * hosted inside a Cloudflare Container. One HTTP round trip per
 * {@link D1Client.query} call; D1 executes a {@link D1Client.batch} call as
 * one atomic transaction, same as the binding-based `env.DB.batch()`. Shared
 * by every D1-backed provider (`@deepseek-ai/dsh-storage-d1`,
 * `@deepseek-ai/dsh-session-persistence-d1`) rather than duplicated per package.
 * @module @deepseek-ai/dsh-d1-client
 */

/** Injectable HTTP call shape; defaults to global `fetch`. Tests supply a double directly — no global stubbing needed. */
export type D1HttpClient = (input: string, init?: RequestInit) => Promise<Response>

/** One SQL statement with its positional bind parameters. */
export interface D1Statement {
  readonly sql: string
  readonly params?: readonly unknown[]
}

/** One statement's result, matching D1's REST response shape. */
export interface D1QueryResult {
  readonly results: readonly Record<string, unknown>[]
  readonly success: boolean
  readonly meta: { readonly changes?: number }
}

/** Shape of the outer REST envelope; `result` holds one entry per submitted statement. */
interface D1ApiResponse {
  readonly result?: readonly D1QueryResult[]
  readonly success: boolean
  readonly errors?: readonly { readonly message: string }[]
}

/** Identity of one D1 database plus the token authorizing REST access to it. */
export interface D1Identity {
  readonly accountId: string
  readonly databaseId: string
  readonly apiToken: string
}

/**
 * Client bound to one D1 database over the Cloudflare REST API. Stateless
 * between calls: there is no connection to hold open or close, unlike a local
 * database handle.
 */
export class D1Client {
  private readonly endpoint: string

  /**
   * @param identity - Account, database, and token identifying the target D1 database.
   * @param httpClient - Injectable HTTP call; defaults to global `fetch`.
   */
  constructor(
    private readonly identity: D1Identity,
    private readonly httpClient: D1HttpClient = (input, init) => fetch(input, init),
  ) {
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${identity.accountId}/d1/database/${identity.databaseId}/query`
  }

  /**
   * Run one statement.
   * @param sql - Single SQL statement.
   * @param params - Positional bind parameters for `?` placeholders.
   * @returns that statement's result.
   */
  async query(sql: string, params: readonly unknown[] = []): Promise<D1QueryResult> {
    const [result] = await this.send([{ sql, params }])
    return result as D1QueryResult
  }

  /**
   * Run multiple statements as one atomic D1 batch (one HTTP round trip; all
   * succeed or all fail together).
   * @param statements - Statements to run, in order.
   * @returns one result per statement, in the same order.
   */
  async batch(statements: readonly D1Statement[]): Promise<readonly D1QueryResult[]> {
    return this.send(statements)
  }

  private async send(statements: readonly D1Statement[]): Promise<readonly D1QueryResult[]> {
    const body = statements.length === 1 ? JSON.stringify(statements[0]) : JSON.stringify(statements)
    let response: Response
    try {
      response = await this.httpClient(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.identity.apiToken}`,
          'Content-Type': 'application/json',
        },
        body,
      })
    } catch (error) {
      throw new Error(`D1 request to database '${this.identity.databaseId}' failed: ${String(error)}`, { cause: error })
    }
    const text = await response.text()
    let payload: D1ApiResponse
    try {
      payload = JSON.parse(text) as D1ApiResponse
    } catch (error) {
      throw new Error(
        `D1 response for database '${this.identity.databaseId}' is not valid JSON (status ${response.status}): ${text.slice(0, 200)}`,
        { cause: error },
      )
    }
    if (!response.ok || !payload.success) {
      const messages = payload.errors?.map(e => e.message).join('; ') ?? `HTTP ${response.status}`
      throw new Error(`D1 query against database '${this.identity.databaseId}' failed: ${messages}`)
    }
    return payload.result ?? []
  }
}

/**
 * Physical table name for one storage-domain unit table, shared by every
 * consumer that must address a `dsh-storage-d1` record table directly (the
 * backend itself, and `dsh-cloudflare-worker`'s edge-gateway Workspace-
 * existence check). Callers validate both segments (e.g. against
 * `UNIT_NAME_RE` from `@deepseek-ai/dsh-storage`) before calling this — the
 * result is interpolated directly into DDL and statement text.
 * @param unit - Validated unit name.
 * @param table - Validated table name.
 * @returns the `u_<unit>_<table>` identifier.
 */
export function recordTableName(unit: string, table: string): string {
  return `u_${unit}_${table}`
}

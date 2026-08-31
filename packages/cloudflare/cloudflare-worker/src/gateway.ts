/**
 * Edge Worker terminating the browser's Client Connection: authenticates the
 * caller, resolves which Workspace the request names, and forwards it to
 * that Workspace's Container-backed Durable Object. Cloudflare Access sits
 * in front of this Worker (see the Cloudflare-hosted backend design), so
 * this Worker's own check is defense in depth — it verifies Access already
 * admitted the request, it does not re-implement Access's own verification.
 * @module @deepseek-ai/cloudflare-worker/gateway
 */

import { getContainer } from '@cloudflare/containers'
import { D1Client, recordTableName } from '@deepseek-ai/dsh-d1-client'
import type { HostContainer } from './host-container.ts'
import type { Env as ContainerEnv } from './host-container.ts'

/** Bindings this Worker reads, plus the Durable Object namespace it routes into. */
export interface Env extends ContainerEnv {
  /** The Container-backed Durable Object namespace hosting one instance per Workspace. */
  readonly HOST_CONTAINER: DurableObjectNamespace<HostContainer>
  /**
   * Workspace id used when the request names none explicitly (see
   * {@link resolveWorkspaceId}). A single-Workspace deployment sets this to
   * its one Workspace's id; a deployment routing several Workspaces through
   * one Worker requires every request to carry an explicit `/w/<id>/` prefix.
   */
  readonly DEFAULT_WORKSPACE_ID?: string
}

/** Path prefix a request may carry to name its Workspace explicitly: `/w/<id>/...`. */
const WORKSPACE_PATH_PREFIX = /^\/w\/([^/]+)/u
/** Header Cloudflare Access sets on every request it admits. */
const ACCESS_JWT_HEADER = 'Cf-Access-Jwt-Assertion'
/**
 * The Workspace registry's physical D1 table, per `dsh-storage-d1`'s
 * `u_<unit>_<table>` layout for `@deepseek-ai/dsh-workspace`'s
 * `workspaceDomainSpec` (`name: 'workspace'`, `tables: { workspaces }`).
 */
const WORKSPACE_RECORD_TABLE = recordTableName('workspace', 'workspaces')

/**
 * A resolved routing target. `explicit` distinguishes a caller-named
 * `/w/<id>/` Workspace (must be verified against the D1 registry — see
 * {@link handleRequest}) from the `DEFAULT_WORKSPACE_ID` fallback, which
 * names this single-Workspace deployment's one Container slot, not a
 * specific Workspace record — see {@link resolveWorkspaceId}.
 */
export interface ResolvedTarget {
  readonly workspaceId: string
  readonly forwardPath: string
  readonly explicit: boolean
}

/**
 * Resolve which Workspace a request names: an explicit `/w/<id>/...` path
 * prefix (stripped before forwarding), or `env.DEFAULT_WORKSPACE_ID` for a
 * single-Workspace deployment. Today's browser client sends no such prefix —
 * multi-Workspace routing through one deployed Worker needs client-side
 * support this proposal has not yet built (see the package README).
 *
 * `DEFAULT_WORKSPACE_ID` is a fixed Container-routing slot, not a Workspace
 * id promise: `@deepseek-ai/dsh-workspace` assigns every real Workspace a
 * random `randomUUID()` id, so a literal configured value (e.g. `"default"`)
 * never equals one. Existence-checking it against the D1 registry would
 * permanently 404 a fresh single-Workspace deployment before its first
 * Workspace is ever created — there is no "wrong Workspace" this fallback
 * could route to, since the whole deployment is this one Container slot.
 * @param url - the incoming request's URL.
 * @param env - bindings, including the optional single-Workspace default.
 * @returns the resolved target, or `undefined` when neither source names one.
 */
export function resolveWorkspaceId(url: URL, env: Env): ResolvedTarget | undefined {
  const match = WORKSPACE_PATH_PREFIX.exec(url.pathname)
  if (match) {
    const forwardPath = url.pathname.slice(match[0].length)
    return { workspaceId: match[1], forwardPath: forwardPath.length > 0 ? forwardPath : '/', explicit: true }
  }
  if (env.DEFAULT_WORKSPACE_ID !== undefined && env.DEFAULT_WORKSPACE_ID.length > 0) {
    return { workspaceId: env.DEFAULT_WORKSPACE_ID, forwardPath: url.pathname, explicit: false }
  }
  return undefined
}

/**
 * Check whether a Workspace id has a matching record in the D1-backed
 * registry, reached over `dsh-d1-client`'s REST path with the same
 * credentials already forwarded into the container — no separate D1 binding.
 * This is this deployment's whole "ownership" check (see the package README
 * and design.md): a single-principal deployment has no per-Workspace owner
 * field, so routing is gated on existence rather than an identity comparison.
 * @param env - Worker bindings carrying the D1 REST credentials.
 * @param workspaceId - the id to look up.
 * @returns whether a matching Workspace record exists.
 */
async function workspaceExists(env: Env, workspaceId: string): Promise<boolean> {
  const client = new D1Client({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    databaseId: env.CLOUDFLARE_D1_DATABASE_ID,
    apiToken: env.CLOUDFLARE_D1_API_TOKEN,
  })
  const result = await client.query(`SELECT 1 FROM "${WORKSPACE_RECORD_TABLE}" WHERE key = ? LIMIT 1`, [workspaceId])
  return result.results.length > 0
}

/**
 * Handle one incoming request: reject unauthenticated callers, resolve the
 * target Workspace, verify an explicitly-named one exists, and forward to
 * its Durable Object.
 * @param request - the incoming request.
 * @param env - Worker bindings.
 * @returns the Durable Object's response, or a rejection for an
 * unauthenticated, unresolvable, nonexistent, or D1-unreachable Workspace.
 */
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.headers.get(ACCESS_JWT_HEADER) === null) {
    return new Response('Unauthorized', { status: 401 })
  }
  const url = new URL(request.url)
  const resolved = resolveWorkspaceId(url, env)
  if (resolved === undefined) {
    return new Response('Bad Request: no Workspace named (missing /w/<id>/ prefix and no DEFAULT_WORKSPACE_ID configured)', { status: 400 })
  }
  if (resolved.explicit) {
    let exists: boolean
    try {
      exists = await workspaceExists(env, resolved.workspaceId)
    } catch (error) {
      return new Response(`Bad Gateway: could not verify Workspace '${resolved.workspaceId}' against D1: ${String(error)}`, { status: 502 })
    }
    if (!exists) {
      return new Response(`Not Found: no Workspace '${resolved.workspaceId}' exists`, { status: 404 })
    }
  }
  const forwardUrl = new URL(request.url)
  forwardUrl.pathname = resolved.forwardPath
  const forwardRequest = new Request(forwardUrl, request)
  const container = getContainer(env.HOST_CONTAINER, resolved.workspaceId)
  return container.fetch(forwardRequest)
}

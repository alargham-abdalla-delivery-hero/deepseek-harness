/** Host HTTP bridge for browser-client RPC. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-credentials'
// Activates the webServer Context merge used below.
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { API_PATH } from './api-path.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'
import { assertTrustedAuthority } from './api-request-trust.ts'
import { BrowserAuth } from './browser-auth.ts'
import { HostConnectionService } from './rpc-host.ts'
import { TRUSTED_AS_HOST_GLOBAL } from './trusted-as-host.ts'

export type {
  ConnectionFetchMethod,
  ConnectionFetchHandler,
  ConnectionFetchRoute,
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcFailure,
  ConnectionRpcHandler,
  ConnectionRequestRejection,
  ConnectionRpcResult,
  ConnectionTrustRequest,
  ClientRequest,
  HostConnectionHandle,
  HostConnectionFetch,
  HostConnectionRpc,
  RpcMessage,
  ServerResponse,
} from './rpc.ts'
export { RpcId, transportError } from './rpc.ts'
export {
  clientRequestSchema,
  rpcErrorSchema,
  rpcIdSchema,
  rpcMessageSchema,
  rpcResultSchema,
  serverResponseSchema,
} from './rpc-schema.ts'
export { HostConnectionService } from './rpc-host.ts'

export { API_PATH } from './api-path.ts'

/** Stable Cordis plugin name. */
export const name = 'client-connection'

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Services required before providing Connection. */
export const inject = ['webServer', 'credentials']

/** Plugin config: the deployment's non-loopback serving authorities. */
export interface ConnectionConfig {
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by; the Web runtime derives LAN IP literals from an active all-interface
   * bind. An entry that is not a bare, canonical authority fails plugin load.
   */
  trustedHosts?: string[]
  /** Absolute browser-session lifetime in days. Default: 30. */
  cookieMaxAgeDays?: number
  /** Maximum buffered JSON body for every `/api` request. Default: 300 MiB. */
  maxRequestBodyBytes?: number
  /**
   * Enforce the launch-token/cookie browser session. Default true. A
   * deployment sets this false only when an upstream layer this process
   * cannot see already authenticates every caller before the request reaches
   * here (for example, Cloudflare Access in front of a Container-hosted
   * profile) — the launch-token URL this process would print is unreachable
   * there, so the token exchange can never be satisfied.
   */
  requireBrowserSession?: boolean
  /**
   * Declare this non-loopback deployment safe to treat as reaching a
   * privileged Host process, for client-side surfaces that otherwise gate
   * Host-persistable behavior behind `ctx.connection.isLoopback` (for
   * example `dsh-ui-settings`'s decision to keep the Models Settings UI
   * writable). Default false. A deployment sets this true only on the exact
   * terms `requireBrowserSession: false` already documents: an upstream
   * layer this process cannot see verifies every caller before the request
   * reaches here at all (Cloudflare Access's signed JWT check in front of a
   * Container-hosted profile), so the browser's non-loopback origin no
   * longer implies an untrusted LAN caller the way it does for a plain
   * `dsh web` deployment bound to `0.0.0.0`. Setting this true without such
   * an upstream authenticator would let any caller who can reach this
   * process's origin write credentials through an otherwise Host-only
   * surface — do not set it true on trust alone.
   */
  trustedAsHost?: boolean
}

export const Config: z<ConnectionConfig> = z.object({
  trustedHosts: z.array(String).default([]),
  cookieMaxAgeDays: z.natural().min(1).default(30),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
  requireBrowserSession: z.boolean().default(true),
  trustedAsHost: z.boolean().default(false),
})

/**
 * Mounts the API gateway under the browser transport prefix. Every request on
 * the prefix passes the Host/Origin browser-trust fence and persistent browser
 * authentication before dispatch.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export async function apply(ctx: Context, config?: ConnectionConfig): Promise<void> {
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const trustedHosts = config?.trustedHosts ?? []
  const cookieMaxAgeDays = config?.cookieMaxAgeDays ?? 30
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  const requireBrowserSession = config?.requireBrowserSession ?? true
  const trustedAsHost = config?.trustedAsHost ?? false
  // Config boundary: a malformed entry fails the load loudly here rather than
  // silently authorizing its hostname prefix at request time.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  // Absent unless explicitly configured true: the served page carries no
  // trace of this row at all in the default (false) case, so there is
  // nothing for a browser to read even by accident.
  if (trustedAsHost) {
    ctx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: TRUSTED_AS_HOST_GLOBAL, value: true })
    })
  }
  const connection = new HostConnectionService(
    ctx,
    trustedHosts,
    await BrowserAuth.create(ctx.root, ctx.credentials, cookieMaxAgeDays, requireBrowserSession),
  )
  const fetchHandler = connection.createSharedFetchHandler(API_PATH)
  const route: WebRoute = {
    kind: 'prefix',
    path: API_PATH,
    handler: async (req, res) => {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        res.writeHead(rejection)
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      await bridge(req, res, fetchHandler, maxRequestBodyBytes)
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'client-connection: /api route')
  ctx.inject(['attachments'], (attachmentCtx) => {
    assertImageBodyCapacity(attachmentCtx, maxRequestBodyBytes)
  })
}

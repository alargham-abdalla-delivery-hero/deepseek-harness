/**
 * Container-backed Durable Object running the `dsh` Host for one Workspace.
 * `getContainer(env.HOST_CONTAINER, workspaceId)` gives session affinity:
 * every request naming a Workspace id reaches the same container instance,
 * restarting it from its ephemeral-disk-reset state when idle-stopped —
 * durable Workspace/session data lives in D1 (via the container's own
 * `dsh-storage-d1`/`dsh-session-persistence-d1`), not on this disk.
 * @module @deepseek-ai/cloudflare-worker/host-container
 */

import { Container } from '@cloudflare/containers'

/** Bindings this Durable Object reads at construction time. */
export interface Env {
  /** Cloudflare account id owning the D1 database (forwarded into the container as an env var). */
  readonly CLOUDFLARE_ACCOUNT_ID: string
  /** D1 database id (forwarded into the container as an env var). */
  readonly CLOUDFLARE_D1_DATABASE_ID: string
  /** Cloudflare API token authorizing D1 REST access (forwarded into the container as an env var). */
  readonly CLOUDFLARE_D1_API_TOKEN: string
  /**
   * This deployment's own public hostname (forwarded into the container as
   * an env var). The container binds all interfaces, so requests arrive with
   * this hostname in `Host`, not loopback — the Host/Origin trust fence in
   * `@deepseek-ai/dsh-client-connection` refuses every `/api` request whose
   * Host is neither loopback nor an explicitly configured trusted authority.
   */
  readonly CLOUDFLARE_WORKER_HOSTNAME: string
  /**
   * DeepSeek API key, forwarded into the container as an env var when set
   * (`wrangler secret put DEEPSEEK_API_KEY`). Optional: a Workspace with no
   * key configured still creates and persists Sessions, only failing the
   * specific turn that calls the model.
   */
  readonly DEEPSEEK_API_KEY?: string
  /**
   * Anthropic API key, forwarded into the container as an env var when set
   * (`wrangler secret put ANTHROPIC_API_KEY`). Optional, same as
   * {@link DEEPSEEK_API_KEY}; read by the `anthropic` pi-ai provider route
   * `dsh-cloudflare-app`'s config patch declares.
   */
  readonly ANTHROPIC_API_KEY?: string
}

/**
 * Bounded wait for the container's HTTP port before reporting a distinct
 * "starting" status. Confirmed against a real deployment: the container does
 * not stay resident across separate requests that each time out here — a
 * failed port check tears the instance down, so the next request starts a
 * fresh cold boot rather than resuming an already-progressing one. This
 * repository's full Cordis composition (`dsh --profile cloudflare`, ~1000
 * workspace packages) takes longer to cold-boot than a short window allows
 * for, so the window has to cover one real cold start, not just a health-check
 * poll interval.
 */
const PORT_READY_TIMEOUT_MS = 60_000

/**
 * The `dsh` Host container for one Workspace. `fetch` starts the container
 * (a no-op once already running) and forwards the request once its HTTP port
 * answers; a caller sees a distinct "starting" response during cold start
 * rather than an indefinitely pending request, and a distinct "failed"
 * response when the container could not start at all.
 */
export class HostContainer extends Container<Env> {
  defaultPort = 8080
  sleepAfter = '30m'

  /**
   * @param ctx - Durable Object lifecycle context.
   * @param env - Bindings forwarded into the container's own environment.
   */
  constructor(ctx: ConstructorParameters<typeof Container<Env>>[0], env: Env) {
    super(ctx, env)
    // Cloudflare Containers only accepts string env values; these become the
    // exact CLOUDFLARE_* variables dsh-cloudflare-app's startup guard and D1
    // backends read inside the container — never baked into the image.
    this.envVars = {
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_D1_DATABASE_ID: env.CLOUDFLARE_D1_DATABASE_ID,
      CLOUDFLARE_D1_API_TOKEN: env.CLOUDFLARE_D1_API_TOKEN,
      CLOUDFLARE_WORKER_HOSTNAME: env.CLOUDFLARE_WORKER_HOSTNAME,
      ...env.DEEPSEEK_API_KEY !== undefined && { DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY },
      ...env.ANTHROPIC_API_KEY !== undefined && { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY },
    }
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      await this.startAndWaitForPorts(this.defaultPort, { portReadyTimeoutMS: PORT_READY_TIMEOUT_MS })
    } catch (error) {
      return this.unavailableResponse(error)
    }
    return super.fetch(request)
  }

  /**
   * Classify a `startAndWaitForPorts` failure as a distinct "starting" or
   * "failed" response. `getState()`'s vocabulary has no "starting" status of
   * its own: `running`/`healthy` after a timed-out port wait means the
   * process exists but its port is not answering yet (cold start still in
   * progress), while `stopped`/`stopping`/`stopped_with_code` means the
   * container did not come up at all.
   */
  private async unavailableResponse(error: unknown): Promise<Response> {
    const state = await this.getState()
    if (state.status === 'running' || state.status === 'healthy') {
      return jsonResponse({ status: 'starting' }, 202)
    }
    return jsonResponse({ status: 'failed', reason: String(error) }, 502)
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

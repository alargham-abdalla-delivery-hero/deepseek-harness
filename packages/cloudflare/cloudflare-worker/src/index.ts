/**
 * Wrangler entrypoint: the Worker's default export plus the Durable Object
 * class `wrangler.jsonc`'s `durable_objects.bindings` names.
 * @module @deepseek-ai/dsh-cloudflare-worker
 */

import { handleRequest } from './gateway.ts'
import type { Env } from './gateway.ts'

export { HostContainer } from './host-container.ts'

/** The Worker's fetch handler: {@link handleRequest}. */
export default {
  fetch: handleRequest,
} satisfies ExportedHandler<Env>

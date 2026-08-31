/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-cloudflare-worker`.
 * Never bundled into the deployed Worker itself (wrangler's bundler only
 * follows `src/index.ts`'s import graph, which does not reach this file) —
 * it exists so this package participates in `verify-package-invariants`
 * alongside every other package in the workspace, even though it never
 * boots through Cordis at runtime.
 * @module @deepseek-ai/dsh-cloudflare-worker/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-cloudflare-worker'

/** Cordis companion plugin name. */
export const name = 'cloudflare-worker-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package is a Worker/Durable-Object deployable
 * with no Cordis-mounted event stream or mutable runtime data of its own;
 * its request-handling and lifecycle behavior are enforced by unit tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

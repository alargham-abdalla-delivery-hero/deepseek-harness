/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-cloudflare-app`.
 * @module @deepseek-ai/dsh-cloudflare-app/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-cloudflare-app'

/** Cordis companion plugin name. */
export const name = 'cloudflare-app-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the environment-variable check runs once at boot and
 * either succeeds or throws; there is no continuously observable in-process relation.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

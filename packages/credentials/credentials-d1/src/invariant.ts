/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-credentials-d1`.
 * @module @deepseek-ai/dsh-credentials-d1/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-credentials-d1'

/** Cordis companion plugin name. */
export const name = 'credentials-d1-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the schema-version check is an open-time read that
 * rejects before any operation runs, and durability needs the provider
 * round-trip tests against the fake D1 server, not a continuously observable
 * in-process relation this package could assert on.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

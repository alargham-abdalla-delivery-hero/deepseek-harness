/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-quick-actions`.
 * @module @deepseek-ai/dsh-client-ui-quick-actions/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-quick-actions'

/** Cordis companion plugin name. */
export const name = 'client-ui-quick-actions-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the registry is a browser-side plain array behind
 * register/dispose (disposal proven by the HMR-safety spec); it emits no
 * cordis events and owns no cross-plugin mutable state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */

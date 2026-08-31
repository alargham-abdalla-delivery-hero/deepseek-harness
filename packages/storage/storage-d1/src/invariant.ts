/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-storage-d1`.
 * @module @deepseek-ai/dsh-storage-d1/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-storage-d1'

/** Cordis companion plugin name. */
export const name = 'storage-d1-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: schema-version and unit-version consistency are
 * open-time checks that reject before a unit exists, and durability needs the
 * backend round-trip tests in the shared KV conformance suite; this package
 * exposes no continuously observable in-process relation.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

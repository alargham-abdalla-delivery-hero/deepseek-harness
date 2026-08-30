/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-openui`.
 * @module @deepseek-ai/dsh-tool-openui/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-openui'

/** Cordis companion plugin name. */
export const name = 'tool-openui-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this model-facing tool has no independent lifecycle stream or custom
 * durable event type; its `tool/result` persistence is owned by the tool-execution seam it calls.
 * The package's `agent/turn-stopping` self-correction listener reads the already-owned derived
 * session transcript and injects an ordinary `agent.steer()`-driven `user/message` event — owned
 * by the agent-loop/session infrastructure, not a new event type this package introduces.
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

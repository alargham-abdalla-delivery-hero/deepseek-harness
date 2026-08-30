/**
 * Register the `render_ui` keyed toolview: claims the `tool.call.toolview`
 * slot for `render_ui`, so a settled call renders through {@link RenderUiView}
 * instead of the generic fallback card. An unclaimed key (this plugin absent)
 * falls back to the generic card, exactly like any other tool.
 * @module @deepseek-ai/dsh-client-ui-openui/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RenderUiView } from './RenderUiView.tsx'

export const name = 'ui-openui'
export const inject = ['slots']

/**
 * Mount the `render_ui` keyed toolview registration.
 * @param ctx - Client root context carrying the slot registry.
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'render_ui' },
    RenderUiView,
  ))
}

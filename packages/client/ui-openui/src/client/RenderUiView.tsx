/**
 * The keyed `tool.call.toolview` for `render_ui`: renders the settled
 * result's persisted element tree (`result.meta`, projected verbatim by
 * `dsh-tool-openui`'s `output.presentationMeta`) instead of the generic
 * fallback card. Pure function of `owner.block` only — no I/O, no session
 * reads — so it reproduces identically on live streaming and replay.
 * @module @deepseek-ai/dsh-client-ui-openui/client/RenderUiView
 */

import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ValidationError } from '@deepseek-ai/dsh-openui-lang'
import { COMPONENTS } from './library.ts'
import { renderElement } from './render-element.tsx'

/** The shape `dsh-tool-openui`'s `presentationMeta` projects onto `result.meta`. */
interface RenderUiMeta {
  root: Parameters<typeof renderElement>[0] | null
  errors: readonly ValidationError[]
  incomplete: boolean
}

function isRenderUiMeta(value: unknown): value is RenderUiMeta {
  return typeof value === 'object' && value !== null && 'root' in value && 'errors' in value
}

/** Render `render_ui`'s pending state or its settled element tree / error list. */
export function RenderUiView({ block }: ToolCallViewProps) {
  if (!('meta' in block) || !isRenderUiMeta(block.meta)) {
    return <div data-openui-toolview="pending">Rendering UI…</div>
  }
  const { root, errors } = block.meta
  if (root === null && errors.length === 0) {
    return <div data-openui-toolview="errors">No renderable UI was produced.</div>
  }
  if (root === null || errors.length > 0) {
    return (
      <div data-openui-toolview="errors">
        {errors.map((error, index) => <p key={index}>{error.message}</p>)}
      </div>
    )
  }
  return <div data-openui-toolview="rendered">{renderElement(root, COMPONENTS)}</div>
}

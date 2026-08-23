/**
 * Model-facing `render_ui` tool: parses and validates one OpenUI Lang source
 * string against the shared curated component vocabulary
 * (`@deepseek-ai/dsh-openui-lang`) and contributes the matching system-prompt
 * grammar. A malformed or partially invalid source is a domain outcome the
 * model can read and retry — `execute` never throws for it; only a genuine
 * parser implementation failure does.
 * @module @deepseek-ai/dsh-tool-openui
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { parseSource, promptText } from '@deepseek-ai/dsh-openui-lang'
import type { OpenUIRenderResult } from '@deepseek-ai/dsh-openui-lang'

export const name = 'tool-openui'
export const inject = ['tools', 'systemPrompt']

const DESCRIPTION =
  'Render structured or visual content (a card, table, list, or heading layout) as UI in the '
  + 'chat, instead of describing it in prose. Send OpenUI Lang source text; the syntax and the '
  + 'available components are taught in a separate system instruction. On success the UI renders '
  + 'in the chat. On failure the result lists what to fix — correct the source and call again.'

/** The tool's canonical output shape: `OpenUIRenderResult`, projected through the `json`-typed schema leaves. */
type RenderUiOutput = { root: JsonValue; errors: JsonValue; incomplete: boolean }

/**
 * Summarize a settled `render_ui` result as one line of text for the model's
 * next turn: the rendered root component when parsing produced one cleanly,
 * otherwise the humanized validation errors so the model can self-correct.
 * The `json`-typed schema leaves erase `ElementNode`/`ValidationError`'s
 * specific shape for the registry; this reads back exactly what `execute`
 * produced, round-tripped through lossless JSON.
 * @param value - the tool's canonical result value.
 * @returns one line of model-facing confirmation or diagnostic text.
 */
function summarize(value: RenderUiOutput): string {
  const { root, errors, incomplete } = value as unknown as OpenUIRenderResult
  if (root !== null && errors.length === 0 && !incomplete) {
    return `Rendered a ${root.typeName} UI.`
  }
  if (errors.length > 0) {
    return `OpenUI Lang had ${errors.length} issue(s):\n${errors.map(error => `- ${error.message}`).join('\n')}`
  }
  return 'No renderable UI was produced — the source did not resolve to a root element.'
}

/**
 * Register the `render_ui` tool and its system-prompt grammar section.
 * @param ctx - the plugin context; registrations are effects scoped to it.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:render_ui',
    order: 105,
    text: promptText(),
  })

  ctx.tools.register(defineTool({
    name: 'render_ui',
    description: DESCRIPTION,
    parameters: {
      source: { type: 'string', required: true, description: 'OpenUI Lang source text (see the render_ui system instruction for syntax and components).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'json', required: true, description: 'The parsed root element tree, or null if no root resolved.' },
          errors: { type: 'json', required: true, description: 'Validation errors for any dropped or malformed element.' },
          incomplete: { type: 'boolean', required: true, description: 'True if the parser detected truncated/unparseable input.' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: summarize(value) }],
      // The canonical value already IS the durable card material — project it
      // verbatim so `dsh-client-ui-openui`'s keyed toolview can read the
      // element tree back from `result.meta` on both live and replayed turns,
      // without a second parse pass client-side (see design.md Decision 3/4).
      presentationMeta: (_args, value) => value,
    },
    execute(args): Promise<RenderUiOutput> {
      return Promise.resolve(parseSource(args.source) as unknown as RenderUiOutput)
    },
    presentCall(): GenericCallView {
      return { card: 'generic', title: 'Render UI', kind: 'other' }
    },
    presentResult(_args, result: ToolResult): GenericResultView | undefined {
      if (result.isError) return undefined
      return { card: 'generic', title: 'Render UI' }
    },
  }))
}

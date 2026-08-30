/**
 * Model-facing `render_ui` tool: parses and validates one OpenUI Lang source
 * string against the shared curated component vocabulary
 * (`@deepseek-ai/dsh-openui-lang`) and contributes the matching system-prompt
 * grammar. A malformed or partially invalid source is a domain outcome the
 * model can read and retry — `execute` never throws for it; only a genuine
 * parser implementation failure does. Also registers an `agent/turn-stopping`
 * listener that steers the model to retry via the tool if it writes
 * renderable OpenUI Lang directly as chat text instead of calling `render_ui`.
 * @module @deepseek-ai/dsh-tool-openui
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage, MessageSource } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { parseSource, promptText } from '@deepseek-ai/dsh-openui-lang'
import type { ElementNode, OpenUIRenderResult } from '@deepseek-ai/dsh-openui-lang'

export const name = 'tool-openui'
export const inject = ['tools', 'systemPrompt']

/**
 * Plugin config: `maxCorrectionAttempts` is a deployment-varying tunable
 * (repo convention: no hardcoded tunables in plugins), not a constant.
 */
export interface Config {
  /**
   * Maximum consecutive corrective steers issued for a model that keeps
   * writing OpenUI Lang directly as chat text instead of calling
   * `render_ui`, before the turn is allowed to close with its text answer
   * unrendered (default 2).
   */
  maxCorrectionAttempts?: number
}

export const Config: z<Config> = z.object({
  maxCorrectionAttempts: z.number().default(2),
})

const DESCRIPTION =
  'Render structured or visual content (a card, table, list, heading layout, bar chart, or pie '
  + 'chart) as UI in the chat, instead of describing it in prose. Use this whenever the user asks '
  + 'for a chart, graph, or visual breakdown of data — do not describe chart data in prose or a '
  + 'text table when a bar or pie chart is available and appropriate. Send OpenUI Lang source '
  + 'text; the syntax and the available components are taught in a separate system instruction. '
  + 'On success the UI renders in the chat. On failure the result lists what to fix — correct the '
  + 'source and call again.'

/**
 * Replaces `@openuidev/lang-core`'s default `promptText()` preamble, which is
 * written for OpenUI's own raw-completion architecture and states "Your
 * ENTIRE response must be valid openui-lang code — no markdown, no
 * explanations, just openui-lang" — verified directly against this repo's
 * installed `@openuidev/lang-core` by calling `promptText()` with no options.
 * Left unset, that default actively instructs the model to bypass this tool
 * and answer directly in the DSL, which is the opposite of this package's
 * contract.
 */
const PROMPT_PREAMBLE =
  'OpenUI Lang is a declarative UI language. Send it ONLY as the `source` argument to the '
  + '`render_ui` tool call — never write OpenUI Lang directly in your chat reply. Everything '
  + 'else (prose, other tool calls) works exactly as normal.'

/**
 * A small worked example of calling `render_ui` correctly, distinct from any
 * plausible real user request, appended to the system prompt via
 * `PromptOptions.examples` (renders unconditionally, independent of the
 * Query/Mutation sections this package does not enable).
 */
const USAGE_EXAMPLE =
  'root = Stack([card])\n'
  + 'card = Card([heading, table], "Usage Example")\n'
  + 'heading = Heading("Example Report", 2)\n'
  + 'table = Table(["Metric", "Value"], [["Uptime", "99.9%"], ["Errors", "0"]])\n\n'
  + 'Call render_ui with the text above as the `source` argument — do not write it as your reply.'

/** Curated component names whose presence marks a tree as worth correcting; a bare `Heading`/`Text` root alone does not. */
const NON_TRIVIAL_COMPONENTS = new Set(['Card', 'Table', 'List', 'BarChart', 'PieChart'])

/** Narrow an `ElementNode` prop value: only real element nodes carry `type: 'element'`. */
function isElementNode(value: unknown): value is ElementNode {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'element'
}

/** Walk a parsed element tree for at least one non-trivial curated component. */
function hasNonTrivialComponent(node: ElementNode): boolean {
  if (NON_TRIVIAL_COMPONENTS.has(node.typeName)) return true
  for (const propValue of Object.values(node.props)) {
    const candidates = Array.isArray(propValue) ? propValue : [propValue]
    for (const candidate of candidates) {
      if (isElementNode(candidate) && hasNonTrivialComponent(candidate)) return true
    }
  }
  return false
}

/**
 * Find text in a completed assistant message that reads as OpenUI Lang the
 * model wrote directly instead of routing through `render_ui`: it parses
 * cleanly (via the same `parseSource()` the tool itself calls — not a text
 * heuristic) to a non-trivial tree. `message` is never checked for a
 * `render_ui` tool-call block alongside the text: a message with ANY pending
 * tool call is never the last derived message when `agent/turn-stopping`
 * fires (the loop always defers turn closure to feed the tool result back
 * first — verified directly by driving the real agent loop with a tool call
 * in the same message, denied and undenied), so this function is only ever
 * called with a message that structurally cannot contain one.
 * @param message - the turn's candidate final assistant message.
 * @returns the offending source text, or `undefined` if nothing matches.
 */
function findUnroutedSource(message: AssistantMessage): string | undefined {
  for (const block of message.content) {
    if (block.type !== 'text') continue
    const { root, errors, incomplete } = parseSource(block.text)
    if (root !== null && errors.length === 0 && !incomplete && hasNonTrivialComponent(root)) {
      return block.text
    }
  }
  return undefined
}

/** Source stamped on every corrective steer this listener injects. */
const CORRECTION_SOURCE: MessageSource = { kind: 'plugin', plugin: 'tool-openui', form: 'notice', summary: 'render_ui correction' }

/** The corrective instruction steered back at the model, quoting its own unrouted source so it can resend it verbatim. */
function correctionText(source: string): string {
  return 'Your last reply wrote OpenUI Lang directly as chat text instead of calling render_ui:\n\n'
    + `${source}\n\n`
    + 'Resend this exact content as a render_ui tool call instead of writing it as prose.'
}

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
 * Register the `render_ui` tool, its system-prompt grammar section, and the
 * turn-completion listener that corrects a model writing OpenUI Lang
 * directly as chat text instead of calling the tool.
 * @param ctx - the plugin context; registrations are effects scoped to it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.systemPrompt.section({
    name: 'tool:render_ui',
    order: 105,
    text: promptText({ preamble: PROMPT_PREAMBLE, examples: [USAGE_EXAMPLE] }),
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

  const maxCorrectionAttempts = config.maxCorrectionAttempts as number
  if (!Number.isInteger(maxCorrectionAttempts) || maxCorrectionAttempts < 0) {
    throw new Error(`tool-openui: invalid maxCorrectionAttempts ${maxCorrectionAttempts} — must be a non-negative integer`)
  }

  // Per-agent count of consecutive corrections, so a model that keeps not
  // calling the tool cannot be steered indefinitely (bounded per Config).
  const correctionAttempts = new WeakMap<Agent, number>()

  ctx.on('agent/turn-stopping', ({ agent }): void => {
    const last = agent.session.deriveMessages().at(-1)
    if (!last || last.role !== 'assistant') return
    const unrouted = findUnroutedSource(last as AssistantMessage)
    if (!unrouted) {
      correctionAttempts.delete(agent)
      return
    }
    const attempts = correctionAttempts.get(agent) ?? 0
    if (attempts >= maxCorrectionAttempts) {
      correctionAttempts.delete(agent)
      return
    }
    correctionAttempts.set(agent, attempts + 1)
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: correctionText(unrouted) }],
      source: CORRECTION_SOURCE,
    }))
  })
}

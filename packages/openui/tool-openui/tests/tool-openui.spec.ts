/**
 * Integration: the real `render_ui` tool + a real `SystemPrompt`/`ToolRuntime`,
 * exercised through `ctx.tools.execute()` — nothing bypasses the tool registry.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as ToolOpenUI from '../src/index.ts'

const testToolSignal = new AbortController().signal
let callCounter = 0

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ToolOpenUI)
  return ctx
}

function callRenderUi(ctx: Context, source: string): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name: 'render_ui',
    arguments: { source },
  })
}

function text(result: ToolExecutionResult): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('dsh-tool-openui', () => {
  it('registers a render_ui tool with one required source string parameter', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'render_ui')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, { type: string }> }).properties ?? {}
    expect(Object.keys(props)).toEqual(['source'])
    expect(props.source?.type).toBe('string')
  })

  it('contributes the OpenUI Lang grammar to the system prompt', async () => {
    const ctx = await setup()
    const prompt = renderPrompt(await ctx.systemPrompt.assemble())
    expect(prompt).toContain('openui-lang')
    expect(prompt).toContain('Stack')
  })

  it('parses valid OpenUI Lang into a non-error result summarizing the root component', async () => {
    const ctx = await setup()
    const result = await callRenderUi(ctx, 'root = Stack([heading])\nheading = Heading("Hello")')
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('Rendered a Stack UI.')
  })

  it('projects the canonical value into result.meta so the client renderer can read the element tree', async () => {
    const ctx = await setup()
    const result = await callRenderUi(ctx, 'root = Stack([heading])\nheading = Heading("Hello")')
    const meta = result.meta as { root: { typeName: string }; errors: unknown[]; incomplete: boolean }
    expect(meta.root.typeName).toBe('Stack')
    expect(meta.errors).toEqual([])
    expect(meta.incomplete).toBe(false)
  })

  it('reports an unknown component as a non-error result the model can act on, never as isError', async () => {
    const ctx = await setup()
    const result = await callRenderUi(ctx, 'root = Stack([bogus])\nbogus = TotallyUnknown("x")')
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('issue(s)')
    expect(text(result)).toContain('TotallyUnknown')
  })

  it('reports unparseable source as a non-error result rather than throwing', async () => {
    const ctx = await setup()
    const result = await callRenderUi(ctx, 'not valid openui-lang {{{')
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('No renderable UI was produced')
  })

  it('presents a generic pending card and a generic completed card', async () => {
    const ctx = await setup()
    const tool = ctx.tools.get('render_ui')
    expect(tool?.presentCall?.({ source: 'x' })).toEqual({ card: 'generic', title: 'Render UI', kind: 'other' })
    const result = await callRenderUi(ctx, 'root = Stack([])')
    expect(tool?.presentResult?.({ source: 'root = Stack([])' }, result)).toEqual({ card: 'generic', title: 'Render UI' })
  })

  it('presents no card override for a genuine isError result, so the default error rendering applies', async () => {
    const ctx = await setup()
    const tool = ctx.tools.get('render_ui')
    const errorResult = { content: [{ type: 'text' as const, text: 'boom' }], isError: true as const }
    expect(tool?.presentResult?.({ source: 'x' }, errorResult)).toBeUndefined()
  })
})

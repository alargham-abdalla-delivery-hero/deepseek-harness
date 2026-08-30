/**
 * Integration: the real `render_ui` tool + a real `SystemPrompt`/`ToolRuntime`,
 * exercised through `ctx.tools.execute()` — nothing bypasses the tool registry.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as ToolOpenUI from '../src/index.ts'
import type { Config } from '../src/index.ts'

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
    callId: ToolCallId(`call-${++callCounter}`),
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

  it('no longer teaches the raw-completion instruction, and does teach the worked example', async () => {
    const ctx = await setup()
    const prompt = renderPrompt(await ctx.systemPrompt.assemble())
    expect(prompt).not.toContain('ENTIRE response')
    expect(prompt).toContain('render_ui')
    expect(prompt).toContain('Usage Example')
  })
})

/**
 * Behavior suite for the `agent/turn-stopping` self-correction listener:
 * driven through a real agent loop against a scripted mock adapter (no
 * network), since the detection reads the derived session transcript a unit
 * test on the bare function cannot exercise.
 */

const UNROUTED_SOURCE = 'root = Stack([card])\ncard = Card([heading], "Report")\nheading = Heading("Hi", 1)'
const TRIVIAL_SOURCE = 'root = Stack([t])\nt = Text("hello")'

/** Boot the core spine + the plugin under test; the caller registers the mock adapter. */
async function agentLoopHarness(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolOpenUI, config)
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } }) })
}

/** Every corrective steer this listener injected, as plain text, in order. */
function corrections(agent: Agent): string[] {
  return [...agent.session.events]
    .filter((e): e is SessionEvent<'user/message'> => e.type === 'user/message' && e.data.source.kind === 'plugin' && e.data.source.plugin === 'tool-openui')
    .map(e => e.data.content.map(block => block.type === 'text' ? block.text : '').join(''))
}

function go(agent: Agent): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
}

describe('agent/turn-stopping self-correction', () => {
  it('steers the model to retry via render_ui when it writes non-trivial OpenUI Lang as plain text', async () => {
    const ctx = await agentLoopHarness()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      textResponse(UNROUTED_SOURCE),
      toolCallResponse('c1', 'render_ui', { source: UNROUTED_SOURCE }),
      textResponse('Rendered it.'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    go(agent)
    await waitForIdle(ctx, agent)

    const found = corrections(agent)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('render_ui')
    expect(found[0]).toContain(UNROUTED_SOURCE)
  })

  it("does not inspect a mid-turn message that still has a pending tool call — only the turn's final message is checked", async () => {
    // A message with ANY pending tool call is never the last derived message
    // when `agent/turn-stopping` fires: the loop always defers turn closure
    // to feed that tool's result back to the model first (verified against
    // the real agent loop; see findUnroutedSource's doc comment).
    const ctx = await agentLoopHarness()
    ctx.tools.register(defineContentToolFixture({ name: 'other', description: 'o', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('c1', 'other', {}, UNROUTED_SOURCE),
      textResponse('done'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('a2b'), { provider: 'mock', model: 'mock' })
    go(agent)
    await waitForIdle(ctx, agent)

    expect(corrections(agent)).toHaveLength(0)
  })

  it('does not steer when the derived transcript has no trailing assistant message (empty max-tokens step)', async () => {
    const ctx = await agentLoopHarness()
    const emptyStep: StreamChunk[] = [
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 0 } },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ]
    ctx.llm.registerAdapter(['mock'], new MockAdapter([emptyStep]))
    const agent = ctx.agentLoop.create(SessionId('a2c'), { provider: 'mock', model: 'mock' })
    go(agent)
    await waitForIdle(ctx, agent)

    expect(corrections(agent)).toHaveLength(0)
  })

  it('steers when the offending text follows a leading reasoning block', async () => {
    const ctx = await agentLoopHarness()
    const reasoningThenText: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'thinking…' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'thinking…' } },
      ...textResponse(UNROUTED_SOURCE).map(chunk => chunk.type === 'block-start' || chunk.type === 'text-delta' || chunk.type === 'block-end' ? { ...chunk, index: 1 } : chunk),
    ]
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      reasoningThenText,
      toolCallResponse('c1', 'render_ui', { source: UNROUTED_SOURCE }),
      textResponse('done'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('a2d'), { provider: 'mock', model: 'mock' })
    go(agent)
    await waitForIdle(ctx, agent)

    expect(corrections(agent)).toHaveLength(1)
  })

  it('does not steer when the text fails to parse cleanly', async () => {
    const ctx = await agentLoopHarness()
    const adapter = new MockAdapter([textResponse('this is not valid openui-lang {{{')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a3'), { provider: 'mock', model: 'mock' })
    go(agent)
    await waitForIdle(ctx, agent)

    expect(corrections(agent)).toHaveLength(0)
    expect(adapter.requests).toHaveLength(1)
  })

  it('does not steer for a trivial root using only Text/Heading', async () => {
    const ctx = await agentLoopHarness()
    const adapter = new MockAdapter([textResponse(TRIVIAL_SOURCE)])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a4'), { provider: 'mock', model: 'mock' })
    go(agent)
    await waitForIdle(ctx, agent)

    expect(corrections(agent)).toHaveLength(0)
    expect(adapter.requests).toHaveLength(1)
  })

  it('stops steering once maxCorrectionAttempts is reached, letting the turn close', async () => {
    const ctx = await agentLoopHarness({ maxCorrectionAttempts: 1 })
    const adapter = new MockAdapter([
      textResponse(UNROUTED_SOURCE),
      textResponse(UNROUTED_SOURCE),
      textResponse(UNROUTED_SOURCE),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a5'), { provider: 'mock', model: 'mock' })
    go(agent)
    await waitForIdle(ctx, agent)

    expect(corrections(agent)).toHaveLength(1)
    expect(adapter.requests).toHaveLength(2)
  })

  it('fails loud on an invalid maxCorrectionAttempts', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await expect(ctx.plugin(ToolOpenUI, { maxCorrectionAttempts: -1 })).rejects.toThrow('maxCorrectionAttempts')
  })

  it('disposing the plugin fiber removes the turn-stopping listener (HMR-safety)', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    const fiber = await ctx.plugin(ToolOpenUI)
    await fiber.dispose()

    const adapter = new MockAdapter([textResponse(UNROUTED_SOURCE)])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a6'), { provider: 'mock', model: 'mock' })
    go(agent)
    await waitForIdle(ctx, agent)

    expect(corrections(agent)).toHaveLength(0)
    expect(ctx.tools.get('render_ui')).toBeUndefined()
  })
})

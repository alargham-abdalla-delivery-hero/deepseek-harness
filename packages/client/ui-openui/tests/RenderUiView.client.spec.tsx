// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { RenderUiView } from '../src/client/RenderUiView.tsx'

afterEach(cleanup)

const running = (): RunningToolCall => ({
  callId: 'c1', name: 'render_ui', argsRaw: '{"source":"root = Stack([])"}',
  turn: 1, step: 1, time: 1_000, callView: { card: 'generic', title: 'Render UI', kind: 'other' }, subCalls: [],
})

const settled = (over: Partial<ToolResultNode> = {}): ToolResultNode => ({
  kind: 'tool-result', seq: 1, time: 2_000, callId: 'c1',
  call: { name: 'render_ui', argsRaw: '{"source":"root = Stack([])"}' },
  callTime: 1_000,
  content: [{ type: 'text', text: 'Rendered a Stack UI.' }],
  isError: false,
  callView: { card: 'generic', title: 'Render UI', kind: 'other' },
  resultView: { card: 'generic', title: 'Render UI' },
  subCalls: [],
  ...over,
})

const props = (block: RunningToolCall | ToolResultNode): ToolCallViewProps =>
  ({ block } as unknown as ToolCallViewProps)

describe('RenderUiView', () => {
  it('shows a pending state for a running call, which carries no meta', () => {
    const view = render(<RenderUiView {...props(running())} />)
    expect(view.getByText('Rendering UI…')).toBeTruthy()
  })

  it('renders the element tree from a settled result.meta', () => {
    const view = render(<RenderUiView {...props(settled({
      meta: { root: { type: 'element', typeName: 'Heading', props: { text: 'Hi' }, partial: false }, errors: [], incomplete: false },
    }))} />)
    expect(view.getByText('Hi').tagName).toBe('H2')
  })

  it('renders validation error messages instead of a tree when errors are present', () => {
    const view = render(<RenderUiView {...props(settled({
      meta: {
        root: { type: 'element', typeName: 'Stack', props: { children: [] }, partial: false },
        errors: [{ code: 'unknown-component', component: 'Bogus', path: '', message: 'Unknown component "Bogus"' }],
        incomplete: false,
      },
    }))} />)
    expect(view.getByText('Unknown component "Bogus"')).toBeTruthy()
  })

  it('renders an error state when root is null even with no errors (unparseable source)', () => {
    const view = render(<RenderUiView {...props(settled({
      meta: { root: null, errors: [], incomplete: true },
    }))} />)
    expect(view.container.querySelector('[data-openui-toolview="errors"]')).not.toBeNull()
  })

  it('falls back to pending when meta is absent or malformed on a settled node', () => {
    const view = render(<RenderUiView {...props(settled({ meta: undefined }))} />)
    expect(view.getByText('Rendering UI…')).toBeTruthy()
  })
})

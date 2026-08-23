import { describe, expect, it } from 'vitest'
import { buildLibrary, parseSource, promptText } from '../src/index.ts'
import type { ComponentRenderers } from '../src/types.ts'

describe('buildLibrary', () => {
  it('builds the same component graph regardless of the renderer payload type', () => {
    const serverRenderers: ComponentRenderers<undefined> = {
      Heading: undefined, Text: undefined, ListItem: undefined, List: undefined, Table: undefined, Card: undefined, Stack: undefined,
    }
    const clientRenderers: ComponentRenderers<string> = {
      Heading: 'Heading', Text: 'Text', ListItem: 'ListItem', List: 'List', Table: 'Table', Card: 'Card', Stack: 'Stack',
    }
    const server = buildLibrary(serverRenderers)
    const client = buildLibrary(clientRenderers)
    expect(Object.keys(server.components).sort()).toEqual(Object.keys(client.components).sort())
    expect(server.root).toBe('Stack')
    expect(client.root).toBe('Stack')
  })
})

describe('promptText', () => {
  it('documents every curated component in the generated grammar', () => {
    const text = promptText()
    for (const name of ['Stack', 'Card', 'Heading', 'Text', 'List', 'Table']) {
      expect(text).toContain(name)
    }
  })
})

describe('parseSource', () => {
  it('parses valid positional OpenUI Lang into a non-null root with no errors', () => {
    const result = parseSource(`
root = Stack([card])
card = Card([heading, text], "My Card")
heading = Heading("Hello", 1)
text = Text("World")
`)
    expect(result.errors).toEqual([])
    expect(result.incomplete).toBe(false)
    expect(result.root).not.toBeNull()
    expect(result.root?.typeName).toBe('Stack')
  })

  it('drops an unknown component and reports it as a validation error instead of throwing', () => {
    const result = parseSource(`
root = Stack([bogus])
bogus = TotallyUnknown("x")
`)
    expect(result.root).not.toBeNull()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ code: 'unknown-component', component: 'TotallyUnknown' })
  })

  it('reports a missing required prop as a validation error, not a thrown error', () => {
    const result = parseSource(`
root = Stack([heading])
heading = Heading()
`)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ code: 'missing-required', component: 'Heading', path: '/text' })
  })

  it('returns a null root with incomplete=true for unparseable source, without throwing', () => {
    const result = parseSource('this is not valid openui-lang syntax {{{')
    expect(result.root).toBeNull()
    expect(result.incomplete).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('returns a null root with incomplete=true for empty source', () => {
    const result = parseSource('')
    expect(result.root).toBeNull()
    expect(result.incomplete).toBe(true)
  })
})

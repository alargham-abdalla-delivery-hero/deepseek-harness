// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ElementNode } from '@deepseek-ai/dsh-openui-lang'
import { COMPONENTS } from '../src/client/library.ts'
import { renderElement } from '../src/client/render-element.tsx'

afterEach(cleanup)

const heading = (text: string): ElementNode => ({
  type: 'element', typeName: 'Heading', props: { text }, partial: false, statementId: 'heading',
})

describe('renderElement', () => {
  it('renders a leaf component via its curated React implementation', () => {
    const view = render(<>{renderElement(heading('Hello'), COMPONENTS)}</>)
    expect(view.getByText('Hello').tagName).toBe('H2')
  })

  it('recursively renders sub-component array props (Card children)', () => {
    const card: ElementNode = {
      type: 'element',
      typeName: 'Card',
      statementId: 'card',
      partial: false,
      props: {
        title: 'My Card',
        children: [
          { type: 'element', typeName: 'Heading', props: { text: 'Hi' }, partial: false },
          { type: 'element', typeName: 'Text', props: { text: 'there' }, partial: false },
        ],
      },
    }
    const view = render(<>{renderElement(card, COMPONENTS)}</>)
    expect(view.getByText('My Card').tagName).toBe('H3')
    expect(view.getByText('Hi').tagName).toBe('H2')
    expect(view.getByText('there').tagName).toBe('P')
  })

  it('renders a visible fallback for a component outside the curated set, instead of dropping or throwing', () => {
    const unknown: ElementNode = {
      type: 'element', typeName: 'TotallyUnknown', props: {}, partial: false,
    }
    const view = render(<>{renderElement(unknown, COMPONENTS)}</>)
    expect(view.getByText('Unsupported UI element: TotallyUnknown')).toBeTruthy()
  })

  it('renders a Table with plain-text columns and rows', () => {
    const table: ElementNode = {
      type: 'element',
      typeName: 'Table',
      partial: false,
      props: { columns: ['A', 'B'], rows: [['1', '2']] },
    }
    const view = render(<>{renderElement(table, COMPONENTS)}</>)
    expect(view.getByText('A').tagName).toBe('TH')
    expect(view.getByText('1').tagName).toBe('TD')
  })

  it('renders a Stack root of its already-rendered children', () => {
    const stack: ElementNode = {
      type: 'element',
      typeName: 'Stack',
      statementId: 'root',
      partial: false,
      props: {
        children: [
          { type: 'element', typeName: 'Text', props: { text: 'inside a stack' }, partial: false },
        ],
      },
    }
    const view = render(<>{renderElement(stack, COMPONENTS)}</>)
    expect(view.container.querySelector('[data-openui-component="Stack"]')).not.toBeNull()
    expect(view.getByText('inside a stack').tagName).toBe('P')
  })

  it('renders a List of ListItems', () => {
    const list: ElementNode = {
      type: 'element',
      typeName: 'List',
      partial: false,
      props: {
        items: [
          { type: 'element', typeName: 'ListItem', props: { text: 'one' }, partial: false },
          { type: 'element', typeName: 'ListItem', props: { text: 'two' }, partial: false },
        ],
      },
    }
    const view = render(<>{renderElement(list, COMPONENTS)}</>)
    expect(view.getByText('one').tagName).toBe('LI')
    expect(view.getByText('two').tagName).toBe('LI')
  })
})

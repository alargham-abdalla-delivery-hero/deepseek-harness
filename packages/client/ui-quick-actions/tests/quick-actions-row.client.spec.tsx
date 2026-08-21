// @vitest-environment jsdom
/**
 * QuickActionsRow rendering spec, props-direct (QueueDock/GoalDock
 * precedent): the three default buttons plus "More" render, a row-button
 * click writes the entry's insertText through inputActions.setDraft without
 * submitting, a plugin-registered overflow entry surfaces in the "More"
 * menu, and the busy input phases disable every control.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { QuickActionsRow, type QuickActionsRowProps } from '../src/client/QuickActionsRow.tsx'
import type { QuickActionEntry, QuickActionsSnapshot } from '../src/client/contract.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en)

const DEFAULT_ENTRIES: readonly QuickActionEntry[] = [
  { id: 'lead-generation', label: 'Lead generation', insertText: 'Pull a lead-generation list for ', order: 0 },
  { id: 'income-statements', label: 'Income Statements', insertText: 'Generate an income statement for ', order: 10 },
  { id: 'balance-sheet', label: 'Balance sheet', insertText: 'Generate a balance sheet for ', order: 20 },
]

function inputState(phase: 'plain' | 'adjudicating' | 'submitting' = 'plain') {
  return { draft: '', imageIds: [], draftRev: 0, phase, occurrences: [], queue: [] }
}

function mount(entries: QuickActionsSnapshot, phase: 'plain' | 'adjudicating' | 'submitting' = 'plain') {
  const store = createSnapshotStore<QuickActionsSnapshot>(entries)
  const setDraft = vi.fn()
  const props = {
    entries: store,
    input: inputState(phase),
    inputActions: { setDraft, addImages: () => false, removeImage: () => {}, pruneImages: () => {}, submit: () => {} },
    t,
  } as unknown as QuickActionsRowProps
  const view = render(<QuickActionsRow {...props} />)
  return { store, setDraft, view }
}

describe('QuickActionsRow', () => {
  it('renders the three default buttons followed by "More"', () => {
    mount({ visible: DEFAULT_ENTRIES, overflow: [] })
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['Lead generation', 'Income Statements', 'Balance sheet', 'More'])
  })

  it('renders nothing while the registry is empty', () => {
    const { view } = mount({ visible: [], overflow: [] })
    expect(view.container.childElementCount).toBe(0)
  })

  it('clicking a default button writes its insertText and does not submit', () => {
    const { setDraft } = mount({ visible: DEFAULT_ENTRIES, overflow: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Balance sheet' }))
    expect(setDraft).toHaveBeenCalledExactlyOnceWith('Generate a balance sheet for ')
  })

  it('a plugin-registered overflow entry appears in the "More" menu and selecting it writes the draft', () => {
    const extra: QuickActionEntry = { id: 'extra', label: 'Extra action', insertText: 'extra ', overflow: true, order: 0 }
    const { setDraft } = mount({ visible: DEFAULT_ENTRIES, overflow: [extra] })
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menuitem', { name: 'Extra action' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Extra action' }))
    expect(setDraft).toHaveBeenCalledExactlyOnceWith('extra ')
    // The menu closes on selection.
    expect(screen.queryByRole('menuitem', { name: 'Extra action' })).toBeNull()
  })

  it('disables every control while the composer is adjudicating or submitting', () => {
    mount({ visible: DEFAULT_ENTRIES, overflow: [] }, 'submitting')
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('a disabled button click never writes the draft', () => {
    const { setDraft } = mount({ visible: DEFAULT_ENTRIES, overflow: [] }, 'adjudicating')
    fireEvent.click(screen.getByRole('button', { name: 'Lead generation' }))
    expect(setDraft).not.toHaveBeenCalled()
  })
})

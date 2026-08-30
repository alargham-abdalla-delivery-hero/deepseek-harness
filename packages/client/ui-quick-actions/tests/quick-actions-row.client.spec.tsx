// @vitest-environment jsdom
/**
 * QuickActionsRow rendering spec, props-direct (QueueDock/GoalDock
 * precedent). jsdom has no layout engine, so every button's measured width
 * comes from a mocked `getBoundingClientRect` (keyed by its text) and the
 * row's available width from a mocked `clientWidth` (AppFrame's
 * ResizeObserver-stub convention — see app-frame.client.spec.tsx): fully
 * fitting entries render with no "More", a too-narrow row spills its tail
 * into "More" alongside any registry-pinned overflow entry, a click writes
 * the entry's insertText through `inputActions.setDraft` without
 * submitting, and the busy input phases disable every control.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { fitVisibleCount, QuickActionsRow, type QuickActionsRowProps } from '../src/client/QuickActionsRow.tsx'
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

/** Observer stub: captures the callback so a test can fire a resize manually (AppFrame precedent). */
let fireResize: (() => void) | null = null
class ResizeObserverStub {
  #cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) { this.#cb = cb }
  observe(): void { fireResize = () => { this.#cb([], this) } }
  unobserve(): void {}
  disconnect(): void { fireResize = null }
}

let containerWidth = 1_000
/** Per-label measured width; unlisted labels (including "More") default to 100. */
let widths: Record<string, number> = {}

beforeEach(() => {
  containerWidth = 1_000
  widths = {}
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const width = widths[this.textContent ?? ''] ?? 100
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }
  })
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return containerWidth },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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

describe('fitVisibleCount', () => {
  it('fits every entry when the row has room, reserving nothing once nothing remains', () => {
    // 3 entries @100 + 2 gaps@8 = 316; "More" (last width) irrelevant once nothing spills.
    expect(fitVisibleCount([100, 100, 100, 60], 316, 0)).toBe(3)
  })

  it('reserves "More" width while any later entry or pinned overflow could still spill', () => {
    // Only entry 0 fits once "More" (60) + its gap are reserved for the remaining entries.
    expect(fitVisibleCount([100, 100, 100, 60], 168, 0)).toBe(1)
  })

  it('a pinned-overflow entry keeps the reservation even once every visible entry would fit alone', () => {
    // Exactly 2 entries' bare width fits (208), but pinnedCount > 0 keeps "More" reserved,
    // and reserving it no longer leaves room for the second entry.
    expect(fitVisibleCount([100, 100, 60], 208, 1)).toBe(1)
  })

  it('always keeps at least one entry, even if it does not fit', () => {
    expect(fitVisibleCount([100, 60], 10, 0)).toBe(1)
  })
})

describe('QuickActionsRow', () => {
  it('renders every entry directly, with no "More", when the row has room and nothing is pinned', () => {
    mount({ visible: DEFAULT_ENTRIES, overflow: [] })
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['Lead generation', 'Income Statements', 'Balance sheet'])
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  })

  it('renders "More" for a registry-pinned entry even when every visible entry fits', () => {
    const extra: QuickActionEntry = { id: 'extra', label: 'Extra action', insertText: 'extra ', overflow: true, order: 0 }
    mount({ visible: DEFAULT_ENTRIES, overflow: [extra] })
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['Lead generation', 'Income Statements', 'Balance sheet', 'More'])
  })

  it('renders nothing while the registry is empty', () => {
    const { view } = mount({ visible: [], overflow: [] })
    expect(view.container.childElementCount).toBe(0)
  })

  it('spills the tail of the row into "More" once the container is too narrow to fit every entry', () => {
    // 3 entries @100, gap 8, "More" @60: room for one entry plus the reserved "More".
    containerWidth = 176
    mount({ visible: DEFAULT_ENTRIES, overflow: [] })
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['Lead generation', 'More'])
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menuitem', { name: 'Income Statements' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Balance sheet' })).toBeTruthy()
  })

  it('recomputes the cutoff when the row is resized', () => {
    containerWidth = 176
    mount({ visible: DEFAULT_ENTRIES, overflow: [] })
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Lead generation', 'More'])

    containerWidth = 1_000
    act(() => { fireResize?.() })
    expect(screen.getAllByRole('button').map(b => b.textContent))
      .toEqual(['Lead generation', 'Income Statements', 'Balance sheet'])
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
    const extra: QuickActionEntry = { id: 'extra', label: 'Extra action', insertText: 'extra ', overflow: true, order: 0 }
    mount({ visible: DEFAULT_ENTRIES, overflow: [extra] }, 'submitting')
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('a disabled button click never writes the draft', () => {
    const { setDraft } = mount({ visible: DEFAULT_ENTRIES, overflow: [] }, 'adjudicating')
    fireEvent.click(screen.getByRole('button', { name: 'Lead generation' }))
    expect(setDraft).not.toHaveBeenCalled()
  })
})

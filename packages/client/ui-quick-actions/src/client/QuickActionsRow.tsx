/**
 * QuickActionsRow: the composer-adjacent row of one-click quick-action
 * buttons, registered into `conversation.composer.dock` — the band under
 * the composer card, ahead of the stats line (QueueDock/GoalBar posture —
 * a plain registrant component, no separate slots.ts). The registry's
 * `overflow`-flagged entries always land in the "More" menu; any
 * `visible`-flagged entry that does not fit the measured row width spills
 * into that same menu, so "More" itself only renders once something is
 * actually hidden. Selecting any entry writes its `insertText` into the
 * composer draft through `inputActions.setDraft` (the same face a user
 * typing text would use) and never submits.
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { QuickActionEntry, QuickActionsSnapshot } from './contract.ts'
import css from './QuickActionsRow.module.css'

/** Injected business face of the quick-actions dock entry: the live registry split. */
export interface QuickActionsRowInjected {
  /** Visible/overflow split (see {@link QuickActionsSnapshot}); the row subscribes directly (menu-store precedent). */
  readonly entries: SnapshotStore<QuickActionsSnapshot>
}

/** Full props: injected registry share + InputZone owner share + session standard kit + the locale seat. */
export type QuickActionsRowProps =
  QuickActionsRowInjected & PropsRuntime<'conversation.composer.dock'> & PropsLocale<'quickActions'>

/** Gap between adjacent buttons (`QuickActionsRow.module.css`'s `.row`/`.measure` gap, kept in sync by hand). */
const ROW_GAP = 8

/**
 * How many leading `visible` entries fit before a trailing "More" trigger,
 * given each candidate's natural width (last entry is the "More" button
 * itself) and the row's available content width. Reserves room for "More"
 * whenever anything — a later visible entry or a pinned-overflow one — would
 * still need it; a full fit reserves nothing so "More" can disappear.
 * @param widths - natural widths of each `visible` entry in order, then the "More" button's own width.
 * @param available - the row container's content width.
 * @param pinnedCount - registry entries already flagged `overflow` (always menu-bound).
 * @returns the count of `visible` entries to render as buttons.
 */
export function fitVisibleCount(widths: readonly number[], available: number, pinnedCount: number): number {
  const moreWidth = widths.at(-1) ?? 0
  const entryCount = widths.length - 1
  let used = 0
  let count = 0
  for (let index = 0; index < entryCount; index += 1) {
    const width = widths[index] ?? 0
    const next = count === 0 ? width : used + ROW_GAP + width
    const spillsRemain = count < entryCount - 1 || pinnedCount > 0
    const budget = spillsRemain ? available - ROW_GAP - moreWidth : available
    if (next > budget && count > 0) break
    used = next
    count += 1
  }
  return count
}

/**
 * The quick-actions dock entry: a row of buttons plus a "More" overflow
 * menu, rendered only once something spills. Renders nothing while the
 * registry is empty.
 */
export function QuickActionsRow({ entries, input, inputActions, t }: QuickActionsRowProps) {
  const { visible, overflow: pinned } = useSyncExternalStore(
    fn => entries.subscribe(fn),
    () => entries.getSnapshot(),
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const moreAnchorRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [fitCount, setFitCount] = useState(visible.length)
  // InputZone carries no separate blocked/disabled field for `.dock` entries
  // (that owner share is composer-bar-specific); busy phases are the same
  // signal InputBar derives from InputState alone (its own `machineBusy`).
  const disabled = input.phase === 'adjudicating' || input.phase === 'submitting'
  const moreLabel = t('more')

  // Measure every `visible` entry's natural width plus a same-styled "More"
  // button off-screen (`.measure`), then decide the cutoff before paint —
  // no flash of the wrong buttons — and again whenever the row resizes.
  useLayoutEffect(() => {
    const container = containerRef.current
    const probe = measureRef.current
    if (container === null || probe === null) return
    const recompute = (): void => {
      const widths = [...probe.children].map(el => (el as HTMLElement).getBoundingClientRect().width)
      setFitCount(fitVisibleCount(widths, container.clientWidth, pinned.length))
    }
    recompute()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(recompute)
    observer.observe(container)
    return () => { observer.disconnect() }
  }, [visible, pinned, moreLabel])

  if (visible.length === 0 && pinned.length === 0) return null

  const select = (entry: QuickActionEntry): void => {
    inputActions.setDraft(entry.insertText)
  }

  const shown = visible.slice(0, fitCount)
  const overflowed = [...visible.slice(fitCount), ...pinned]
  const menuItems: MenuItem[] = overflowed.map(entry => ({ id: entry.id, label: entry.label, disabled }))

  return (
    <div ref={containerRef} className={css.row} role="group" aria-label={t('row.aria')}>
      {shown.map(entry => (
        <Button
          key={entry.id}
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => { select(entry) }}
        >
          {entry.label}
        </Button>
      ))}
      {overflowed.length > 0 && (
        <Menu
          open={menuOpen}
          portal
          side="right"
          getAnchorRect={() => moreAnchorRef.current?.getBoundingClientRect() ?? null}
          anchor={
            <span ref={moreAnchorRef}>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => { setMenuOpen(open => !open) }}
              >
                {moreLabel}
              </Button>
            </span>
          }
          items={menuItems}
          onSelect={(id) => {
            setMenuOpen(false)
            const entry = overflowed.find(candidate => candidate.id === id)
            if (entry !== undefined) select(entry)
          }}
          onClose={() => { setMenuOpen(false) }}
        />
      )}
      <div ref={measureRef} className={css.measure} aria-hidden="true">
        {visible.map(entry => (
          <Button key={entry.id} variant="outline" size="sm">{entry.label}</Button>
        ))}
        <Button variant="outline" size="sm">{moreLabel}</Button>
      </div>
    </div>
  )
}

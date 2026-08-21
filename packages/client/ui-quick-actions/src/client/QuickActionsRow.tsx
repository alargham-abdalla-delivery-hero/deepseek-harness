/**
 * QuickActionsRow: the composer-adjacent row of one-click quick-action
 * buttons, registered into `conversation.input.dock` (QueueDock/GoalBar
 * posture — a plain registrant component, no separate slots.ts). Visible
 * entries render as buttons; overflow entries open through the shared Menu
 * primitive, side-anchored to the trailing "More" button. Selecting any
 * entry writes its `insertText` into the composer draft through
 * `inputActions.setDraft` (the same face a user typing text would use) and
 * never submits.
 */
import { useRef, useState, useSyncExternalStore } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
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
  QuickActionsRowInjected & PropsRuntime<'conversation.input.dock'> & PropsLocale<'quickActions'>

/**
 * The quick-actions dock entry: a row of buttons plus a trailing "More"
 * overflow menu. Renders nothing while the registry is empty.
 */
export function QuickActionsRow({ entries, input, inputActions, t }: QuickActionsRowProps) {
  const { visible, overflow } = useSyncExternalStore(
    fn => entries.subscribe(fn),
    () => entries.getSnapshot(),
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const moreAnchorRef = useRef<HTMLSpanElement>(null)
  // InputZone carries no separate blocked/disabled field for `.dock` entries
  // (that owner share is composer-bar-specific); busy phases are the same
  // signal InputBar derives from InputState alone (its own `machineBusy`).
  const disabled = input.phase === 'adjudicating' || input.phase === 'submitting'

  if (visible.length === 0 && overflow.length === 0) return null

  const select = (entry: QuickActionEntry): void => {
    inputActions.setDraft(entry.insertText)
  }

  const menuItems: MenuItem[] = overflow.map(entry => ({ id: entry.id, label: entry.label, disabled }))

  return (
    <div className={css.row} role="group" aria-label={t('row.aria')}>
      {visible.map(entry => (
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
              {t('more')}
            </Button>
          </span>
        }
        items={menuItems}
        onSelect={(id) => {
          setMenuOpen(false)
          const entry = overflow.find(candidate => candidate.id === id)
          if (entry !== undefined) select(entry)
        }}
        onClose={() => { setMenuOpen(false) }}
      />
    </div>
  )
}

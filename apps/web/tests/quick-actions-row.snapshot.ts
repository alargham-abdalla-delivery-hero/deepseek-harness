// @vitest-environment jsdom
// Assembled quick-actions snapshot: boots the real built `packages/client/*/
// lib/client.js` bundles through AppWebEntry's ModuleLoader path against the
// keyless FixtureApiClient transport, opens a fresh fixture session, and pins
// the composer-dock row this plugin ships by default — the visible buttons
// plus the trailing "More" button, in that order — then proves a row-button
// click and a "More" menu-item click both write the entry's insertText into
// the composer draft without submitting.
//
// jsdom has no layout engine, so the row's own responsive-overflow
// measurement (real widths via getBoundingClientRect/clientWidth) sees only
// zeros; a generously wide mock stands in for the desktop viewport this
// scenario represents (quick-actions-row.client.spec.tsx pins the actual
// measurement/cutoff arithmetic at the unit level).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/web/tests/snapshots/quick-actions-row/default-row.expected.txt')

installAssembledBootEnv()

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width: 80, height: 0, top: 0, left: 0, right: 80, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  )
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { configurable: true, get: () => 5_000 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Normalize the dock row to its button labels, in document order, excluding the hidden measurement probe. */
function rowShape(row: Element): string {
  return [...row.querySelectorAll('button')]
    .filter(button => button.closest('[aria-hidden="true"]') === null)
    .map(button => `button=${button.textContent?.trim()}`).join('\n')
}

describe('assembled quick-actions row', () => {
  it('renders the default buttons plus "More", and a click fills the draft without submitting', async () => {
    mountAssembledApp()

    const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
    const start = tree.querySelector<HTMLButtonElement>('button[aria-label="New session in fixture"]')
    if (start === null) throw new Error('fixture Workspace new-session action missing')
    fireEvent.click(start)

    const textarea = await screen.findByPlaceholderText('Describe what you want to build', {}, { timeout: 10_000 })
    const row = await screen.findByRole('group', { name: 'Quick actions' }, { timeout: 10_000 })

    const shape = rowShape(row)
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)

    fireEvent.click(within(row).getByRole('button', { name: 'Balance sheet' }))
    // The draft holds the inserted text; a submit would have cleared it back
    // to empty, so a non-empty match also proves the click never submitted.
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('Generate a balance sheet for ')
    })

    // The "More" menu lists the overflow entries; selecting one closes the
    // menu and fills the draft the same way a row button does.
    fireEvent.click(within(row).getByRole('button', { name: 'More' }))
    const menuItem = await screen.findByRole('menuitem', { name: 'Market Research' }, { timeout: 10_000 })
    fireEvent.click(menuItem)
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('Pull market research on ')
    })
    expect(screen.queryByRole('menuitem', { name: 'Market Research' })).toBeNull()
  })
})

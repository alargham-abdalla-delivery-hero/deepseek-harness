// @vitest-environment jsdom
// Assembled quick-actions snapshot: boots the real built `packages/client/*/
// lib/client.js` bundles through AppWebEntry's ModuleLoader path against the
// keyless FixtureApiClient transport, opens a fresh fixture session, and pins
// the composer-dock row this plugin ships by default — the three named
// buttons plus the trailing "More" button, in that order — then proves a
// click writes the entry's insertText into the composer draft without
// submitting.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/web/tests/snapshots/quick-actions-row/default-row.expected.txt')

installAssembledBootEnv()

/** Normalize the dock row to its button labels, in document order. */
function rowShape(row: Element): string {
  return [...row.querySelectorAll('button')].map(button => `button=${button.textContent?.trim()}`).join('\n')
}

describe('assembled quick-actions row', () => {
  it('renders the three default buttons plus "More", and a click fills the draft without submitting', async () => {
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
  })
})

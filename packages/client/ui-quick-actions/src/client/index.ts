/**
 * Quick-actions plugin, browser half: the QuickActionsService (`ctx.quickActions`)
 * owning the flat entry registry; QuickActionsRow self-registers into the
 * `conversation.input.dock` slot as the terminal dock entry, directly above
 * the composer card. Seeds the three default entries at apply() through the
 * same `register` call any other plugin would use to add its own.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { QuickActionsService } from './service.ts'
import { QuickActionsRow } from './QuickActionsRow.tsx'
import type { QuickActionsRowInjected } from './QuickActionsRow.tsx'
import type { QuickActionEntry } from './contract.ts'
import { en, zh, type QuickActionsKey } from './locales.ts'

export { QuickActionsService } from './service.ts'
export { QuickActionsRow } from './QuickActionsRow.tsx'
export type { QuickActionsRowInjected, QuickActionsRowProps } from './QuickActionsRow.tsx'
export type { QuickActionEntry, QuickActionsServiceContract, QuickActionsSnapshot } from './contract.ts'
export type { QuickActionsKey } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The outward face only; the concrete service stays inside this plugin. */
    quickActions: import('./contract.ts').QuickActionsServiceContract
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The quick-action row's own chrome copy (entry labels ride the registry, not this dictionary). */
    quickActions: QuickActionsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'quickActions'

/** Default entries seeded at apply(), through the same `register` call any other plugin would use. */
const DEFAULT_ENTRIES: readonly QuickActionEntry[] = [
  { id: 'lead-generation', label: 'Lead generation', insertText: 'Pull a lead-generation list for ', order: 0 },
  { id: 'income-statements', label: 'Income Statements', insertText: 'Generate an income statement for ', order: 10 },
  { id: 'balance-sheet', label: 'Balance sheet', insertText: 'Generate a balance sheet for ', order: 20 },
]

/** Required services: the row registers into the dock slot and resolves each session's scope. */
export const inject = ['slots', 'sessions', 'locale']

/**
 * Client plugin body: mount the registry service, seed its default entries,
 * then register QuickActionsRow into the composer's input dock.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.plugin(QuickActionsService)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-quick-actions: dictionaries')

  ctx.inject(['slots', 'quickActions', 'sessions'], (scope: ClientContext) => {
    const quickActions = scope.quickActions
    const sessions = scope.sessions

    for (const entry of DEFAULT_ENTRIES) {
      ctx.effect(() => quickActions.register(entry), `ui-quick-actions: default entry "${entry.id}"`)
    }

    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock',
      id: 'quick-actions',
      order: 30,
      locale: NS,
      inject: (sessionId): QuickActionsRowInjected => {
        // Session-scoped slot: the entries are global, but resolving scope
        // here (same fail-loud invariant as the queue/goal dock entries)
        // proves the session is live before the row mounts for it.
        const actx = sessions.scope(sessionId)
        if (actx === undefined) throw new Error(`ui-quick-actions: session "${String(sessionId)}" resolved no scope`)
        return { entries: quickActions.entries }
      },
    }, QuickActionsRow))
  })
}

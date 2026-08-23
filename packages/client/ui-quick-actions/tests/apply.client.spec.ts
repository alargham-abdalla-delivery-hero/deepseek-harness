/**
 * apply wiring on a real cordis Context + SlotRegistry: QuickActionsService
 * mounts as ctx.quickActions once its sessions dependency is up, the three
 * default entries seed through the same register() other plugins use, and
 * the QuickActionsRow dock registration resolves the per-session controller
 * from the slot's sessionId, following the ui-input-trigger apply pattern.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createScope, scopeOf, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject, QuickActionsService } from '@deepseek-ai/dsh-client-ui-quick-actions/client'
import type { QuickActionsRowInjected } from '@deepseek-ai/dsh-client-ui-quick-actions/client'

const sid = (k: string): SessionId => k as SessionId

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  // Stand-in for the ui-conversation composer entry: declare the dock slot
  // without providing InputZone/ConversationController, which is not this
  // plugin's lifecycle signal.
  slots.register(
    { name: 'root', children: { 'conversation.composer.dock': { kind: 'list', scope: 'session' } } } as never,
    () => null,
  )
  // Sessions face: mint one real scope for session 'a' and resolve it by id.
  const scope = createScope(ctx, sid('a'))
  ctx.provide('sessions', {
    scope: (id: SessionId) => (id === sid('a') ? scope.ctx : undefined),
    scopeOf: (c: Context) => scopeOf(c),
  })
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  return { ctx, slots, locale }
}

describe('apply', () => {
  it('declares the slots, sessions, and locale dependencies', () => {
    expect(inject).toEqual(['slots', 'sessions', 'locale'])
  })

  it('registers the bilingual row-chrome dictionaries', async () => {
    const { ctx, locale } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const t = locale.bind('quickActions')
    locale.setLocale('en')
    expect(t('more')).toBe('More')
    locale.setLocale('zh')
    expect(t('more')).toBe('更多')
  })

  it('mounts ctx.quickActions once sessions is up, seeded with the default entries', async () => {
    const { ctx } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const quickActions = ctx.get('quickActions')
    expect(quickActions).toBeInstanceOf(QuickActionsService)
    const snapshot = (quickActions as QuickActionsService).entries.getSnapshot()
    expect(snapshot.visible.map(e => e.id)).toEqual([
      'lead-generation', 'income-statements', 'balance-sheet', 'cash-flow-statement',
    ])
    expect(snapshot.overflow.map(e => e.id)).toEqual([
      'market-research', 'competitor-analysis', 'financial-forecast', 'investor-pitch',
    ])
  })

  it('registers QuickActionsRow into the composer dock band, ahead of the stats line', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entries = slots.entries('conversation.composer.dock')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options.id).toBe('quick-actions')
    expect(entries[0]!.options.order).toBe(-10)
    expect(entries[0]!.locale).toBe('quickActions')

    const quickActions = ctx.get('quickActions') as QuickActionsService
    // StoredEntry.inject is declaration-typed ((...args: never[]) shape);
    // the erased registration widens it past a direct cast, so hop unknown.
    const injectEntry = entries[0]!.inject as unknown as (sessionId: SessionId) => QuickActionsRowInjected
    const injected = injectEntry(sid('a'))
    expect(injected.entries).toBe(quickActions.entries)
    // An unknown session id fails loud (no silent scope miss).
    expect(() => injectEntry(sid('ghost'))).toThrow(/resolved no scope/)
  })

  it('a plugin-registered entry after apply reaches the shared entries snapshot', async () => {
    const { ctx } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const quickActions = ctx.get('quickActions') as QuickActionsService
    quickActions.register({ id: 'extra', label: 'Extra', insertText: 'extra ', overflow: true, order: -10 })
    expect(quickActions.entries.getSnapshot().overflow.map(e => e.id)[0]).toBe('extra')
  })

  it('fiber teardown removes the dock entry and unmounts the service', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('conversation.composer.dock')).toHaveLength(1)

    await fiber.dispose()
    expect(slots.entries('conversation.composer.dock')).toHaveLength(0)
    expect(ctx.get('quickActions')).toBeUndefined()
  })
})

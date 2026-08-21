/**
 * QuickActionsService spec: register/dispose, duplicate-id guard, the
 * visible/overflow split by `order`, and the HMR-safety disposal shape
 * (dispose of the registering fiber removes the entry).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { QuickActionsService } from '../src/client/service.ts'
import type { QuickActionEntry } from '../src/client/contract.ts'

function entry(over: Partial<QuickActionEntry> = {}): QuickActionEntry {
  return { id: 'a', label: 'A', insertText: 'a ', order: 0, ...over }
}

async function bench() {
  const root = new Context()
  await root.plugin(QuickActionsService).await()
  const quickActions = root.get('quickActions') as QuickActionsService
  return { root, quickActions }
}

describe('register', () => {
  it('throws on a duplicate id', async () => {
    const { quickActions } = await bench()
    quickActions.register(entry())
    expect(() => quickActions.register(entry())).toThrow(/already registered/)
  })

  it('the returned disposer removes the entry; a stale double-dispose stays a no-op', async () => {
    const { quickActions } = await bench()
    const dispose = quickActions.register(entry())
    expect(quickActions.entries.getSnapshot().visible).toHaveLength(1)
    dispose()
    expect(quickActions.entries.getSnapshot().visible).toHaveLength(0)
    dispose()
    expect(quickActions.entries.getSnapshot().visible).toHaveLength(0)
    // The id is free again after disposal.
    quickActions.register(entry())
  })

  it('HMR shape: dispose of the registering fiber removes the entry', async () => {
    const { root, quickActions } = await bench()
    const fiber = root.plugin({
      apply(pluginCtx) {
        pluginCtx.effect(() => quickActions.register(entry()), 'test: quick action')
      },
    })
    await fiber.await()
    expect(quickActions.entries.getSnapshot().visible).toHaveLength(1)

    await fiber.dispose()
    expect(quickActions.entries.getSnapshot().visible).toHaveLength(0)
  })
})

describe('entries', () => {
  it('splits by `overflow`, each group ascending by `order`', async () => {
    const { quickActions } = await bench()
    quickActions.register(entry({ id: 'visible-b', order: 10 }))
    quickActions.register(entry({ id: 'visible-a', order: 0 }))
    quickActions.register(entry({ id: 'overflow-b', overflow: true, order: 5 }))
    quickActions.register(entry({ id: 'overflow-a', overflow: true, order: 1 }))

    const snapshot = quickActions.entries.getSnapshot()
    expect(snapshot.visible.map(e => e.id)).toEqual(['visible-a', 'visible-b'])
    expect(snapshot.overflow.map(e => e.id)).toEqual(['overflow-a', 'overflow-b'])
  })

  it('starts empty and republishes a fresh snapshot on every register/dispose', async () => {
    const { quickActions } = await bench()
    expect(quickActions.entries.getSnapshot()).toEqual({ visible: [], overflow: [] })
    const seen: number[] = []
    quickActions.entries.subscribe(() => { seen.push(quickActions.entries.getSnapshot().visible.length) })
    const dispose = quickActions.register(entry())
    expect(seen).toEqual([1])
    dispose()
    expect(seen).toEqual([1, 0])
  })
})

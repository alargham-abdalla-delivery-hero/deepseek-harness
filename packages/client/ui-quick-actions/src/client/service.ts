/**
 * QuickActionsService (`ctx.quickActions`): the browser-side registry behind
 * the composer quick-action row. Holds the flat entry list and derives the
 * visible/overflow split into a snapshot store on every register/dispose, so
 * the QuickActionsRow dock entry reflects registry changes without
 * resubscribing per entry.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { QuickActionEntry, QuickActionsServiceContract, QuickActionsSnapshot } from './contract.ts'

const EMPTY_SNAPSHOT: QuickActionsSnapshot = { visible: [], overflow: [] }

/** Split the flat list into ascending-order visible/overflow groups. */
function project(list: readonly QuickActionEntry[]): QuickActionsSnapshot {
  const byOrder = (a: QuickActionEntry, b: QuickActionEntry) => a.order - b.order
  return {
    visible: list.filter(entry => entry.overflow !== true).toSorted(byOrder),
    overflow: list.filter(entry => entry.overflow === true).toSorted(byOrder),
  }
}

/** The `ctx.quickActions` quick-action registry service. */
export class QuickActionsService extends Service implements QuickActionsServiceContract {
  private readonly list: QuickActionEntry[] = []

  readonly entries: SnapshotStore<QuickActionsSnapshot> = createSnapshotStore<QuickActionsSnapshot>(EMPTY_SNAPSHOT)

  /**
   * @param ctx - owning root context (the service registers itself as `quickActions`).
   */
  constructor(ctx: Context) {
    super(ctx, 'quickActions')
  }

  register(entry: QuickActionEntry): () => void {
    if (this.list.some(existing => existing.id === entry.id)) {
      throw new Error(`quick action "${entry.id}" is already registered`)
    }
    this.list.push(entry)
    this.entries.set(project(this.list))
    return () => {
      const at = this.list.indexOf(entry)
      if (at < 0) return
      this.list.splice(at, 1)
      this.entries.set(project(this.list))
    }
  }
}

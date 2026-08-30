/**
 * Frozen service contract of the quick-actions registry. Types only. The
 * QuickActionsService implementation publishes this face as `ctx.quickActions`;
 * other plugins see `register` alone, while the QuickActionsRow dock entry
 * (this package's own client/index.ts) also reads the live `entries` split.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** One quick-action entry: a labeled control that writes `insertText` into the composer draft. */
export interface QuickActionEntry {
  /** Registration identity; a duplicate id throws. */
  readonly id: string
  /** Button / menu-item label. */
  readonly label: string
  /** Text written into the composer draft on selection (replaces the whole draft; the message is not submitted). */
  readonly insertText: string
  /** Routes the entry into the "More" overflow menu instead of the always-visible row (default false). */
  readonly overflow?: boolean
  /** Ascending sort key within the entry's group (the visible row or the overflow menu). */
  readonly order: number
}

/** Visible/overflow split of the live registry, recomputed on every register/dispose. */
export interface QuickActionsSnapshot {
  /** Rendered as top-level row buttons, ascending by `order`. */
  readonly visible: readonly QuickActionEntry[]
  /** Rendered as "More" menu items, ascending by `order`. */
  readonly overflow: readonly QuickActionEntry[]
}

/** The `ctx.quickActions` service face. */
export interface QuickActionsServiceContract {
  /**
   * Register one quick action; a duplicate id throws.
   * @param entry - the action to add.
   * @returns effect disposer removing this entry.
   */
  register(entry: QuickActionEntry): () => void
  /** Live visible/overflow split (see {@link QuickActionsSnapshot}). */
  readonly entries: SnapshotStore<QuickActionsSnapshot>
}

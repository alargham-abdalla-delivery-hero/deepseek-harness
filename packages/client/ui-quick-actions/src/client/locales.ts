/** `quickActions` namespace dictionaries: the row's own chrome copy (entry labels ride the registry, not this dictionary). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'row.aria': '快捷操作',
  more: '更多',
  'menu.aria': '更多快捷操作',
} satisfies Record<string, string>

/** The quickActions namespace key union. */
export type QuickActionsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'row.aria': 'Quick actions',
  more: 'More',
  'menu.aria': 'More quick actions',
} satisfies Record<QuickActionsKey, string>

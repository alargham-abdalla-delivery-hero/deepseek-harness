# @deepseek-ai/dsh-client-ui-quick-actions

English | [中文](README.zh.md)

Quick-actions plugin, browser half: `QuickActionsRow` is the terminal card in the `conversation.input.dock` composer-context stack (order 30, directly above the composer card) — a row of one-click buttons plus a trailing "More" button. Other plugins contribute entries through `ctx.quickActions.register(entry)` (mirrors `ctx.inputTriggers`'s registration face): a plain `{ id, label, insertText, overflow?, order }` object, disposer-returning, duplicate id throws. The service derives a `{ visible, overflow }` split from the flat entry list on every register/dispose and republishes it through a `SnapshotStore`; `visible` renders as row buttons and `overflow` renders as items in the "More" menu (the existing `Menu` primitive, side-anchored to the button). Selecting any entry — a row button or a menu item — writes its `insertText` into the current session's composer draft through `inputActions.setDraft` (the same face `/` commands and file-mention insertion use) and never submits, so the user can edit before sending. Every control disables while the composer is adjudicating or submitting a message, mirroring the InputBar's own busy gate.

This plugin ships three default entries (Lead generation, Income Statements, Balance sheet), registered at `apply()` through the same `register` call any other plugin would use, so a deployment or another plugin can add further entries without touching this package's source.

The `/client` exports are the plugin body (`apply`/`inject`), `QuickActionsService`, `QuickActionsRow`, and the contract types (`QuickActionEntry`, `QuickActionsServiceContract`, `QuickActionsSnapshot`).

## Model Experience

None, as the row only writes composer text a person can edit before sending; the resulting prompt reaches the model through the ordinary composer submission path, which this package plays no part in.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Fixed default entries, no config surface** — the three shipped labels/insert-texts are not configurable from `cordis.yml`. A deployment wanting different defaults currently has to register additional entries from another plugin and dispose these, or fork the constant; a `Config` surface is deferred until a real second consumer needs different defaults.
- **No RTL-aware overflow side** — the "More" menu always opens `side="right"`; the composer has no documented right-to-left handling elsewhere yet, so this follows that precedent rather than solving it here.

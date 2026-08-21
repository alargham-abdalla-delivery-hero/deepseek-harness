## Why

The composer has no fast path into common domain workflows (pulling a lead-generation list, an income statement, a balance sheet). Users type the full request from scratch every time. A row of quick-action buttons under the input turns these into one click, with a "More" overflow for less-frequent actions instead of crowding the tool row.

## What Changes

- Add a new client plugin that registers a row of quick-action buttons under the composer input.
- Ship three named buttons by default: "Lead generation", "Income Statements", "Balance sheet". Clicking one inserts (or submits) that action's associated composer text.
- Add a "More" button that opens a side-anchored dropdown (reusing the existing `Menu` primitive) listing additional quick actions not shown as top-level buttons.
- Quick actions are declared through a small, injectable registry so other plugins can contribute additional entries without modifying this plugin.

## Capabilities

### New Capabilities
- `chat-quick-actions`: a composer-adjacent row of one-click action buttons, backed by a registry other plugins can add entries to, with overflow entries surfaced through a side dropdown.

### Modified Capabilities
(none — no existing capability's requirements change)

## Impact

- New package `packages/client/ui-quick-actions/` (client-only plugin, following the `ui-input-trigger` split-package pattern: empty host `apply()`, real behavior in `src/client/`).
- Registers into the existing `conversation.input.dock` slot (declared by `ui-conversation`); no changes to `ui-conversation` itself.
- Reuses the existing `Menu` primitive from `ui-primitives` (`side` prop) for the "More" dropdown — no new dropdown component.
- New `cordis.yml` / bundle wiring to include the plugin in the web client composition.

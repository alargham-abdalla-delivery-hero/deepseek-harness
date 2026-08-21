# Agent Note: Composer quick-action row

Status: implemented

English | [中文](2026-08-20-composer-quick-actions.zh.md)

## Problem

The composer has no fast path into common domain workflows (pulling a lead-generation list, an income statement, a balance sheet); a user types the full request from scratch every time. Nothing in the existing `conversation.input.dock` seat offers a one-click shortcut, and no plugin other than the one owning a dock entry can add buttons to it.

## Decision

A new client-only package, `packages/client/ui-quick-actions/` (`@deepseek-ai/dsh-client-ui-quick-actions`), follows the `ui-input-trigger`/`ui-commands` split: an empty host `apply()` so the plugin still appears in `cordis.yml`/Loader, and the real behavior in `src/client/`.

`QuickActionsService` (`ctx.quickActions`) is a flat, in-memory registry of `{ id, label, insertText, overflow?, order }` entries. `register(entry)` throws on a duplicate id and returns a disposer (the registration-as-effect convention); the service derives a `{ visible, overflow }` split by ascending `order` on every register/dispose and republishes it through a `SnapshotStore`. The plugin seeds three default entries (Lead generation, Income Statements, Balance sheet) at `apply()` through that same `register` call, so another plugin adds entries the identical way — no edit to this package.

`QuickActionsRow` renders the visible entries as buttons plus a trailing "More" button, registered into `conversation.input.dock` (`packages/client/ui-conversation`'s existing `kind: 'list'` seat) at `order: 30` — the highest order among that seat's shipped entries (Todo at 0, Goal at 10, Queue at 20), so the row sits as the terminal card directly above the composer. "More" always renders (not only when overflow entries exist), reusing the `Menu` primitive (`side="right"`, `getAnchorRect` on the button ref) rather than a bespoke popover. Selecting any entry — a row button or a menu item — calls `inputActions.setDraft(insertText)` (the same face `/` commands and file-mention insertion use) and never submits, so the user can edit before sending. Every control disables while `input.phase` is `'adjudicating'` or `'submitting'`, mirroring `InputBar`'s own busy gate; the row never subscribes to session/input directly, only reads the owner-share snapshot the `.dock` seat already re-renders on.

The plugin is wired into the web client's default composition (`packages/bundle/web-app/cordis.patch.yml`, `packages/bundle/web-app/package.json`) and the client-plugin aggregate (`tsconfig.client.json`), so `pnpm dsh web` mounts it without an opt-in flag.

## Alternatives considered

- **Hardcode the three buttons directly in `ui-conversation`, no registry** — rejected: every other `.dock`/`.overlay` contributor in this repo ships as its own plugin rather than growing the declaring package, and a fixed set with no extension point contradicts the request that other plugins be able to add entries without editing this one.
- **A bespoke dropdown/popover for "More"** — rejected: `Menu` already implements the exact side-anchored, keyboard/focus/dismiss-consistent interaction (the same primitive backing the slash-command menu and the workspace picker); a new component would duplicate that behavior for no gain.
- **Submit immediately on click** — rejected: matches neither `/` commands nor file-mention insertion, both of which write the draft and let the user review; an unreviewed immediate submission also risks an accidental send from a stray extra click.
- **Register into `conversation.input.left`/`.right` instead of `.dock`** — rejected: those seats share a one-row height budget with resident composer chrome and are documented for a single small always-visible control, not a labeled multi-button row; `.dock` is the seat for content that wants its own line.

## Consequences

Other plugins can contribute quick actions with one `ctx.quickActions.register(...)` call and no dependency on this package beyond the declared service face. The trade-off: the three shipped default entries are fixed English strings with no `cordis.yml` `Config` surface, and "More" always opens `side="right"` regardless of text direction — both documented under this package's `README.md` `## Known Limitations and Deferred Work`, deferred until a real second consumer needs different defaults or right-to-left placement.

## Testing

`packages/client/ui-quick-actions/tests/service.client.spec.ts` covers `QuickActionsService` register/duplicate-id/dispose and the visible/overflow ordering, including the HMR-safety shape (dispose of the registering fiber removes the entry). `tests/apply.client.spec.ts` covers the real `apply()` wiring on a cordis `Context` + `SlotRegistry` (default-entry seeding, dock registration at `order: 30`, per-session scope resolution failing loud on an unknown session, fiber teardown). `tests/quick-actions-row.client.spec.tsx` renders `QuickActionsRow` directly (props-direct, the `QueueDock`/`GoalDock` precedent) and asserts the four buttons, a click writing the draft through `inputActions.setDraft`, an overflow entry surfacing in the "More" menu, and every control disabling during the busy input phases. `apps/web/tests/quick-actions-row.snapshot.ts` is a keyless assembled-jsdom snapshot (`packages/client/ui-quick-actions` added to `apps/web/tests/assembled-boot.ts`'s boot graph) pinning the default row's four button labels and a real click filling the composer draft over the built client bundles.

## Context

Quick actions are a new UI surface, not a modification of the composer itself: they render into the existing `conversation.input.dock` slot (`packages/client/ui-conversation/src/client/contract/slots.ts`), a full-width `kind: 'list'` row stacked above the composer card, `owner: InputZone` (`{ session: ConversationSnapshot; input: InputState }`). No change to `ui-conversation`'s slot declarations or render site is needed.

The closest existing pattern is `packages/client/ui-input-trigger/`: a client-only Cordis plugin with an empty host `apply()` (so it still appears in `cordis.yml`/Loader) and the real behavior — a service plus a component registered into a slot — in `src/client/`. `ui-input-trigger` and `ui-commands` both follow this split; the new plugin follows the same shape.

For the "More" overflow, `packages/client/ui-primitives/src/Menu.tsx` already implements an anchored popup menu with a `side` prop (`top`/`bottom`/`left`/`right`) and `align`, `items`, `onSelect`, `onClose` — exactly the "opens on the side" behavior asked for. No new dropdown/menu component is needed.

## Goals / Non-Goals

**Goals:**
- Render a row of quick-action buttons under the composer, contributed via `conversation.input.dock`.
- Ship three default actions (Lead generation, Income Statements, Balance sheet) plus a "More" button.
- "More" opens a `Menu` anchored to the button, `side="right"` (or `"left"` in RTL — see Open Questions), listing overflow actions.
- Let other plugins contribute additional quick actions without editing this package (a small registry service, mirroring `InputTriggerService`'s `ctx.inputTriggers` pattern as `ctx.quickActions`).
- Selecting any action (top-level or from the overflow menu) writes into the composer draft via the existing `InputActions` face (`ctx.inputActions` from the session standard kit) — the same path a user typing text would use — rather than submitting immediately, so the user can edit before sending.

**Non-Goals:**
- No new backend/tool capability: the buttons only populate composer text; producing an actual lead-generation list, income statement, or balance sheet is the job of whatever agent/tool the resulting prompt reaches. This change ships no such tool.
- No change to slot declarations, `InputZone`, or any other `ui-conversation` contract.
- No persistence of user-customized quick actions (fixed registry contents for this change; see Open Questions).
- No new generic dropdown/menu primitive — reuse `Menu` as-is.

## Decisions

- **New package `packages/client/ui-quick-actions/`** (client-only), not an addition to `ui-conversation`: quick actions are optional UI, and every other slot contributor in this repo (`ui-input-trigger`, `ui-commands`) ships as its own plugin rather than growing the declaring package. Keeps `ui-conversation` as the sole owner of the slot's shape.
- **Registry service `ctx.quickActions`** (declared via `declare module '@deepseek-ai/cordis' { interface Context }'`, mirroring `ctx.inputTriggers`): a plugin-scoped list of `{ id, label, insertText }` entries, with a fixed `order` splitting "always visible" from "overflow into More". Alternative considered: hardcode the three buttons with no registry — rejected because the proposal requires other plugins to add entries without editing this package.
- **Overflow via existing `Menu` primitive**, anchored to the "More" button's DOM rect (`getAnchorRect`), rather than a bespoke popover: `Menu` already ships the exact side-anchored, `MenuItem`-based interaction the request describes, and reusing it keeps the row's keyboard/focus/dismiss behavior consistent with the rest of the app (e.g. the slash-command menu, workspace picker).
- **Action selection writes composer text, does not submit**: matches how `/` commands and file mentions behave today (insert, don't send) and avoids surprising the user with an unreviewed submission triggered by an accidental extra letter typed after the click.
- **Registration through `conversation.input.dock`, not `.left`/`.right`**: those two seats share a one-row height budget with the resident chrome (access mode, plan, attach, model, send) and are documented as being for a "small always-visible control", not a labeled multi-button row; `.dock` is explicitly the seat for content wanting "a line to itself".

## Risks / Trade-offs

- [Fixed default registry ships three domain-specific buttons (Lead generation / Income Statements / Balance sheet) with no config surface] → Acceptable for this change per the request; a follow-up can add cordis.yml-configurable defaults if other deployments need different button sets (repo convention: no hardcoded tunables without a current consumer — tracked as an Open Question, not solved here).
- [`conversation.input.dock` is a `kind: 'list'` seat other plugins may also populate] → Entries render by ascending `order` per the slot's existing list-seat convention; this plugin picks an `order` low enough to sit directly under the composer without asserting exclusive ownership of the seat.
- [Registry entries are static per session, but `InputZone`'s `session`/`input` owner props are per-render snapshots] → Quick actions plugin must read `session`/`input` only for gating (e.g. disable while `blocked`/`disabled`), never subscribe directly, matching the slot's documented contract.

## Open Questions

- Should the three default action labels/insert-texts be configurable from `cordis.yml` (a `Config` field), or is a fixed English-only default acceptable for the first version? (Affects whether `Config` is added to the plugin now or in a follow-up.)
- RTL layout: should "More" open `side="left"` under `dir="rtl"`, or is `side="right"` acceptable for now given the composer itself has no documented RTL handling yet?
- Does any existing capability already reserve `ctx.quickActions` or a similarly-named service? (Not found in this search; confirm at implementation time.)

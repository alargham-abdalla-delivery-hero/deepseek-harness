## 1. Package scaffold

- [x] 1.1 Create `packages/client/ui-quick-actions/` following the `ui-input-trigger` layout: `package.json` (`@deepseek-ai/dsh-client-ui-quick-actions`, `dsh.client.inject: ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-slots"]`, `platform: "web"`), `tsconfig.json` extending `tsconfig.base.client.json`, `src/index.ts` (empty host `apply()`), `src/invariant.ts`.
- [x] 1.2 Register the package in the one client-plugin aggregate it belongs to (per `docs/development.md#typescript-project-layout`) and add it to `packages/README.md`'s client group list.

## 2. Registry service

- [x] 2.1 Define the quick-action entry type (`{ id, label, insertText, overflow?: boolean, order: number }`) and the `QuickActionsServiceContract` in `src/client/contract.ts`.
- [x] 2.2 Implement `QuickActionsService` (`src/client/service.ts`) holding the entry list, exposing `register(entry)` returning a disposer (registration-as-effect convention) and a derived `{ visible, overflow }` split by `order`.
- [x] 2.3 Declare `ctx.quickActions: QuickActionsServiceContract` via `declare module '@deepseek-ai/cordis'` in `src/client/index.ts`; seed the three default entries (Lead generation, Income Statements, Balance sheet) at plugin `apply()` through the same `register` call other plugins would use.

## 3. Row and overflow UI

- [x] 3.1 Implement `QuickActionsRow.tsx`: renders the visible entries as buttons plus a trailing "More" button; disabled when the owner's `InputZone.input` reports blocked/disabled (read-only per the `.dock` seat's snapshot contract — no direct subscription).
- [x] 3.2 Wire "More" to the existing `Menu` primitive (`@deepseek-ai/dsh-client-ui-primitives`): `side="right"`, anchored via `getAnchorRect` on the button ref; items are the overflow entries; `onSelect` inserts and closes, `onClose` just closes.
- [x] 3.3 On any entry selection (row button or menu item), call the session's `inputActions` draft-write path (same face `ui-input-trigger`/file-mention insertion uses) with the entry's `insertText`; do not call submit.

## 4. Slot registration

- [x] 4.1 In `src/client/index.ts` `apply(ctx)`, `inject(['slots', 'quickActions', 'sessions'], ...)` and register `QuickActionsRow` into `conversation.input.dock` (`kind: 'list'`), choosing an `order` that places it directly above the composer card among any other `.dock` entries.
- [x] 4.2 Resolve the row's per-session `inject()` callback the same way `ui-input-trigger` resolves `sessions.scope(sessionId)`, throwing on an unresolved scope.

## 5. Composition wiring

- [x] 5.1 Add the new plugin to the web client's `cordis.yml` (or the bundle that assembles the web client) so `pnpm dsh web` picks it up by default.

## 6. Tests

- [x] 6.1 Unit-test `QuickActionsService`: register/dispose (HMR-safety disposal test per testing policy), visible/overflow split by `order`.
- [x] 6.2 Real-composition test (Loader-booted test `cordis.yml`, per `packages/AGENTS.md`): asserts the row renders its three default buttons plus "More", clicking a button writes the expected draft text, and a plugin-registered extra entry appears in the "More" menu.
- [x] 6.3 Add/update a keyless snapshot (ACP or headless replay) covering the quick-action row appearing under the composer and a button click producing the expected draft — required for this product-visible composer change per `docs/testing.md`.

## 7. Docs

- [x] 7.1 Write the package README (Model Experience format per `docs/cookbook/adding-a-package.md`), documenting the `ctx.quickActions` registration API for other plugins and a `## Known Limitations and Deferred Work` entry noting the fixed, non-configurable default action set (tracked as an Open Question in design.md).
- [x] 7.2 JSDoc every exported member of `contract.ts`/`service.ts`/`index.ts` per the repo's export-JSDoc requirement.

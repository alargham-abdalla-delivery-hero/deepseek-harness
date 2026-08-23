# Agent Note: OpenUI generative-UI rendering (`render_ui`)

Status: implemented

English | [中文](2026-08-23-openui-generative-ui-rendering.zh.md)

## Problem

Model answers are plain text/markdown content blocks; anything better shown as a chart, table, or interactive card renders as a wall of prose in the web chat client. [OpenUI](https://github.com/thesysdev/openui) is an MIT-licensed, self-hosted, bring-your-own-LLM generative-UI framework: the model is prompted to emit **OpenUI Lang**, a compact DSL, which is normally parsed into a typed element tree and rendered as React components. The harness needed a way to let the model produce that kind of rich UI without adding a hosted dependency, without changing the shared tool render-intent union every host must handle, and without letting model-authored output become an XSS vector in the browser.

## Decision

`render_ui` is a model-facing tool (`@deepseek-ai/dsh-tool-openui`) that parses and validates one OpenUI Lang source string server-side against a fixed, hand-authored component vocabulary (`@deepseek-ai/dsh-openui-lang`: `Stack` root, `Card`, `Heading`, `Text`, `List`/`ListItem`, `Table` — no component accepts a URL, raw markup, or script). A syntax mistake or an unknown/invalid component is never a thrown error — it is OpenUI's own lenient parse outcome (`{ root, errors, incomplete }`), reported back so the model can self-correct, exactly like a non-zero shell exit code. The web client (`@deepseek-ai/dsh-client-ui-openui`) claims the tool's name in the existing keyed `tool.call.toolview` slot (`packages/client/ui-tool`) and renders the settled element tree; every other host gets the `generic` card fallback. The shared component vocabulary is defined once (`ComponentRenderers<C>`, generic over an opaque per-consumer renderer payload lang-core never inspects) and consumed by both sides, so the taught system-prompt grammar, the server validator, and the client's drawable set cannot drift apart.

The parsed element tree reaches the client through `output.presentationMeta: (_args, value) => value` on the tool, landing in the durable `tool/result` event's `meta` field and from there in `ToolResultNode.meta` — verified directly against `packages/client/ui-conversation/src/client/conversation-nodes/tool.ts:66`, since the wire otherwise carries only `content` and the closed `callView`/`resultView` card union, never a tool's raw canonical value.

The client does not use `@openuidev/react-lang`'s `<Renderer>` component. `<Renderer response={string}>` is designed to receive raw OpenUI Lang text and re-parse it itself, client-side — the opposite of "parse once, server-side, and never trust the client to do it again." Instead, `dsh-client-ui-openui` walks the already-validated tree with a small hand-rolled recursive renderer (`renderElement`), dispatching each node's `typeName` against a plain `ComponentRenderers<OpenUIComponent>` object whose type annotation alone forces a React implementation for every curated name (a compile-time check, not a runtime one) — this keeps `@openuidev/react-lang` and `@openuidev/lang-core`'s runtime code out of the browser bundle entirely (confirmed via a real `tsdown --env.DSH_BUILD_FACE client` build: 238.65 kB with a `buildLibrary()` runtime call at module scope for the same exhaustiveness check, 8.50 kB without it, once only `dsh-openui-lang`'s types — erased at compile time — remained imported).

`@openuidev/lang-core` sends pseudonymous installation telemetry to PostHog by default (a random install ID, a salted-hash project identifier, and version metadata — no source, prompts, or paths, per its own disclosure). `OPENUI_TELEMETRY_DISABLED=1` disables it; this repository's default pnpm configuration additionally leaves third-party postinstall scripts unapproved (`pnpm approve-builds`), so the script does not currently run here at all.

Neither `@openuidev/lang-core` nor `@openuidev/react-lang` ships a built-in component library — every component is author-defined via `defineComponent`. `@openuidev/react-ui` is a separate, prebuilt Thesys package; it is not used here because a second unreviewed third-party component implementation is an avoidable expansion of the XSS-relevant surface for a v1.

Neither package is wired into any default preset or bundle. `examples/web-openui-demo/cordis.yml` is a `dsh web --patch` overlay (the same pattern as `web-cordis`) that opts a session into `render_ui` explicitly.

## Alternatives considered

**Extend `packages/core/tools/src/presentation.ts`'s `card` union with a new `component`/`generative-ui` kind.** Rejected: that union is the neutral vocabulary every host (web, CLI, ACP) must map, so a new member would force every non-web host to grow an opinion about arbitrary generative UI it cannot render. The keyed `tool.call.toolview` slot already exists precisely so one plugin can fully own one tool's rendering without touching shared infrastructure.

**Use `@openuidev/react-lang`'s `<Renderer>` and ship raw OpenUI Lang text to the client for it to parse.** Rejected: it re-parses client-side against the library's own internal parser, which duplicates the server-side validation this design relies on for the model-self-correction loop and pulls the framework's full runtime (parser, prompt generation, its `ci-info`/telemetry-adjacent code) into the browser bundle for no behavioral benefit once the server has already produced a validated tree.

**Depend on `@openuidev/react-ui`'s prebuilt components instead of hand-authoring a curated set.** Rejected for a v1: it is a second, unreviewed third-party component implementation on the exact surface (arbitrary rendering of model-influenced data) where an XSS mistake matters most. Hand-authoring six small components is cheap and keeps the security review inside this change.

**Wire up `Query()`/`Mutation()`/`ToolProvider` so rendered UI can call back into tools.** Rejected for v1: this is a materially larger, distinct security surface (model-authored UI triggering tool execution outside the normal model-loop-mediated flow) than "render an already-complete, already-settled result," and nothing in the current ask needs it.

**Ship a JSON-schema `{ ok, tree } | { ok: false, errors }` canonical output shape.** Rejected once the real `@openuidev/lang-core` API was read directly: `createParser(...).parse()` already returns a lenient `{ root, meta: { errors, incomplete, ... } }` shape (a component with invalid props is dropped and reported, not a parse failure), so mirroring that exactly avoids inventing a second, redundant outcome shape.

## Testing

Package-level unit/integration tests only (no snapshot or SDK-expected-output fixture yet — see Deferred): `dsh-openui-lang` (7 tests) covers valid/unknown-component/missing-required/unparseable parsing and prompt generation; `dsh-tool-openui` (8 tests) drives the real tool through `ctx.tools.execute()` including the `result.meta` projection and the `isError` branch of `presentResult`; `dsh-client-ui-openui` (16 tests, jsdom + `@testing-library/react`) covers every curated component, nested Card/Stack composition, the unknown-component fallback, the toolview's pending/error/success states, and the keyed-slot registration. All three packages are at 100% per-file coverage. `tsc --build`, `run-oxlint`, and the individually-run doc-sync/hygiene leaves (`verify-cordis-config`, `verify-package-invariants`, `verify-client-packages`, both README gates, `gen-tool-catalog --check`, `verify-runtime-closure`, `verify-dsh-package-licenses`, `verify-optional-dependency-imports`) all pass.

## Consequences

The model can now produce interactive, structured UI in the web chat client through a documented, additive extension point, with no new hosted backend and a browser bundle cost of ~8.5 kB. The cost: two new workspace packages plus one client package to maintain, a fixed (currently six-component) vocabulary that must be deliberately expanded rather than grown ad hoc, and an accepted install-time telemetry dependency (mitigated, not eliminated) on `@openuidev/lang-core`.

## Deferred

No keyless ACP/headless snapshot fixture and no TypeScript/Python SDK expected-output update exist yet for `render_ui`'s wire shape — both are required by this repository's testing policy for a model/product-user-visible change and are outstanding follow-up work, not part of this note's shipped decision. `examples/web-openui-demo`'s own keyless/with-key e2e smokes (required of every example leaf) are likewise not yet written. The curated component list has not received a human security sign-off beyond this change's own implementation review.

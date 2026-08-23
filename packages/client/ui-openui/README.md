# @deepseek-ai/dsh-client-ui-openui

English | [中文](README.zh.md)

The web chat client's keyed `tool.call.toolview` for `render_ui`: renders the settled result's persisted [OpenUI](https://github.com/thesysdev/openui) element tree as live React UI in the chat turn.

## What it does

Registers `RenderUiView` under `key: 'render_ui'` on the `tool.call.toolview` slot ([`@deepseek-ai/dsh-client-ui-tool`](../ui-tool/README.md)), following the same pattern as `webToolview`'s registration of `WebRow`. An unclaimed key falls back to the generic card; installing this plugin replaces that fallback for `render_ui` specifically.

`RenderUiView` reads `result.meta` off the settled `ToolResultNode` — the exact JSON [`@deepseek-ai/dsh-tool-openui`](../../openui/tool-openui/README.md)'s `output.presentationMeta` projected — and walks it with a small hand-rolled recursive renderer (`renderElement`), dispatching each element's `typeName` against the curated component map built from [`@deepseek-ai/dsh-openui-lang`](../../openui/openui-lang/README.md)'s shared component specs. A pending call (no `meta` yet) shows a plain "Rendering UI…" placeholder; a settled call with validation errors or no resolved root shows the humanized error messages instead of a tree.

## Why not `@openuidev/react-lang`'s `<Renderer>`

`@openuidev/react-lang`'s `<Renderer response={string} library={Library}>` is designed to receive **raw OpenUI Lang text** and parse it itself, client-side. This package instead renders the tree `dsh-tool-openui` already parsed and validated server-side — the client never re-parses raw text (see `openspec/changes/openui-generative-output/design.md` Decision 3/4) — so it does not depend on `@openuidev/react-lang` at all; only `@deepseek-ai/dsh-openui-lang`'s types and `buildLibrary` (used purely as a compile-time parity check that every curated component name has a React implementation here) are needed.

## Rendering

Every element outside the curated component set (a version mismatch between an older client and a newer server vocabulary) renders a visible `Unsupported UI element: <name>` fallback instead of being silently dropped or throwing and breaking the rest of the chat turn.

## Export shape

Two entry points, like every `ui-*` client plugin: `src/index.ts` is a no-op Host-loader stub (the Host pass never runs this plugin's real behavior), `src/client/index.ts` is the actual browser registration, built by the package's own `tsdown.config.ts` into `lib/client.js`.

## Model Experience

Indirectly, through `render_ui`'s tool schema and result text; [`dsh-tool-openui`](../../openui/tool-openui/README.md) owns everything the model sees.

#### KV Cache effect

No effect. This package renders only for the human viewing the chat and never contributes to a model request.

## Known Limitations and Deferred Work

- **No streaming/partial rendering.** Renders only after `render_ui` settles, consistent with every other keyed toolview's pending/settled split; see design.md's accepted trade-off.
- **No `Query()`/`Mutation()`/reactive `$variable` support.** Out of scope by design — see `dsh-openui-lang`'s README.
- **Minimal styling.** Components render plain semantic HTML (`h1`–`h3`, `p`, `ul`/`li`, `table`, `section`, `div`) or hand-rolled SVG (`BarChart`, `PieChart` — plain `<rect>`/`<path>` shapes, no charting dependency) with `data-openui-component` attributes for testability; no design-system integration yet.

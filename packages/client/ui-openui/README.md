---
description: "Web chat client's keyed tool.call.toolview for render_ui: renders the settled result's persisted OpenUI element tree as live React UI in the chat turn."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-openui

English | [中文](README.zh.md)

## Summary

This package is the web chat client's keyed `tool.call.toolview` for `render_ui`: it renders the settled result's persisted [OpenUI](https://github.com/thesysdev/openui) element tree as live React UI in the chat turn. Installing this plugin replaces the generic fallback card for `render_ui` specifically; a host without it (CLI, ACP) keeps the generic card.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside [`@deepseek-ai/dsh-tool-openui`](../../openui/tool-openui/README.md). It registers `RenderUiView` under `key: 'render_ui'` on the `tool.call.toolview` slot ([`@deepseek-ai/dsh-client-ui-tool`](../ui-tool/README.md)), following the same pattern as `webToolview`'s registration of `WebRow`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`RenderUiView` reads `result.meta` off the settled `ToolResultNode` — the exact JSON [`@deepseek-ai/dsh-tool-openui`](../../openui/tool-openui/README.md)'s `output.presentationMeta` projected — and walks it with a small hand-rolled recursive renderer (`renderElement`), dispatching each element's `typeName` against the curated component map built from [`@deepseek-ai/dsh-openui-lang`](../../openui/openui-lang/README.md)'s shared component specs. A pending call (no `meta` yet) shows a plain "Rendering UI…" placeholder; a settled call with validation errors or no resolved root shows the humanized error messages instead of a tree.

### Why not `@openuidev/react-lang`'s `<Renderer>`

`@openuidev/react-lang`'s `<Renderer response={string} library={Library}>` is designed to receive **raw OpenUI Lang text** and parse it itself, client-side. This package instead renders the tree `dsh-tool-openui` already parsed and validated server-side — the client never re-parses raw text (see `openspec/changes/openui-generative-output/design.md` Decision 3/4) — so it does not depend on `@openuidev/react-lang` at all; only `@deepseek-ai/dsh-openui-lang`'s types and `buildLibrary` (used purely as a compile-time parity check that every curated component name has a React implementation here) are needed.

### Rendering

Every element outside the curated component set (a version mismatch between an older client and a newer server vocabulary) renders a visible `Unsupported UI element: <name>` fallback instead of being silently dropped or throwing and breaking the rest of the chat turn.

### Export shape

Two entry points, like every `ui-*` client plugin: `src/index.ts` is a no-op Host-loader stub (the Host pass never runs this plugin's real behavior), `src/client/index.ts` is the actual browser registration, built by the package's own `tsdown.config.ts` into `lib/client.js`.

</details>

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `render_ui`'s tool schema and result text; [`dsh-tool-openui`](../../openui/tool-openui/README.md) owns everything the model sees.

#### KV Cache effect

No effect. This package renders only for the human viewing the chat and never contributes to a model request.

## Known Limitations and Deferred Work

- **No streaming/partial rendering.** Renders only after `render_ui` settles, consistent with every other keyed toolview's pending/settled split; see design.md's accepted trade-off.
- **No `Query()`/`Mutation()`/reactive `$variable` support.** Out of scope by design — see `dsh-openui-lang`'s README.
- **Styled against `dsh-client-ui-theme` tokens, not a third-party component kit.** Each component ships a colocated CSS Module (`Card.module.css`, `Table.module.css`, …) referencing the theme's CSS custom properties (`--dsw-alias-*`, `--dsw-font-markdown-*`), matching the reference [OpenUI](https://github.com/thesysdev/openui) playground's look (dividers between top-level `Stack` children, a bordered/scrollable `Table`, a `BarChart` with axis gridlines and a single accent color, a donut `PieChart` with a side legend) without depending on `@openuidev/react-ui` (Decision 5 in design.md). `Table` renders a leading `+`/`-` signed cell (`+12%`, `-3.4`) as a colored pill by pattern, not by column name.
- **No per-item icon or subtitle.** `ListItem`'s only prop is `text` (`dsh-openui-lang`'s schema has no icon/subtitle field), so items render a plain bullet marker; a reference render that shows a per-issue icon and caption line is doing so from data this renderer's schema does not carry.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

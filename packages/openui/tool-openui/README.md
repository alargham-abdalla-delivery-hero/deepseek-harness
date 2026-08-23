# @deepseek-ai/dsh-tool-openui

English | [中文](README.zh.md)

The model-facing `render_ui` tool: parse and validate [OpenUI Lang](https://github.com/thesysdev/openui) against the shared curated component vocabulary ([`@deepseek-ai/dsh-openui-lang`](../openui-lang/README.md)) and teach the model the grammar.

## What it does

Registers one tool, `render_ui(source: string)`, on `ctx.tools`, and one system-prompt section (`dsh-openui-lang`'s generated grammar text) on `ctx.systemPrompt`. `execute` parses `source` with `dsh-openui-lang`'s `parseSource()` and returns `{ root, errors, incomplete }` — the shared package's own lenient parse outcome. A syntax mistake, an unknown component, or a missing required prop is never a thrown error: it is the model's own recoverable output, reported back in `errors` so the model can correct it on the next call. Only a genuine parser implementation failure throws.

## Rendering

The canonical result carries the parsed element tree, but this package renders only a `generic` fallback card (a plain pending/completed row) — the rich UI is a separate concern owned by [`@deepseek-ai/dsh-client-ui-openui`](../../client/ui-openui/README.md), which claims this tool's name in the web chat client's keyed `tool.call.toolview` slot. A host without that client plugin (CLI, ACP) sees only the generic card and the model-facing text summary.

## Export shape

A function/namespace plugin: it exports `name` / `inject` / `apply` and NO default.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`render_ui` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-openui) plus one system-prompt section teaching OpenUI Lang syntax and the curated component signatures.

#### Token effect

Fixed schema cost plus the generated grammar section on every request where the tool is registered; proportional to the curated component count (kept intentionally small — see `dsh-openui-lang`'s README).

#### KV Cache effect

Prefix-stable while the tool's registration and `dsh-openui-lang`'s component vocabulary are unchanged.

### Tool-call history and result

#### What the model sees

Each call's arguments retain the full OpenUI Lang source. Success returns `Rendered a <RootComponent> UI.`; a parse/validation problem returns `OpenUI Lang had <n> issue(s):` followed by one humanized message per error; an unparseable/empty source returns `No renderable UI was produced — the source did not resolve to a root element.` None of these are `isError` — only a genuine parser crash is.

#### Token effect

Token growth scales with the OpenUI Lang source the model sends each call; the result text is small and proportional to the error count (usually zero).

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix.

## Known Limitations and Deferred Work

- **No update/patch operation.** Each `render_ui` call is independent; there is no way to edit a previously rendered UI in place (see the shared design decision in `openspec/changes/openui-generative-output/design.md`).
- **No `Query()`/`Mutation()`/tool-calling from rendered UI.** Out of scope by design — see `dsh-openui-lang`'s README.

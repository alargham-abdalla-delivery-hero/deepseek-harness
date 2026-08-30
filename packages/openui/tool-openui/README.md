# @deepseek-ai/dsh-tool-openui

English | [中文](README.zh.md)

The model-facing `render_ui` tool: parse and validate [OpenUI Lang](https://github.com/thesysdev/openui) against the shared curated component vocabulary ([`@deepseek-ai/dsh-openui-lang`](../openui-lang/README.md)) and teach the model the grammar.

## What it does

Registers one tool, `render_ui(source: string)`, on `ctx.tools`, and one system-prompt section on `ctx.systemPrompt`. `execute` parses `source` with `dsh-openui-lang`'s `parseSource()` and returns `{ root, errors, incomplete }` — the shared package's own lenient parse outcome. A syntax mistake, an unknown component, or a missing required prop is never a thrown error: it is the model's own recoverable output, reported back in `errors` so the model can correct it on the next call. Only a genuine parser implementation failure throws.

The system-prompt section is built from `dsh-openui-lang`'s generated grammar text, but with two additions this package supplies directly: a replacement `preamble` (see "Why the preamble is overridden" below) and one worked usage example showing a correctly-formed `render_ui` call, passed via `promptText({ preamble, examples: [...] })`.

### Why the preamble is overridden

`@openuidev/lang-core`'s built-in default `preamble` — used whenever `promptText()` is called with no `preamble` option — reads: "You are an AI assistant that responds using openui-lang... Your ENTIRE response must be valid openui-lang code — no markdown, no explanations, just openui-lang." That text is written for OpenUI/Thesys's own raw-completion architecture, where the model's entire reply IS the DSL with no wrapping tool call. Left in place, it actively instructs the model to write OpenUI Lang directly as its chat reply instead of calling `render_ui` — the opposite of this package's contract. This package supplies its own `preamble` stating that OpenUI Lang is sent only as the `render_ui` tool's `source` argument, never as the direct reply.

### Turn-completion self-correction

Even with the corrected preamble and a worked example, a model may still write OpenUI Lang directly as chat text instead of calling the tool. This package registers an `agent/turn-stopping` listener (the same extension point `dsh-hooks-claude-code`/`dsh-hooks-codex` use to force continuation on a failed check) that inspects a completed turn's final assistant message: if its text parses cleanly via `dsh-openui-lang`'s `parseSource()` to a non-trivial tree (using at least one of `Card`/`Table`/`List`/`BarChart`/`PieChart` — a bare `Heading`/`Text` root does not count), the listener calls `agent.steer(...)` with a corrective instruction quoting the offending source back and asking the model to resend it via `render_ui`, forcing another step. A message with any pending tool call is never the turn's final message when this listener runs — the loop always defers turn closure to feed that tool's result back first — so no separate check for an accompanying `render_ui` call is needed or possible.

Corrections are capped per `Config.maxCorrectionAttempts` (default 2) so a model that keeps not calling the tool cannot be steered indefinitely; once the cap is reached, the turn closes with its text answer unrendered.

## Configuration

```yaml
config:
  maxCorrectionAttempts: 2  # default; maximum consecutive corrective steers per agent before giving up
```

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

Prefix-stable while the tool's registration and `dsh-openui-lang`'s component vocabulary are unchanged; the worked example adds a small, fixed amount of text (one example tree, not proportional to the curated component count) to this same prefix-stable section.

### Turn-completion correction

#### What the model sees

When a completed turn's final message contains unrouted OpenUI Lang text, the model sees a plugin-injected user message on its next step quoting that text back and instructing it to resend the content via `render_ui`. This is an ordinary logged `user/message` event, reconstructable from the session log like any other injected context.

#### Token effect

Only on a miss: one extra request/response round trip (the corrective message plus the model's retry), bounded by `Config.maxCorrectionAttempts`. Zero cost when the model calls `render_ui` correctly the first time.

#### KV Cache effect

Append-only; the corrective message follows the reusable request prefix like any other injected context.

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
- **The turn-completion correction can false-positive on a deliberate, valid illustrative example.** If a user explicitly asks the model to show OpenUI Lang syntax in prose, and the model's example happens to parse cleanly with a non-trivial component, the correction fires anyway — the detector cannot distinguish "accidental" from "intentional" by parsing alone (see `openspec/changes/openui-tool-call-reliability/design.md` Risks).
- **The correction cap is a fixed count, not adaptive.** `Config.maxCorrectionAttempts` bounds consecutive corrections per agent; it does not distinguish a model that is about to succeed from one that never will.

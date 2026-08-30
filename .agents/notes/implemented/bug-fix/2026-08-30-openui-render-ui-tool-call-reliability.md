# Agent Note: `render_ui` tool-call reliability

Status: implemented

English | [中文](2026-08-30-openui-render-ui-tool-call-reliability.zh.md)

## Problem

[OpenUI generative-UI rendering](2026-08-23-openui-generative-ui-rendering.md) wired a model-facing `render_ui` tool and a web-client renderer, but rendering depends entirely on the model actually calling that tool — the client reads the parsed tree from the tool's persisted result and never re-parses raw text (a deliberate security decision). Observed in practice: the model instead wrote OpenUI Lang source directly as its chat reply text, with no `render_ui` call at all, so the chat client showed the literal DSL source instead of a table or chart.

Reading `dsh-tool-openui`'s actual generated system-prompt text (calling `promptText()` exactly as the package's existing call site did, with no options) showed why: `@openuidev/lang-core`'s built-in default `preamble` opens with "You are an AI assistant that responds using openui-lang... Your ENTIRE response must be valid openui-lang code — no markdown, no explanations, just openui-lang." That text is written for OpenUI/Thesys's own raw-completion architecture, where the model's entire reply IS the DSL with no wrapping tool call. Left in place, the system prompt actively instructed the model to do exactly the thing this fix exists to stop — not merely failed to teach the right thing.

## Decision

`dsh-tool-openui` now overrides `@openuidev/lang-core`'s default `preamble` via `promptText({ preamble, examples: [...] })`: the replacement preamble states that OpenUI Lang is sent only as the `render_ui` tool's `source` argument, never as the model's direct reply, and a worked example shows a correctly-formed call. This is the primary fix.

As a backstop, `dsh-tool-openui` registers a listener on `agent/turn-stopping` — the same serial hook `dsh-hooks-claude-code`/`dsh-hooks-codex` already use to force continuation on a failed check — that inspects a completed turn's final derived message: if its text parses cleanly via `dsh-openui-lang`'s own `parseSource()` to a non-trivial tree (at least one `Card`/`Table`/`List`/`BarChart`/`PieChart`; a bare `Heading`/`Text` root does not count), the listener calls `agent.steer(...)` with a corrective instruction quoting the offending source back, forcing the model to retry via `render_ui`. Corrections are capped per new `Config.maxCorrectionAttempts` (default 2) so a model that keeps not calling the tool cannot be steered indefinitely; once the cap is hit, the turn closes with its text answer unrendered.

The listener does **not** check whether the same message also carries a `render_ui` tool-call block alongside the offending text — an earlier draft of this decision assumed that check was needed (in case the model wrote the DSL as text AND called the tool correctly in one message) and it does not compile out to a no-op accidentally: driving the real agent loop (`dsh-agent-loop-testkit` + a scripted mock adapter) proved a message with ANY pending tool call — denied or not — is never the last derived message when `agent/turn-stopping` fires. The loop always defers turn closure to feed that tool's result back to the model first, and a tool result that ends the turn early via `concludesTurn` leaves a `user`/`tool`-sourced message last, not the assistant message — already excluded by the listener's `role !== 'assistant'` guard. So the check was unreachable dead code, not a needed guard, and was removed before shipping rather than kept "just in case."

This repo's LLM abstraction has no `tool_choice`/forced-tool-use field (`GenerateOptions` in `packages/llm/llm/src/types.ts` — an explicit MVP cut, consistent with the archived [drop-inert-request-knobs](../../archived/simplification/2026-07-04-drop-inert-request-knobs.md) precedent), so LLM-level tool forcing was not an available or in-scope mechanism; the fix works entirely at the prompting/self-correction layer this repo already has.

## Alternatives considered

**Add a `tool_choice`/forced-tool-use field to `GenerateOptions`.** Rejected: a cross-cutting request-layer change with no current second producer, against the repo's "require evidence for public choices" convention; the preamble was actively wrong, which is a cheaper and more targeted fix.

**Render raw, unvalidated OpenUI Lang found in assistant text directly in the client** (matching upstream OpenUI's raw-completion chat behavior more literally). Rejected: it reopens the original design's stated security decision that the client never re-parses raw model text — every rendered tree stays server-validated via an actual `render_ui` call, including one produced by a steered retry.

**Keep the same-message `render_ui` tool-call check "for safety" even though it never fires.** Rejected once proven dead by driving the real loop: keeping unreachable defensive code contradicts this repo's "don't add validation for scenarios that can't happen" convention, and the simpler function is easier to read and fully exercised by tests.

## Testing

`dsh-tool-openui`'s test suite (19 tests, 100% per-file coverage) drives a real agent loop (`dsh-agent-loop-testkit` + a scripted `MockAdapter`, no network) to prove: the prompt no longer contains the raw-completion instruction and does contain the worked example; the listener steers exactly once on unrouted non-trivial OpenUI Lang text and the model recovers via `render_ui`; a mid-turn message with a pending tool call is never inspected (only the turn's final message is); unparseable text and a trivial `Text`/`Heading`-only root never trigger a correction; the correction cap stops steering after the configured count; an empty max-tokens step (no trailing assistant message) is handled without steering; disposing the plugin fiber removes the listener (HMR-safety); and an invalid `maxCorrectionAttempts` fails loud at plugin load. `tsc --build`, `run-oxlint`, `verify-package-invariants`, `verify-cordis-config`, and both README doc-sync gates all pass for the touched package.

## Consequences

A model that writes renderable OpenUI Lang no longer silently shows the raw DSL as a chat message in the common case (the corrected preamble prevents it) and is self-corrected in the residual case (the turn-stopping listener), with no change to the client's rendering trust boundary. The cost: one small system-prompt preamble this repo now owns and must keep in sync if `@openuidev/lang-core` changes its own default meaningfully, and up to `maxCorrectionAttempts` extra request/response round trips on a miss.

## Deferred

No keyless ACP/headless snapshot fixture exists yet for `render_ui`'s wire shape or this correction path — the same gap [the original note](2026-08-23-openui-generative-ui-rendering.md) already flagged as outstanding, still not closed by this change. No TypeScript/Python SDK expected-output update exists either, for the same reason.

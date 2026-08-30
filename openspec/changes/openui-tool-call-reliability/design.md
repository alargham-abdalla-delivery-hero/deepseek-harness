## Context

`openui-generative-output` (implemented; see `.agents/notes/implemented/feature/2026-08-23-openui-generative-ui-rendering.md`) made `render_ui`'s rendering pipeline entirely dependent on the model actually issuing that tool call: `dsh-tool-openui` parses/validates the call's `source` server-side and projects the resulting tree through `output.presentationMeta`; `dsh-client-ui-openui` reads that tree back off the settled `ToolResultNode.meta` and renders it. A model that never calls the tool never enters this pipeline at all — its text is just an ordinary assistant message, rendered as markdown like any other.

Observed behavior: given a prompt that should produce a chart/table, the model instead emitted the OpenUI Lang source itself as the visible chat answer (variable declarations, `Stack`/`Card`/`Table`/`PieChart` calls, ending in a `root = Stack([...])` assignment) with no `render_ui` tool_use block anywhere in that turn. This is architecturally unsurprising: OpenUI/Thesys is a public, documented DSL, so a base model can reproduce its surface syntax from pretraining alone, independent of whether this harness ever taught it to route that syntax through a tool call.

Three structural facts constrain the fix, one of them decisive:

0. **The shipped system prompt actively instructs the model to answer directly in OpenUI Lang, bypassing the tool.** `tool-openui/src/index.ts:63` calls `promptText()` with no options, so `@openuidev/lang-core`'s built-in default `preamble` (verified by calling `promptText()` directly against this repo's installed `@openuidev/lang-core@0.2.15`) is injected verbatim as the first lines of the `tool:render_ui` system-prompt section:

   > "You are an AI assistant that responds using openui-lang, a declarative UI language. Your ENTIRE response must be valid openui-lang code — no markdown, no explanations, just openui-lang."

   This is `@openuidev/lang-core`'s own default, written for OpenUI/Thesys's native raw-completion architecture, where the model's entire reply IS the DSL and there is no wrapping tool call at all. It is not merely unhelpful in this repo's tool-call architecture — it directly contradicts it, telling the model in the model's own system prompt to do exactly the thing this change exists to stop. This is very likely the primary, direct cause of the observed behavior, not merely an absence of guidance.
1. **No request-layer tool-forcing exists.** `packages/llm/llm/src/types.ts`'s `GenerateOptions` has no `tool_choice`/`toolChoice` field; `packages/llm/llm/README.md` and `packages/llm/llm-deepseek/README.md` document this as an explicit MVP cut ("the vocabulary grows when a producer lands"), consistent with the archived `drop-inert-request-knobs` Agent Note's precedent of removing exactly this kind of speculative request knob. Adding one is a cross-cutting `GenerateOptions` + DeepSeek-serializer change with no current second producer — out of scope here per the repo's "require evidence for public choices" convention.
2. **The system prompt, once the preamble is fixed, still only teaches grammar, not usage.** `@openuidev/lang-core`'s `PromptOptions` accepts an `examples` field (rendered unconditionally into a `## Examples` section, regardless of `toolCalls`/`tools` — confirmed by reading `generatePrompt()`'s source directly) that feeds worked examples into the prompt, but since nothing is passed today, the model sees component signatures and syntax rules and no worked example of the tool being called correctly.

What the agent loop does provide, already exercised in production by two other plugins for the same shape of problem: `agent/turn-stopping` (`packages/core/agent/src/runtime-types.ts`, dispatched serially in `packages/core/agent-loop/src/agent.ts` after `step()` completes and before turn close) lets a listener inspect the turn that just completed and call `agent.steer(message)` to force another step instead of letting the turn close. `hooks-claude-code`/`hooks-codex` both use exactly this pattern (`ctx.on('agent/turn-stopping', ...)` → `agent.steer(createUserMessage(...))`) to force continuation when a check on the completed turn fails.

## Goals / Non-Goals

**Goals:**
- Stop the system prompt from actively instructing the model to answer directly in OpenUI Lang — the shipped default `preamble` contradicts this repo's tool-call architecture and is the primary fix.
- Make a `render_ui`-eligible response (the model producing genuine OpenUI Lang) reliably reach the chat client as rendered UI, not raw DSL text, without changing what "reach the chat client as rendered UI" means (still: server-validated tree, client renders only that).
- Reuse existing, real extension points (`agent/turn-stopping`, `promptText(options)`) rather than adding a new one.
- Bound the correction mechanism so it cannot loop indefinitely against a model that keeps not calling the tool.

**Non-Goals:**
- Forcing tool use at the LLM request layer (`tool_choice`). No such field exists in this repo's LLM abstraction today; introducing one is a larger, cross-cutting change with no current second consumer and is explicitly out of scope for this change.
- Client-side rendering of raw, unvalidated assistant text. The client still never re-parses raw text; every rendered tree is still `render_ui`-validated server-side output. A steered retry still goes through the exact same tool-call path as a model that got it right the first time.
- Detecting or correcting anything other than the specific "OpenUI Lang written as prose" shape. A model response that merely mentions "OpenUI" or discusses the DSL in prose without producing a parseable tree is not a match (see Decision 2's precision requirement) and is left alone.
- Retroactively fixing already-logged turns. This only affects turns completing after the change ships; a past session showing raw DSL as text stays exactly as logged (append-only session log; no replay/format change).

## Decisions

**1. Override the default `preamble`; do not rely on `@openuidev/lang-core`'s built-in text.**

Verified directly: calling `promptText()` exactly as `tool-openui/src/index.ts:63` does today produces a system-prompt section opening with `@openuidev/lang-core`'s built-in `PREAMBLE` constant — "You are an AI assistant that responds using openui-lang... Your ENTIRE response must be valid openui-lang code — no markdown, no explanations, just openui-lang." `PromptOptions.preamble` (an already-supported field: `generatePrompt()` uses `spec.preamble ?? PREAMBLE`) lets a caller replace this outright. The replacement preamble must state plainly that OpenUI Lang is sent only as the `render_ui` tool's `source` argument — never as the model's direct reply — and that ordinary prose and other tools remain normal for everything else. This is the single highest-leverage change in this proposal: it removes an active instruction to do the wrong thing, rather than merely failing to teach the right one.

**2. Both remaining mechanisms live inside `dsh-tool-openui`; no new package.**

The worked example and the preamble override are both `promptText(options)` argument changes at the same call site that already exists (`tool-openui/src/index.ts:63`). The turn-completion listener is new code in the same package's `apply(ctx)`, since it exists only to serve `render_ui`'s reliability — it is not a generic capability any other tool package needs today, so it does not belong in `dsh-openui-lang` (a plain library with no Cordis lifecycle) or a new shared package. `agent/turn-stopping` and `Agent.steer` are reached directly off the event payload and the injected `Agent` instance — verified against `packages/hooks/hooks-claude-code/src/index.ts`, which listens to `agent/turn-stopping` with only `inject = ['shell']` declared, no `agent`-capability injection — so `dsh-tool-openui` needs no new `inject` entry either (this resolves Open Question 4 below without ambiguity).

**3. Detection reuses the real validator; it is not a text heuristic.**

The listener does not pattern-match text against a regex resembling "looks like OpenUI Lang." It calls `dsh-openui-lang`'s existing `parseSource()` (the same function `render_ui`'s `execute()` calls) against every text block in the just-completed assistant message. A match requires: `root !== null`, `errors.length === 0`, `incomplete === false`, and the parsed root using at least one non-trivial curated component (not e.g. a bare `Text("...")` — see Open Question 1 for where exactly to draw this line) — the same success condition `render_ui`'s own `summarize()` uses for "cleanly rendered." This reuses the shared vocabulary invariant the original design established (taught grammar = server validator = client renderer) rather than inventing a fourth, looser notion of "looks like OpenUI Lang."

**4. The listener only ever inspects a message that structurally cannot contain a tool call — verified against the real agent loop, not assumed.**

`agent.session.deriveMessages()` returns the full derived transcript; the listener reads the last derived message, and when it is an assistant message, inspects its text content. An earlier draft of this decision proposed also checking whether that same message carries a `render_ui` tool-call block, reasoning that a model could write the DSL as text AND call the tool correctly in one message. Driving the real agent loop (via `dsh-agent-loop-testkit`) proved that check unreachable: a message with ANY pending tool call — denied or not — is never the last derived message when `agent/turn-stopping` fires, because the loop always defers turn closure to feed that tool's result back to the model first (and a tool result that ends the turn early via `concludesTurn` leaves a `user`/`tool`-sourced message last, not the assistant message, which the `role !== 'assistant'` guard below already excludes). `agent/turn-stopping` fires only when a turn is about to close — confirmed both by the hook's own doc comment and by this empirical test — so the last derived message at firing time is exactly the turn's candidate final answer, with no separate tool-call check or turn-number correlation needed.

**5. Per-turn correction cap, enforced by this change, not deferred.**

`hooks-claude-code`'s existing steer-on-`agent/turn-stopping` listener carries a `TODO(stop-loop-guard)` acknowledging it has no cap on consecutive forced continuations yet. This change does not inherit that gap: it tracks a bounded counter (e.g. per `Agent`/session, reset once a turn closes without triggering a correction) and stops steering after a small fixed number of consecutive corrections for the same underlying condition, letting the offending turn's text stand rather than looping forever. The exact cap value and where the counter lives (in-memory plugin state scoped to the agent vs. a durable counter) is Open Question 2.

**6. The corrective message is plain text via `agent.steer(createUserMessage(...))`, matching existing precedent exactly.**

No new message kind, no new session event type — `agent.steer` already exists for this. The steered text names the mistake concretely (e.g. quotes back that OpenUI Lang was found in the reply and instructs the model to resend it via `render_ui`) so the model has a directly actionable correction, following the same shape as `hooks-claude-code`'s Stop-hook-denial message.

## Risks / Trade-offs

- **[Risk] False positive: a legitimate, deliberate prose explanation of OpenUI Lang syntax gets steered as if it were a rendering mistake.** E.g. a user explicitly asks "show me what OpenUI Lang syntax looks like" and the model correctly answers in prose. → Mitigation: Decision 2's requirement that the parsed result be a clean, non-trivial tree reduces but does not eliminate this — a syntactically-valid illustrative example is indistinguishable from an accidental one by parsing alone. Revisit if this proves common in practice (Open Question 3).
- **[Risk] Extra latency/token cost per corrected turn.** A detected miss costs one additional step (steer + regenerate) before the user sees a final answer. → Accepted: bounded by Decision 4's cap; the alternative (showing raw DSL text to the user) is worse.
- **[Risk] The worked example in the system prompt could itself leak into the model's copied-verbatim habits** (e.g. the model returns the example's literal content instead of task-relevant content). → Mitigation: keep the example clearly illustrative and distinct from any plausible real user request (per `docs/cookbook/adding-a-tool.md`'s general prompt-authoring guidance); this is the standard risk of any few-shot example and not unique to this change.
- **[Trade-off] No LLM-level tool forcing.** Accepted per Non-Goals — the fix works at the prompting/self-correction layer this repo already has, not a request-layer feature this repo does not have.
- **[Risk] A future `@openuidev/lang-core` upgrade changes the default `preamble` again** (e.g. adds content this repo's override then loses). → Mitigation: the override is a small, explicit, hand-authored string owned by this repo, not a patch to the library's default — an upstream change to `PREAMBLE` cannot silently alter this repo's system prompt, though a future upgrade could still change unrelated generated sections (syntax rules, component signatures) that this change does not touch.

## Migration Plan

Purely additive within `dsh-tool-openui`: no wire-format change, no `SESSION_FORMAT_VERSION` bump, no change to `render_ui`'s schema or `dsh-client-ui-openui`. A steered corrective turn appears in the session log as an ordinary injected user message (already a supported, logged event kind), so replay of a session recorded after this change reproduces the same corrected behavior.

- **Rollout**: ships alongside the existing `tool-openui` registration in `packages/bundle/base` — no new opt-in surface, since it only strengthens an already-default tool's reliability.
- **Rollback**: revert `dsh-tool-openui`'s changes; the tool and system prompt return to their current (pre-change) behavior with no data migration.

## Open Questions

1. Where exactly is the line for "non-trivial" in Decision 2's match condition — does a bare single `Text(...)`/`Heading(...)` root count, or only a root using at least one of `Card`/`Table`/`List`/`BarChart`/`PieChart`? Needs a decision before implementation to avoid over- or under-firing on simple cases.
2. What is the correction cap's exact value and scope (per-turn attempt count vs. per-session count of distinct occurrences), and does the counter need to survive a process restart (durable) or is in-memory-per-agent sufficient given corrections are expected to be rare? Needs sign-off before implementation.
3. Should the corrective message additionally tell the model to avoid discussing OpenUI Lang syntax in prose in general, to reduce the false-positive risk noted above, or is that too broad a behavioral instruction to inject reactively? Revisit after initial rollout data.
4. ~~Does `dsh-tool-openui` gaining an `agent`-capability injection (needed for `agent/turn-stopping`/`agent.steer`) require any change to its existing package dependency graph?~~ Resolved: no new `inject` entry is needed. `agent/turn-stopping` is a globally-reachable typed event (`ctx.on(...)`) and its payload carries the `Agent` instance directly, exactly as `packages/hooks/hooks-claude-code/src/index.ts` already consumes it with no `agent`-capability injection declared (Decision 2 above).

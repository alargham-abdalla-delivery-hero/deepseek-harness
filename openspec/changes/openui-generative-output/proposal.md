## Why

Model answers are plain text/markdown today, so anything better shown as a chart, table, or interactive card renders as a wall of prose in the web chat client. [OpenUI](https://github.com/thesysdev/openui) (Thesys) is an MIT-licensed, self-hosted, bring-your-own-LLM generative-UI framework: the model is prompted to emit **OpenUI Lang**, a compact DSL, which a client-side parser turns into a typed element tree and renders as real React components. It requires no Thesys backend or API key, which matches this harness's no-hosted-dependency, self-hostable posture. The harness already has the exact seam this needs — a model-facing tool with a call/result render intent, plus a client-side keyed `tool.call.toolview` slot (`packages/client/ui-tool`) that lets one plugin fully own a specific tool's rendering — so this is additive, not a change to the shared render-intent union.

## What Changes

- Add a model-facing `render_ui` tool that accepts an OpenUI Lang source string, parses/validates it server-side against a fixed component library, and returns the canonical parsed element tree as its result value.
- Add a system-prompt section (gated on the tool being registered) teaching the model OpenUI Lang syntax and the available component vocabulary, generated from the same library definition via `library.prompt()` so the taught grammar and the server-side validator never drift apart.
- Add a shared, framework-agnostic library-definition package (`@openuidev/lang-core`) that is the single source of truth for the allowed component vocabulary, consumed by both the server tool (prompt text + parse/validate) and the web client (React bindings).
- Add a web client plugin that registers a keyed `tool.call.toolview` for `render_ui`, rendering the parsed element tree into interactive React UI in the chat turn via `@openuidev/react-lang`.
- Non-web hosts (CLI TUI, ACP) get the tool's `generic` card fallback (raw OpenUI Lang / a plain-text description) since there is no capable renderer there — the tool result content itself stays useful without a UI.
- Introduce new runtime dependencies: `@openuidev/lang-core` (server + client) and `@openuidev/react-lang` (client only); both MIT-licensed, no hosted backend, no API key, no default *runtime* network calls — but `@openuidev/lang-core` sends pseudonymous *install-time* telemetry to PostHog by default (`OPENUI_TELEMETRY_DISABLED=1`/`DO_NOT_TRACK=1` disables it; see design.md).

## Capabilities

### New Capabilities
- `openui-render-tool`: the model-facing `render_ui` tool, its input/output schemas, the fixed component library, server-side OpenUI Lang parsing/validation, and the system-prompt guidance teaching the model the DSL.
- `openui-chat-rendering`: the web client's keyed toolview registration for `render_ui`, mapping the parsed element tree to live React components inside the chat turn, and the non-web fallback behavior.

### Modified Capabilities
(none — this is additive; the tool render-intent union in `packages/core/tools/src/presentation.ts` is unchanged)

## Impact

- **New packages**: a server-side tool package (model-facing tool + system-prompt section) and a client package under `packages/client/` (keyed toolview + React rendering), sharing one library-definition module so the taught grammar, the server validator, and the client renderer's component set stay a single source of truth.
- **Dependencies**: adds `@openuidev/lang-core` (server + client, framework-agnostic) and `@openuidev/react-lang` (client, React renderer); both MIT, no hosted backend, no API key, no default runtime network egress. `@openuidev/lang-core` does phone home pseudonymous telemetry at install time by default (see Security below and design.md) — this must be disabled in this repo's install environment, not silently accepted.
- **System prompt**: adds one gated section (only present when the tool is registered) with the DSL syntax rules and component signatures; increases prompt token cost for sessions with this plugin enabled.
- **Security**: model-generated OpenUI Lang drives what renders in the browser DOM; the fixed, hand-authored, server-validated component library (no raw-HTML/arbitrary-markup component, no `Query()`/`Mutation()`/tool-calling wiring — see design.md Non-Goals) and structural (not string-eval) rendering are required to keep this from becoming an XSS vector — this is a hard design constraint, not an implementation nicety. Also disable `@openuidev/lang-core`'s default install-time telemetry (`OPENUI_TELEMETRY_DISABLED=1`) before this dependency lands anywhere.
- **No changes** to `packages/core/tools/src/presentation.ts`, the wire protocol, or any existing tool.

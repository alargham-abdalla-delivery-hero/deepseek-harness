# @deepseek-ai/dsh-openui-lang

English | [中文](README.zh.md)

The shared [OpenUI Lang](https://github.com/thesysdev/openui) component vocabulary: one curated `Library` definition consumed by both [`@deepseek-ai/dsh-tool-openui`](../tool-openui/README.md) (server-side validation and system-prompt generation) and [`@deepseek-ai/dsh-client-ui-openui`](../../client/ui-openui/README.md) (the web chat renderer).

## What it does

Exports `buildLibrary<C>(renderers: ComponentRenderers<C>)`, which builds an [`@openuidev/lang-core`](https://www.npmjs.com/package/@openuidev/lang-core) `Library` from one fixed, curated component graph — `Stack` (root), `Card`, `Heading`, `Text`, `List`/`ListItem`, `Table`. `C` is the opaque per-consumer renderer payload lang-core never inspects: this package's own server `Library` passes `undefined` for every component (no rendering, only validation and prompt text); the web client passes a real React component per name. Both call sites build from the identical `name`/`props`/`description` graph, so the taught grammar, the server-side validator, and the client's drawable component set cannot silently drift apart.

Also exports:
- `promptText(options?)` — the OpenUI Lang syntax rules + component signatures, generated from the server `Library` via `Library.prompt()`.
- `parseSource(source)` — parses and validates one OpenUI Lang string against the server `Library`'s JSON Schema (`createParser(library.toJSONSchema()).parse(source)`), returning `{ root, errors, incomplete }`. This mirrors OpenUI's own lenient parse behavior: an unknown component or invalid prop is dropped from the tree and reported in `errors`, not thrown — only a genuine parser implementation failure should propagate as a thrown error.

## Why a curated, hand-authored vocabulary

Neither `@openuidev/lang-core` nor `@openuidev/react-lang` ships a built-in component library — every component is author-defined via `defineComponent`. This package hand-authors a small, reviewed set instead of depending on the separate, unreviewed `@openuidev/react-ui` prebuilt package: no component here accepts a URL, raw markup, or arbitrary script, which keeps the web renderer's XSS surface closed by construction rather than by trusting a third party's implementation.

## Export shape

A plain module (no `apply`/`inject`/Cordis registration) — this package has no plugin lifecycle of its own; it is a pure library consumed directly by its two Cordis-plugin dependents.

## Model Experience

### System-prompt contribution

#### What the model sees

`promptText()`'s output, when [`dsh-tool-openui`](../tool-openui/README.md) contributes it as a system-prompt section: OpenUI Lang syntax rules and the seven curated component signatures (name, props, description).

#### Token effect

Fixed cost on every request where the owning tool is registered; proportional to the size of the curated component set (kept intentionally small).

#### KV Cache effect

Prefix-stable while the component vocabulary is unchanged; adding or removing a component changes the generated prompt text.

## Known Limitations and Deferred Work

- **`@openuidev/lang-core` sends pseudonymous installation telemetry to PostHog by default** (a random install ID, a salted-hash project identifier, and Lang/Node/OS/package-manager versions — no source, prompts, paths, or repository URLs per its documented disclosure). Set `OPENUI_TELEMETRY_DISABLED=1` (or rely on an existing `DO_NOT_TRACK=1`) wherever this package is installed. This repository's default pnpm configuration does not run third-party postinstall scripts unless explicitly approved (`pnpm approve-builds`) — leave `@openuidev/lang-core`'s build script unapproved rather than opting in.
- **The curated component set is intentionally small** (`Stack`, `Card`, `Heading`, `Text`, `List`/`ListItem`, `Table`) and has no component accepting a URL, raw markup, or script. Expand only against an evidenced product need, with the same security review this initial set received.
- **No `Query()`/`Mutation()`/`$variables` wiring.** OpenUI Lang's reactive runtime (tool-calling from within rendered UI) is out of scope; this package only builds the static display vocabulary.

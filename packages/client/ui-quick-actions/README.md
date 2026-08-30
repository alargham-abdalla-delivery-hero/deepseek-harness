---
description: "Composer quick-action row: one-click buttons above the input, backed by an injectable registry, with overflow entries in a side-anchored \"More\" menu."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-quick-actions

English | [中文](README.zh.md)

## Summary

This package renders a row of one-click quick-action buttons above the composer, registered into `conversation.composer.dock` ahead of the shipped stats line. Other plugins contribute entries through `ctx.quickActions.register(entry)`; selecting an entry writes its `insertText` into the composer draft without submitting, so the user can edit before sending. Entries that do not fit the measured row width — or that are registered as overflow — spill into a "More" menu, recomputed on every row resize. This plugin ships eight default entries as a starting point; a deployment can add or replace entries from another plugin without touching this package's source.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `ui-conversation`; `QuickActionsRow` then registers itself into the composer's `conversation.composer.dock` band (order -10, ahead of the shipped stats line), matching the composer card's own width so the row's edges align with it.

### Registering entries

Other plugins contribute entries through `ctx.quickActions.register(entry)` (mirrors `ctx.inputTriggers`'s registration face): a plain `{ id, label, insertText, overflow?, order }` object, disposer-returning, duplicate id throws.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The service derives a `{ visible, overflow }` split from the flat entry list on every register/dispose and republishes it through a `SnapshotStore`; `overflow`-flagged entries always land in the "More" menu (the existing `Menu` primitive, side-anchored to the button), while `visible`-flagged entries render as row buttons up to however many the measured row width actually fits — any that do not fit spill into the same "More" menu. Selecting any entry — a row button or a menu item — writes its `insertText` into the current session's composer draft through `inputActions.setDraft` (the same face `/` commands and file-mention insertion use) and never submits. Every control disables while the composer is adjudicating or submitting a message, mirroring the InputBar's own busy gate.

This plugin ships four visible default entries (Lead generation, Income Statements, Balance sheet, Cash Flow Statement) plus four overflow entries surfaced only through "More" (Market Research, Competitor Analysis, Financial Forecast, Investor Pitch), all registered at `apply()` through the same `register` call any other plugin would use.

The `/client` exports are the plugin body (`apply`/`inject`), `QuickActionsService`, `QuickActionsRow`, and the contract types (`QuickActionEntry`, `QuickActionsServiceContract`, `QuickActionsSnapshot`).

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as the row only writes composer text a person can edit before sending; the resulting prompt reaches the model through the ordinary composer submission path, which this package plays no part in.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Fixed default entries, no config surface** — the eight shipped labels/insert-texts are not configurable from `cordis.yml`. A deployment wanting different defaults currently has to register additional entries from another plugin and dispose these, or fork the constant; a `Config` surface is deferred until a real second consumer needs different defaults.
- **No RTL-aware overflow side** — the "More" menu always opens `side="right"`; the composer has no documented right-to-left handling elsewhere yet, so this follows that precedent rather than solving it here.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

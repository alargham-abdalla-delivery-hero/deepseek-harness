---
description: "The openui group map: the shared OpenUI Lang component vocabulary and the model-facing render_ui tool that validates model output against it, for users and maintainers navigating the group."
kind: "package-group"
---

# openui/ — OpenUI Lang generative-UI capability family

English | [中文](README.zh.md)

The [OpenUI Lang](https://github.com/thesysdev/openui) capability: a shared, hand-curated component vocabulary plus the model-facing `render_ui` tool that validates model output against it. There is no replaceable provider — the vocabulary is a fixed shared definition consumed by both the server tool and the web client's renderer ([`@deepseek-ai/dsh-client-ui-openui`](../client/ui-openui/README.md)).

| Package | Role | ctx key |
|---|---|---|
| [`openui-lang/`](openui-lang/README.md) | Owns the curated component vocabulary, OpenUI Lang prompt generation, and server-side parsing/validation. | (no service; plain library) |
| [`tool-openui/`](tool-openui/README.md) | Registers the `render_ui` tool and its system-prompt grammar section. | (registers on `ctx.tools`) |

Registered by default (`packages/bundle/base`, `packages/bundle/web-app`) — see `openui-lang`'s and `tool-openui`'s READMEs for the install-time dependency disclosure (`openspec/changes/openui-generative-output/design.md`).

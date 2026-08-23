# web-openui-demo

Demonstration of the `render_ui` / [OpenUI](https://github.com/thesysdev/openui) generative-UI capability: the model calls `render_ui` with OpenUI Lang source, and the web chat client renders it as live UI instead of the generic fallback card. See [`@deepseek-ai/dsh-tool-openui`](../../packages/openui/tool-openui/README.md) and [`@deepseek-ai/dsh-client-ui-openui`](../../packages/client/ui-openui/README.md) for the tool and renderer contracts.

Not part of any default preset (an opt-in overlay, like `web-cordis`) — see `openspec/changes/openui-generative-output/design.md` for the rollout rationale, including the `@deepseek-ai/dsh-openui-lang` install-time telemetry disclosure.

## Run it

```sh
pnpm run demo:openui
```

Requires `DEEPSEEK_API_KEY`. Opens on `http://127.0.0.1:3082` (off the default `3080` and `web-cordis`'s `3081`).

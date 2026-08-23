# web-openui-demo

[English](README.md) | 中文

`render_ui` / [OpenUI](https://github.com/thesysdev/openui) 生成式 UI 能力的演示：模型以 OpenUI Lang 源码调用 `render_ui`，Web 聊天客户端将其渲染为实时 UI，而不是使用通用回退卡片。工具与渲染器的约定见 [`@deepseek-ai/dsh-tool-openui`](../../packages/openui/tool-openui/README.zh.md) 与 [`@deepseek-ai/dsh-client-ui-openui`](../../packages/client/ui-openui/README.zh.md)。

不属于任何默认 preset（一个 opt-in overlay，与 `web-cordis` 相同）——上线理由见 `openspec/changes/openui-generative-output/design.md`，其中包括 `@deepseek-ai/dsh-openui-lang` 的安装期遥测披露。

## 运行

```sh
pnpm run demo:openui
```

需要 `DEEPSEEK_API_KEY`。在 `http://127.0.0.1:3082` 上打开（区别于默认的 `3080` 和 `web-cordis` 使用的 `3081`）。

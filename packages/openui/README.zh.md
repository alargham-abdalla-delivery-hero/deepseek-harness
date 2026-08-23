# openui/ — OpenUI Lang 生成式 UI 能力家族

[English](README.md) | 中文

[OpenUI Lang](https://github.com/thesysdev/openui) 能力：一套共享的、人工整理的组件词汇表，加上对模型公开的 `render_ui` 工具，用于校验模型输出是否符合该词汇表。这里没有可替换的提供方——该词汇表是一份固定的共享定义，同时被服务端工具和 Web 客户端渲染器（[`@deepseek-ai/dsh-client-ui-openui`](../client/ui-openui/README.zh.md)）使用。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`openui-lang/`](openui-lang/README.zh.md) | 拥有经过整理的组件词汇表、OpenUI Lang 提示词生成，以及服务端解析／校验。 | （无服务；纯库） |
| [`tool-openui/`](tool-openui/README.zh.md) | 注册 `render_ui` 工具及其系统提示词语法小节。 | （注册到 `ctx.tools`） |

未接入任何默认 preset——安装时的依赖披露与可选启用（opt-in）的落地理由（`openspec/changes/openui-generative-output/design.md`），参见 `openui-lang` 与 `tool-openui` 各自的 README。

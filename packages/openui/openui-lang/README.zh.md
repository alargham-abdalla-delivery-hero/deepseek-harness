---
description: "共享的 OpenUI Lang 组件词汇，同时被服务端 render_ui 工具与网页聊天渲染器消费，因此教给模型的语法、校验器与可绘制组件集合不会产生分歧。"
kind: "package-reference"
---

# @deepseek-ai/dsh-openui-lang

[English](README.md) | 中文

## 概述

本包是共享的 [OpenUI Lang](https://github.com/thesysdev/openui) 组件词汇（vocabulary）：一份经过整理的 `Library` 定义，同时被 [`@deepseek-ai/dsh-tool-openui`](../tool-openui/README.zh.md)（服务端校验与系统提示词生成）与 [`@deepseek-ai/dsh-client-ui-openui`](../../client/ui-openui/README.zh.md)（网页聊天渲染器）消费。它是一个纯库，没有自己的 Cordis 插件生命周期。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

导出 `buildLibrary<C>(renderers: ComponentRenderers<C>)`，用于从一份固定的、经过整理的组件图——`Stack`（根组件）、`Card`、`Heading`、`Text`、`List`／`ListItem`、`Table`、`BarChart`、`PieChart`——构建出一个 [`@openuidev/lang-core`](https://www.npmjs.com/package/@openuidev/lang-core) 的 `Library`。`C` 是 lang-core 从不检查的、按消费方各异的不透明渲染载荷：本包自身的服务端 `Library` 对每个组件都传入 `undefined`（不做渲染，只做校验和提示词文本生成）；网页客户端则为每个组件名传入一个真实的 React 组件。两个调用点都基于同一份 `name`／`props`／`description` 图进行构建，因此教给模型的语法、服务端校验器与客户端可绘制的组件集合不会悄然产生分歧。

此外还导出：
- `promptText(options?)`——OpenUI Lang 的语法规则与组件签名，通过 `Library.prompt()` 从服务端 `Library` 生成。
- `parseSource(source)`——依据服务端 `Library` 的 JSON Schema（`createParser(library.toJSONSchema()).parse(source)`）解析并校验一段 OpenUI Lang 字符串，返回 `{ root, errors, incomplete }`。这与 OpenUI 自身的宽松解析行为一致：未知组件或非法 prop 会从树中被剔除并记录到 `errors` 中，而不会抛出异常——只有真正的解析器实现故障才会以抛出异常的形式传播。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 为何采用人工整理的词汇集

`@openuidev/lang-core` 与 `@openuidev/react-lang` 均不内置组件库——每个组件都通过 `defineComponent` 由作者自行定义。本包没有依赖另一个独立的、未经审查的 `@openuidev/react-ui` 预制包，而是人工编写并审查了一小组组件：这里的任何组件都不接受 URL、原始标记（markup）或任意脚本，这使网页渲染器的 XSS 攻击面从设计上就保持封闭，而不是依赖对第三方实现的信任。

### 导出形式

一个普通模块（没有 `apply`／`inject`／Cordis 注册）——本包本身没有插件生命周期；它是一个纯库，被其两个 Cordis 插件消费方直接消费。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词贡献

#### 模型看到的内容

`promptText()` 的输出，当 [`dsh-tool-openui`](../tool-openui/README.zh.md) 将其贡献为系统提示词的一个小节时：OpenUI Lang 的语法规则与九个经过整理的组件签名（名称、props、描述）。

#### Token 影响

在注册了所属工具的每次请求中都是固定开销；与经过整理的组件集合大小成正比（该集合被有意保持得很小）。

#### KV Cache 影响

只要组件词汇不变，前缀就保持稳定；新增或移除一个组件会改变生成的提示词文本。

## 已知限制与暂缓事项

- **`@openuidev/lang-core` 默认会向 PostHog 发送假名化（pseudonymous）的安装遥测数据**（一个随机安装 ID、一个加盐哈希的项目标识符，以及 Lang／Node／OS／包管理器的版本号——根据其文档披露，不包含源代码、提示词、路径或仓库 URL）。在安装本包的任何位置设置 `OPENUI_TELEMETRY_DISABLED=1`（或依赖已有的 `DO_NOT_TRACK=1`）。本仓库默认的 pnpm 配置不会运行第三方的 postinstall 脚本，除非显式批准（`pnpm approve-builds`）——应让 `@openuidev/lang-core` 的构建脚本保持未批准状态，而不是选择启用。
- **经过整理的组件集合被有意保持得很小**（`Stack`、`Card`、`Heading`、`Text`、`List`／`ListItem`、`Table`、`BarChart`、`PieChart`），且没有任何组件接受 URL、原始标记或脚本。`BarChart`／`PieChart` 使用纯手写 SVG 渲染，未引入图表库依赖。只有在有证据支撑的产品需求下才应扩充，并且要经过与这一初始集合相同的安全审查。
- **没有 `Query()`／`Mutation()`／`$variables` 接线。** OpenUI Lang 的响应式运行时（从渲染出的 UI 内部发起工具调用）不在本包范围内；本包只构建静态展示词汇。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

无。

</details>

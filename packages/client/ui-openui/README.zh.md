---
description: "网页聊天客户端中 render_ui 的 keyed tool.call.toolview：把已结算结果中持久化的 OpenUI 元素树，在聊天轮次里渲染为实时 React UI。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-openui

[English](README.md) | 中文

## 概述

本包是网页聊天 Client 中 `render_ui` 的 keyed `tool.call.toolview`：把已结算结果中持久化的 [OpenUI](https://github.com/thesysdev/openui) element tree，在聊天轮次里渲染为实时 React UI。安装本插件后，`render_ui` 专属的通用回退卡片会被替换；没有安装本插件的宿主（CLI、ACP）仍保留通用卡片。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将本插件与 [`@deepseek-ai/dsh-tool-openui`](../../openui/tool-openui/README.zh.md) 一同挂载。它在 `tool.call.toolview` slot（[`@deepseek-ai/dsh-client-ui-tool`](../ui-tool/README.zh.md)）上以 `key: 'render_ui'` 注册 `RenderUiView`，采用与 `webToolview` 注册 `WebRow` 相同的模式。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

`RenderUiView` 读取已结算 `ToolResultNode` 上的 `result.meta`——即 [`@deepseek-ai/dsh-tool-openui`](../../openui/tool-openui/README.zh.md) 的 `output.presentationMeta` 投影出的原始 JSON——并用一个手写的小型递归 renderer（`renderElement`）遍历它，依据每个 element 的 `typeName`，分发到基于 [`@deepseek-ai/dsh-openui-lang`](../../openui/openui-lang/README.zh.md) 共享组件规格构建的、经过整理的组件图（component map）。尚在进行中的调用（还没有 `meta`）会显示一个纯文本的 "Rendering UI…" 占位符；已结算但存在校验错误或没有可解析根节点的调用，则会显示人类可读的错误信息，而不是渲染出的树。

### 为何不用 `@openuidev/react-lang` 的 `<Renderer>`

`@openuidev/react-lang` 的 `<Renderer response={string} library={Library}>` 设计用于接收**原始的 OpenUI Lang 文本**，并在客户端自行解析。本包则不同：它渲染的是 `dsh-tool-openui` 已经在服务端解析并校验过的树——客户端从不重新解析原始文本（参见 `openspec/changes/openui-generative-output/design.md` 的 Decision 3/4）——因此本包完全不依赖 `@openuidev/react-lang`；只需要 `@deepseek-ai/dsh-openui-lang` 的类型和 `buildLibrary`（这里仅用作编译期一致性检查，确认每个经过整理的组件名称在此处都有对应的 React 实现）。

### 渲染

每个不在经过整理的组件集合中的 element（这种情况出现在旧版 client 与新版 server 词汇不匹配时），都会渲染出一个可见的 `Unsupported UI element: <name>` 回退提示，而不是被静默丢弃，也不会抛出异常从而破坏聊天轮次的其余部分。

### 导出形式

与每个 `ui-*` client 插件一样，有两个入口点：`src/index.ts` 是一个空操作的 Host-loader 桩（Host 环节从不运行本插件的真实行为），`src/client/index.ts` 是真正的浏览器端注册逻辑，由本包自身的 `tsdown.config.ts` 构建进 `lib/client.js`。

</details>

-----

<a id="model-experience"></a>
## 模型体验

间接体现，通过 `render_ui` 的工具 schema 和结果文本；模型看到的一切都由 [`dsh-tool-openui`](../../openui/tool-openui/README.zh.md) 拥有。

#### KV Cache 影响

无影响。本包只为查看聊天的人类用户渲染内容，从不参与模型请求。

## 已知限制与暂缓事项

- **不支持流式／局部渲染。** 只有在 `render_ui` 结算后才会渲染，这与其他每一个 keyed toolview 的 pending/settled 划分保持一致；参见 design.md 中已接受的权衡取舍。
- **不支持 `Query()`／`Mutation()`／响应式 `$variable`。** 按设计不在本包范围内——参见 `dsh-openui-lang` 的 README。
- **样式极简。** 各组件渲染为纯语义化 HTML（`h1`–`h3`、`p`、`ul`/`li`、`table`、`section`、`div`）或纯手写 SVG（`BarChart`、`PieChart`——普通的 `<rect>`/`<path>` 图形，未引入图表库依赖），并带有 `data-openui-component` 属性以便测试；尚未集成任何设计系统。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

无。

</details>

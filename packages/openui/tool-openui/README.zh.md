---
description: "面向模型的 render_ui 工具：解析并校验 OpenUI Lang，讲解语法给模型，并在模型把该 DSL 直接写成聊天文本而非调用工具时进行自我纠正。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-openui

[English](README.md) | 中文

## 概述

本包注册面向模型的 `render_ui` 工具：解析并校验 [OpenUI Lang](https://github.com/thesysdev/openui)，依据共享的、经过整理的组件词汇表（[`@deepseek-ai/dsh-openui-lang`](../openui-lang/README.zh.md)），通过系统提示词小节向模型讲解该语法，并在模型把该 DSL 直接写成聊天文本而不是调用工具时，把它纠正回工具调用路径上。语法错误、未知组件或缺失必填 prop 都不会被当作抛出的错误——它们是模型自身可恢复的输出，会被报告回去，供模型在下一次调用时纠正。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

挂载本插件即可注册 `render_ui` 工具。它调用 `dsh-openui-lang` 的 `parseSource()`，返回 `{ root, errors, incomplete }`——这是共享包自身的宽松解析结果。只有解析器实现本身真正失败时才会抛出错误。

### 最小配置

```yaml
config:
  maxCorrectionAttempts: 2  # default; maximum consecutive corrective steers per agent before giving up
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxCorrectionAttempts` | `2` | 针对一直不调用 `render_ui`、反复把 OpenUI Lang 写成聊天文本的模型，在放弃并允许该轮次以未渲染的文本回答收尾之前，允许的最大连续纠正性引导次数。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 功能

在 `ctx.tools` 上注册一个工具 `render_ui(source: string)`，并在 `ctx.systemPrompt` 上注册一个系统提示词小节。`execute` 用 `dsh-openui-lang` 的 `parseSource()` 解析 `source`，返回 `{ root, errors, incomplete }`。

系统提示词小节基于 `dsh-openui-lang` 生成的语法文本构建，但本包直接补充了两项内容：一份替换用的 `preamble`（见下文"为何要覆盖 preamble"）和一个展示如何正确调用 `render_ui` 的示例，二者都通过 `promptText({ preamble, examples: [...] })` 传入。

### 为何要覆盖 preamble

`@openuidev/lang-core` 内置的默认 `preamble`——在调用 `promptText()` 且未传入 `preamble` 选项时使用——写的是："You are an AI assistant that responds using openui-lang... Your ENTIRE response must be valid openui-lang code — no markdown, no explanations, just openui-lang."（你是一个使用 openui-lang 作答的 AI 助手……你的整个回复都必须是合法的 openui-lang 代码——不要 markdown，不要解释，只写 openui-lang。）这段文字是为 OpenUI／Thesys 自身的原始补全（raw-completion）架构准备的，在那种架构下模型的整个回复就是这段 DSL，不存在外层的工具调用。若保留不改，它会直接指示模型把 OpenUI Lang 写成聊天回复本身，而不是调用 `render_ui`——这恰好与本包的契约相反。因此本包提供了自己的 `preamble`，说明 OpenUI Lang 只应作为 `render_ui` 工具的 `source` 参数发送，绝不能作为直接回复。

### 轮次结束时的自我纠正

即便修正了 preamble 并提供了示例，模型仍可能把 OpenUI Lang 直接写成聊天文本，而不是调用工具。本包注册了一个 `agent/turn-stopping` 监听器（与 `dsh-hooks-claude-code`／`dsh-hooks-codex` 在检查失败时强制继续所用的扩展点相同），检查已完成轮次的最终助手消息：如果其文本能通过 `dsh-openui-lang` 的 `parseSource()` 干净地解析为一棵非平凡的树（至少使用 `Card`／`Table`／`List`／`BarChart`／`PieChart` 之一——只有 `Heading`／`Text` 的根节点不算），该监听器会调用 `agent.steer(...)`，附带一条引用了违规源码并要求模型改为通过 `render_ui` 重新发送的纠正性指令，从而强制再走一步。含有任何待处理工具调用的消息，在该监听器运行时永远不会是轮次的最终消息——循环总会先把该工具的结果喂回模型，才会考虑结束轮次——因此无需（也不可能）再单独检查同一条消息里是否伴随着 `render_ui` 调用。

纠正次数受 `Config.maxCorrectionAttempts` 限制，因此一直不调用工具的模型不会被无限次引导；一旦达到上限，该轮次就会以未渲染的文本回答收尾。

### 渲染

规范结果携带已解析的元素树，但本包只渲染一个 `generic` 回退卡片（一行朴素的待定／已完成状态条）——丰富的 UI 是一个独立关注点，由 [`@deepseek-ai/dsh-client-ui-openui`](../../client/ui-openui/README.zh.md) 负责，它会占据 Web 聊天客户端中该工具名对应的具名 `tool.call.toolview` slot。没有该客户端插件的宿主（CLI、ACP）只能看到通用卡片和面向模型的文字摘要。

### 导出形状

函数／命名空间插件：导出 `name`／`inject`／`apply`，不提供默认导出。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到的内容

模型会看到生成的 [`render_ui` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-openui)，外加一个讲解 OpenUI Lang 语法与精选组件签名的系统提示词小节。

#### Token 影响

工具注册所在的每个请求都有固定 schema 开销，外加生成的语法小节；该开销与精选组件数量成正比（数量刻意保持很小——见 `dsh-openui-lang` 的 README）。

#### KV Cache 影响

只要该工具的注册状态和 `dsh-openui-lang` 的组件词汇表不变，前缀就保持稳定；该示例会给这段同样保持前缀稳定的小节增加一小段固定文本（一棵示例树，不随精选组件数量增长）。

### 轮次结束时的纠正

#### 模型看到的内容

当已完成轮次的最终消息包含未被路由的 OpenUI Lang 文本时，模型会在下一步看到一条插件注入的用户消息，引用该文本并指示它改为通过 `render_ui` 重新发送该内容。这是一条普通的、已记录的 `user/message` 事件，与其他任何注入的上下文一样可以从会话日志中还原。

#### Token 影响

仅在出错时产生：一次额外的请求／响应往返（纠正消息加上模型的重试），受 `Config.maxCorrectionAttempts` 限制。模型第一次就正确调用 `render_ui` 时零开销。

#### KV Cache 影响

仅追加；纠正消息与其他任何注入的上下文一样，跟在可复用的请求前缀之后。

### 工具调用历史与结果

#### 模型看到的内容

每次调用的参数都保留完整的 OpenUI Lang 源码。成功时返回 `Rendered a <RootComponent> UI.`；出现解析／校验问题时返回 `OpenUI Lang had <n> issue(s):`，后跟每个错误各一条人类可读的消息；无法解析或为空的源码返回 `No renderable UI was produced — the source did not resolve to a root element.`。以上都不是 `isError`——只有解析器真正崩溃时才是。

#### Token 影响

token 增长与模型每次调用发送的 OpenUI Lang 源码成正比；结果文本很小，且与错误数量成正比（通常为零）。

#### KV Cache 影响

仅追加；新可见内容跟在可复用的请求前缀之后。

## 已知限制与暂缓事项

- **没有更新／补丁操作。** 每次 `render_ui` 调用都是独立的，无法就地编辑先前渲染过的 UI（参见 `openspec/changes/openui-generative-output/design.md` 中的共享设计决策）。
- **渲染出的 UI 不支持 `Query()`／`Mutation()`／工具调用。** 这是有意排除在范围之外的——见 `dsh-openui-lang` 的 README。
- **轮次结束时的纠正可能对刻意给出的、合法的示例说明产生误判。** 如果用户明确要求模型用文字展示 OpenUI Lang 的语法，而模型给出的示例恰好能干净地解析为一个非平凡组件，纠正仍会触发——仅凭解析结果无法区分"无意写错"和"有意举例"（参见 `openspec/changes/openui-tool-call-reliability/design.md` 的 Risks 一节）。
- **纠正上限是固定次数，不是自适应的。** `Config.maxCorrectionAttempts` 限制的是每个 agent 的连续纠正次数；它无法区分"即将成功"的模型和"永远不会成功"的模型。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

无。

</details>

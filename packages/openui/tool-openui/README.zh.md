# @deepseek-ai/dsh-tool-openui

[English](README.md) | 中文

面向模型的 `render_ui` 工具：解析并校验 [OpenUI Lang](https://github.com/thesysdev/openui)，依据共享的、经过整理的组件词汇表（[`@deepseek-ai/dsh-openui-lang`](../openui-lang/README.zh.md)），并向模型讲解该语法。

## 功能

在 `ctx.tools` 上注册一个工具 `render_ui(source: string)`，并在 `ctx.systemPrompt` 上注册一个系统提示词小节（`dsh-openui-lang` 生成的语法文本）。`execute` 用 `dsh-openui-lang` 的 `parseSource()` 解析 `source`，返回 `{ root, errors, incomplete }`——这是共享包自身的宽松解析结果。语法错误、未知组件或缺失必填 prop 都不会被当作抛出的错误：它们是模型自身可恢复的输出，会在 `errors` 中报告回去，供模型在下一次调用时纠正。只有解析器实现本身真正失败时才会抛出错误。

## 渲染

规范结果携带已解析的元素树，但本包只渲染一个 `generic` 回退卡片（一行朴素的待定／已完成状态条）——丰富的 UI 是一个独立关注点，由 [`@deepseek-ai/dsh-client-ui-openui`](../../client/ui-openui/README.zh.md) 负责，它会占据 Web 聊天客户端中该工具名对应的具名 `tool.call.toolview` slot。没有该客户端插件的宿主（CLI、ACP）只能看到通用卡片和面向模型的文字摘要。

## 导出形状

函数／命名空间插件：导出 `name`／`inject`／`apply`，不提供默认导出。

## 模型体验

### 工具 schema

#### 模型看到的内容

模型会看到生成的 [`render_ui` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-openui)，外加一个讲解 OpenUI Lang 语法与精选组件签名的系统提示词小节。

#### Token 影响

工具注册所在的每个请求都有固定 schema 开销，外加生成的语法小节；该开销与精选组件数量成正比（数量刻意保持很小——见 `dsh-openui-lang` 的 README）。

#### KV Cache 影响

只要该工具的注册状态和 `dsh-openui-lang` 的组件词汇表不变，前缀就保持稳定。

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

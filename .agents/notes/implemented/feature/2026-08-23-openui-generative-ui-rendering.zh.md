# Agent Note: OpenUI 生成式 UI 渲染（`render_ui`）

Status: implemented

[English](2026-08-23-openui-generative-ui-rendering.md) | 中文

## 问题

模型的回答是纯文本／Markdown 内容块；任何更适合以图表、表格或交互式卡片呈现的内容，在网页聊天客户端中都只能渲染成一大段散文。[OpenUI](https://github.com/thesysdev/openui) 是一个 MIT 许可、自托管、可自带 LLM（大语言模型）的生成式 UI 框架：它提示模型生成 **OpenUI Lang**（一种紧凑的 DSL），该 DSL 通常被解析为一棵类型化的元素树，再渲染为 React 组件。本 harness 需要一种方式，让模型在不引入托管依赖、不改变每个宿主都必须处理的共享工具渲染意图联合类型、且不让模型生成的输出在浏览器中成为 XSS 攻击向量的前提下，产出这类富 UI。

## 决策

`render_ui` 是一个面向模型的工具（`@deepseek-ai/dsh-tool-openui`），它在服务端针对一套固定的、手工编写的组件词汇（`@deepseek-ai/dsh-openui-lang`：`Stack` 根节点、`Card`、`Heading`、`Text`、`List`/`ListItem`、`Table`、`BarChart`、`PieChart`——没有任何组件接受 URL、原始标记或脚本）解析并校验一条 OpenUI Lang 源字符串。`BarChart`／`PieChart` 是应明确要求后新增的——此前模型在被要求给出图表／图形时无组件可用，只能退化为散文描述；两者均以纯手写 SVG 渲染（饼图使用弧线路径数学，柱状图使用等比例的 `<rect>`），而非引入图表库依赖，从而保持封闭词汇表的安全姿态不变。语法错误或未知／无效组件从不会抛出异常——它是 OpenUI 自身宽松解析结果的一部分（`{ root, errors, incomplete }`），会被回传给模型以便其自我纠正，就像一个非零的 shell 退出码一样。网页客户端（`@deepseek-ai/dsh-client-ui-openui`）在既有的具名 `tool.call.toolview` slot（`packages/client/ui-tool`）中认领该工具的名字，并渲染已确定的元素树；其他所有宿主都会得到 `generic` 卡片兜底渲染。共享的组件词汇只定义一次（`ComponentRenderers<C>`，对某个 lang-core 从不检视的、不透明的按消费方渲染器 payload 是泛型的），并被两侧共同消费，因此所教授的系统提示词语法、服务端校验器与客户端可渲染集合就不会互相漂移。

解析后的元素树通过工具上的 `output.presentationMeta: (_args, value) => value` 到达客户端，落在持久化的 `tool/result` 事件的 `meta` 字段中，并从那里进入 `ToolResultNode.meta`——这一点已直接对照 `packages/client/ui-conversation/src/client/conversation-nodes/tool.ts:66` 验证过，因为该协议原本只携带 `content` 以及封闭的 `callView`/`resultView` 卡片联合类型，从不携带工具的原始规范值。

客户端不使用 `@openuidev/react-lang` 的 `<Renderer>` 组件。`<Renderer response={string}>` 的设计是接收原始 OpenUI Lang 文本，并在客户端自行重新解析——这与"只在服务端解析一次，绝不信任客户端重新解析"背道而驰。相反，`dsh-client-ui-openui` 用一个手写的小型递归渲染器（`renderElement`）遍历已经校验过的树，把每个节点的 `typeName` 分派给一个普通的 `ComponentRenderers<OpenUIComponent>` 对象；仅凭该对象的类型标注，就会在编译期（而非运行期）强制要求为每一个精选名称提供 React 实现——这使得 `@openuidev/react-lang` 与 `@openuidev/lang-core` 的运行时代码完全不进入浏览器构建产物（已通过一次真实的 `tsdown --env.DSH_BUILD_FACE client` 构建确认：当模块作用域中存在为同一穷尽性检查而调用的 `buildLibrary()` 运行时调用时为 238.65 kB，去掉它、仅保留 `dsh-openui-lang` 的类型导入——这些类型在编译期会被擦除——之后为 8.50 kB）。

`@openuidev/lang-core` 默认会向 PostHog 发送匿名化的安装遥测数据（一个随机安装 ID、一个加盐哈希的项目标识符，以及版本元数据——根据其自身披露，不包含源码、提示词或路径）。`OPENUI_TELEMETRY_DISABLED=1` 可以禁用它；本仓库默认的 pnpm 配置还会使第三方 postinstall 脚本处于未批准状态（`pnpm approve-builds`），因此该脚本目前在本仓库中根本不会运行。

`@openuidev/lang-core` 与 `@openuidev/react-lang` 都不内置组件库——每个组件都通过 `defineComponent` 由使用方自行定义。`@openuidev/react-ui` 是 Thesys 提供的另一个预构建包；这里没有使用它，因为对 v1 版本而言，引入第二个未经审查的第三方组件实现，会不必要地扩大与 XSS 相关的攻击面。

`tool-openui` 注册在 `packages/bundle/base/cordis.patch.yml` 中（因此它与宿主无关——Web、headless、ACP 都能获得校验工具及其通用回退卡片），`ui-openui` 注册在 `packages/bundle/web-app/cordis.patch.yml` 中（因此 Web 客户端默认会渲染已结算的元素树）。两个 bundle（组合包）都在各自的 `package.json` 中声明了对应的工作区依赖，采用与 `tool-web`／`ui-tool` 相同的模式。

## 曾考虑的替代方案

**在 `packages/core/tools/src/presentation.ts` 的 `card` 联合类型中新增一个 `component`/`generative-ui` 变体。** 否决：该联合类型是每个宿主（网页、CLI、ACP）都必须映射的中立词汇，新增一个成员会迫使每个非网页宿主都不得不对它无法渲染的任意生成式 UI 形成自己的处理方式。既有的具名 `tool.call.toolview` slot 存在的目的正是让一个插件完全独立地拥有某个工具的渲染逻辑，而不触及共享基础设施。

**使用 `@openuidev/react-lang` 的 `<Renderer>`，将原始 OpenUI Lang 文本发送给客户端由其自行解析。** 否决：它会在客户端针对该库自身的内部解析器重新解析一遍，这既重复了本设计所依赖的、用于模型自我纠正循环的服务端校验，又会在服务端已经产出一棵经过校验的树之后，仍然把该框架的完整运行时（解析器、提示词生成、与 `ci-info`／遥测相关的代码）拉入浏览器构建产物，却没有任何行为上的收益。

**依赖 `@openuidev/react-ui` 的预构建组件，而非手工编写一套精选组件集。** 对 v1 版本否决：在"渲染受模型影响的数据"这一 XSS 错误后果最严重的表面上，这会引入第二个未经审查的第三方组件实现。手工编写六个小组件成本很低，并且能把安全审查完全留在本次变更范围之内。

**接入 `Query()`/`Mutation()`/`ToolProvider`，使渲染出的 UI 能够回调工具。** 对 v1 版本否决：这是一个明显更大、性质不同的安全面（模型生成的 UI 在正常的模型—循环中介流程之外触发工具执行），而不是"渲染一个已经完整、已经确定的结果"，且当前需求中没有任何一点需要它。

**发布一种 JSON-schema 的 `{ ok, tree } | { ok: false, errors }` 规范输出形状。** 在直接阅读了真实的 `@openuidev/lang-core` API 之后否决：`createParser(...).parse()` 本身就返回一种宽松的 `{ root, meta: { errors, incomplete, ... } }` 形状（一个带有无效属性的组件会被丢弃并报告，而不是导致解析失败），因此原样照搬它可以避免发明第二种、多余的结果形状。

## 测试

目前只有包级别的单元／集成测试（尚无快照或 SDK 预期输出 fixture——见"待完成事项"）：`dsh-openui-lang`（9 项测试）覆盖有效、未知组件、缺失必填项、无法解析的解析场景，以及提示词生成和图表数据的对象数组格式；`dsh-tool-openui`（9 项测试）通过 `ctx.tools.execute()` 驱动真实工具，包括 `result.meta` 的投影以及 `presentResult` 的 `isError` 分支；`dsh-client-ui-openui`（22 项测试，jsdom + `@testing-library/react`）覆盖每个精选组件（含 `BarChart`／`PieChart` 的有标题／无标题／空数据／总和为零／单一扇区等边界情形）、嵌套的 Card/Stack 组合、未知组件的兜底渲染、toolview 的 pending/error/success 状态，以及具名 slot 的注册。三个包均达到逐文件 100% 覆盖率。`tsc --build`、`run-oxlint`，以及逐一运行的 doc-sync／hygiene 检查项（`verify-cordis-config`、`verify-package-invariants`、`verify-client-packages`、两个 README 门禁、`gen-tool-catalog --check`、`verify-runtime-closure`、`verify-dsh-package-licenses`、`verify-optional-dependency-imports`）均已通过。

## 后果

模型现在可以通过一个有文档记录的、增量式的扩展点，在网页聊天客户端中产出交互式的结构化 UI，无需新增任何托管后端，浏览器构建产物的成本约为 8.5 kB。代价是：需要维护两个新的 workspace 包外加一个客户端包、一套固定的（目前为九个组件的）词汇必须经过刻意扩展而非随意增长，以及对 `@openuidev/lang-core` 接受了一项安装期遥测依赖（已缓解，但未消除）。

## 待完成事项

目前尚不存在针对 `render_ui` 协议格式（wire format）的无密钥 ACP／headless 快照 fixture，也没有对应的 TypeScript／Python SDK 预期输出更新——本仓库的测试策略要求任何模型／产品用户可见的变更都必须具备这两项，它们是尚未完成的后续工作，不属于本笔记已交付的决策范围；接入默认 bundle（组合包）之后，这项覆盖缺口更加突出，而非可有可无。精选组件列表除了本次变更自身的实现评审外，尚未获得人工安全签核。

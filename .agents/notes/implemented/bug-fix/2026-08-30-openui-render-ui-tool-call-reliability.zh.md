# Agent Note: `render_ui` 工具调用的可靠性

Status: implemented

[English](2026-08-30-openui-render-ui-tool-call-reliability.md) | 中文

## 问题

[OpenUI 生成式 UI 渲染](2026-08-23-openui-generative-ui-rendering.md) 接入了面向模型的 `render_ui` 工具和一个 Web 客户端渲染器，但渲染完全依赖模型真的去调用那个工具——客户端从工具持久化的结果里读取已解析的树，从不重新解析原始文本（一个刻意的安全决定）。实际观察到的情况是：模型反而把 OpenUI Lang 源码直接写成了聊天回复文本，根本没有调用 `render_ui`，于是聊天客户端展示的是这段 DSL 的字面源码，而不是表格或图表。

读取 `dsh-tool-openui` 实际生成的系统提示词文本（完全按照该包现有调用点的方式调用 `promptText()`，不传任何选项）揭示了原因：`@openuidev/lang-core` 内置的默认 `preamble` 开头就是 "You are an AI assistant that responds using openui-lang... Your ENTIRE response must be valid openui-lang code — no markdown, no explanations, just openui-lang."（你是一个使用 openui-lang 作答的 AI 助手……你的整个回复都必须是合法的 openui-lang 代码——不要 markdown，不要解释，只写 openui-lang。）这段文字是为 OpenUI/Thesys 自身的原始补全（raw-completion）架构准备的，在那种架构下模型的整个回复就是这段 DSL，不存在外层的工具调用。若保留不改，系统提示词就是在主动指示模型去做这次修复本该阻止的那件事——而不仅仅是没有教会模型正确的做法。

## 决策

`dsh-tool-openui` 现在通过 `promptText({ preamble, examples: [...] })` 覆盖 `@openuidev/lang-core` 的默认 `preamble`：替换后的 preamble 说明 OpenUI Lang 只应作为 `render_ui` 工具的 `source` 参数发送，绝不能作为模型的直接回复，并附带一个展示正确调用方式的示例。这是主要的修复手段。

作为兜底，`dsh-tool-openui` 还在 `agent/turn-stopping` 上注册了一个监听器——与 `dsh-hooks-claude-code`/`dsh-hooks-codex` 在检查失败时强制继续所使用的同一个串行钩子——检查已完成轮次的最终派生消息：如果其文本能通过 `dsh-openui-lang` 自身的 `parseSource()` 干净地解析为一棵非平凡的树（至少使用 `Card`/`Table`/`List`/`BarChart`/`PieChart` 之一；只有 `Heading`/`Text` 的根节点不算），该监听器会调用 `agent.steer(...)`，附带一条引用了违规源码的纠正性指令，强制模型改为通过 `render_ui` 重试。纠正次数受新增的 `Config.maxCorrectionAttempts`（默认 2）限制，因此一直不调用工具的模型不会被无限次引导；一旦达到上限，该轮次就会以未渲染的文本回答收尾。

该监听器**不会**检查同一条消息是否也伴随着一次 `render_ui` 工具调用——这个决定的早期草案曾以为需要这项检查（以防模型在同一条消息里既把 DSL 写成文本、又正确调用了工具），而它并不是碰巧编译成了无操作：驱动真实的 agent loop（`dsh-agent-loop-testkit` 加一个脚本化的 mock adapter）证明，含有任何待处理工具调用的消息——无论该调用是否被拒绝——在 `agent/turn-stopping` 触发时永远不会是最后一条派生消息。循环总会先把该工具的结果喂回模型，才会考虑结束轮次；而通过 `concludesTurn` 提前结束轮次的工具结果，会让最后一条消息变成 `user`/`tool` 来源的消息，而不是助手消息——这已经被监听器的 `role !== 'assistant'` 守卫排除在外。所以那项检查是永远不会被执行到的死代码，而不是一个必要的防护，因此在上线前就被移除了，而不是"以防万一"地保留下来。

本仓库的 LLM 抽象层没有 `tool_choice`/强制工具使用字段（`packages/llm/llm/src/types.ts` 中的 `GenerateOptions`——一个明确的 MVP 裁剪，与已归档的[移除无效请求旋钮](../../archived/simplification/2026-07-04-drop-inert-request-knobs.md)先例一致），因此在 LLM 层面强制使用工具既不可用，也不在本次范围内；这次修复完全依靠本仓库已有的提示词／自我纠正这一层来完成。

## 考虑过的替代方案

**给 `GenerateOptions` 加一个 `tool_choice`/强制工具使用字段。** 已拒绝：这是一个跨界的请求层改动，目前没有第二个消费方，违背了本仓库"公开选择需要证据支撑"的约定；而 preamble 本身就是主动写错的，修正它是更便宜、更精准的修复手段。

**直接在客户端渲染在助手文本中发现的、未经校验的原始 OpenUI Lang**（更贴近上游 OpenUI 的原始补全聊天行为）。已拒绝：这会重新打开原设计已经明确的安全决定——客户端从不重新解析原始模型文本——每一棵渲染出的树都仍应经过服务端校验、通过一次真正的 `render_ui` 调用产生，包括由纠正性引导触发的重试所产生的那次调用。

**即使同消息 `render_ui` 工具调用检查永远不会触发，也"为安全起见"保留它。** 在通过驱动真实循环证明其为死代码之后已拒绝：保留永远无法触达的防御性代码，违背了本仓库"不要为不可能发生的场景添加校验"的约定，而更简单的函数也更容易阅读，并能被测试完整覆盖。

## 测试

`dsh-tool-openui` 的测试套件（19 个测试，逐文件 100% 覆盖率）驱动一个真实的 agent loop（`dsh-agent-loop-testkit` 加一个脚本化的 `MockAdapter`，不联网）来证明：提示词不再包含原始补全指令，而是包含了那个示例；监听器在遇到未被路由的、非平凡的 OpenUI Lang 文本时恰好引导一次，随后模型通过 `render_ui` 恢复正常；带有待处理工具调用的中途消息永远不会被检查（只检查该轮次的最终消息）；无法解析的文本和只有 `Text`/`Heading` 的平凡根节点都不会触发纠正；纠正上限会在达到配置次数后停止引导；一次没有产生尾随助手消息的空 max-tokens 步骤会被正确处理而不触发引导；销毁插件 fiber 会移除该监听器（HMR 安全性）；一个非法的 `maxCorrectionAttempts` 会在插件加载时就快速失败。针对本次改动的包，`tsc --build`、`run-oxlint`、`verify-package-invariants`、`verify-cordis-config` 以及两个 README doc-sync 关卡均已通过。

## 影响

在常见情况下（修正后的 preamble 已经阻止了它），模型写出可渲染的 OpenUI Lang 时不会再默默地把原始 DSL 显示成一条聊天消息；在残余情况下（轮次结束时的监听器）也会被自我纠正，且客户端渲染的信任边界完全没有变化。代价是：本仓库现在自己拥有并需要维护一小段系统提示词 preamble——如果 `@openuidev/lang-core` 有意义地改变了它自己的默认值，就需要同步更新；此外，出错时最多会产生 `maxCorrectionAttempts` 次额外的请求／响应往返。

## 延后事项

目前还没有针对 `render_ui` 的线上结构或这条纠正路径的、可运行的、无需密钥的 ACP/headless 快照 fixture——这与[原始笔记](2026-08-23-openui-generative-ui-rendering.md)已经标记为待办的缺口相同，本次改动仍未补上。同样的原因，也没有更新 TypeScript／Python SDK 的预期输出。

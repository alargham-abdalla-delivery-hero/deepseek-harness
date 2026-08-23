# @deepseek-ai/dsh-client-ui-quick-actions

[English](README.md) | 中文

Quick-actions 插件（浏览器端部分）：`QuickActionsRow` 注册进 `conversation.composer.dock`——composer 卡片下方的条带，位于随包发布的 stats line 之前（order -10），宽度与 composer 卡片本身一致，因此该行的边框与卡片对齐——一行一键按钮，加一个仅当确实有内容被隐藏时才渲染的 "More" 按钮。其他插件通过 `ctx.quickActions.register(entry)`（与 `ctx.inputTriggers` 的注册面呼应）贡献条目：一个普通的 `{ id, label, insertText, overflow?, order }` 对象，返回 disposer，重复 id 会抛出异常。该 service 在每次 register/dispose 时从扁平条目列表派生出 `{ visible, overflow }` 拆分，并通过 `SnapshotStore` 重新发布；标记为 `overflow` 的条目始终落在 "More" 菜单中（复用已有的 `Menu` primitive，side-anchored 到按钮），而标记为 `visible` 的条目会按实际测得的行宽尽可能多地渲染为行内按钮——放不下的部分会溢出到同一个 "More" 菜单，并在该行每次尺寸变化时重新计算。选中任意条目——无论是行内按钮还是菜单项——都会通过 `inputActions.setDraft`（与 `/` 命令、文件提及插入使用的同一个面）将其 `insertText` 写入当前会话的 composer draft，且从不提交，用户发送前仍可编辑。composer 处于 adjudicating 或 submitting 状态时，每个控件都会禁用，与 InputBar 自身的忙碌门控一致。

该插件默认提供四个可见条目（Lead generation、Income Statements、Balance sheet、Cash Flow Statement），外加四个仅通过 "More" 展示的 overflow 条目（Market Research、Competitor Analysis、Financial Forecast、Investor Pitch），均在 `apply()` 中通过与其他插件相同的 `register` 调用注册，因此某个部署或另一个插件可以在不改动本包源码的前提下添加更多条目。

`/client` 的导出接口包括插件本体（`apply`/`inject`）、`QuickActionsService`、`QuickActionsRow`，以及契约类型（`QuickActionEntry`、`QuickActionsServiceContract`、`QuickActionsSnapshot`）。

## 模型体验

无，因为该行只会写入用户发送前可编辑的 composer 文本；最终提示词经由普通的 composer 提交路径到达模型，本包对此没有任何介入。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **默认条目固定，没有配置面** ——随包发布的八个标签/insertText 无法通过 `cordis.yml` 配置。想要不同默认值的部署目前只能从另一个插件注册额外条目并 dispose 掉这些条目，或者 fork 该常量；`Config` 面板会推迟到出现真实的第二个、需要不同默认值的消费者时才加入。
- **"More" 溢出方向未适配 RTL** ——"More" 菜单始终以 `side="right"` 打开；composer 在其他地方尚无文档化的从右到左处理，因此这里沿用该先例，而非在此单独解决。

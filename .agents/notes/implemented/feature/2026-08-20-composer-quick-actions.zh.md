# Agent Note: Composer quick-action row

Status: implemented

[English](2026-08-20-composer-quick-actions.md) | 中文

## 问题

composer 没有通向常见领域工作流（拉取 lead-generation 列表、income statement、balance sheet）的快捷路径；用户每次都要从头输入完整请求。现有 `conversation.input.dock` 座位没有任何一键快捷方式，而且除了拥有某个 dock 条目的插件之外，没有其他插件能向它添加按钮。

## 决策

新增一个纯 client 包 `packages/client/ui-quick-actions/`（`@deepseek-ai/dsh-client-ui-quick-actions`），遵循 `ui-input-trigger`/`ui-commands` 的拆分方式：一个空的 host `apply()`（使插件仍出现在 `cordis.yml`/Loader 中），真正的行为放在 `src/client/` 中。

`QuickActionsService`（`ctx.quickActions`）是一个扁平的内存注册表，条目形如 `{ id, label, insertText, overflow?, order }`。`register(entry)` 在遇到重复 id 时抛出异常，并返回 disposer（register-as-effect 约定）；该 service 在每次 register/dispose 时按 `order` 升序派生出 `{ visible, overflow }` 拆分，并通过 `SnapshotStore` 重新发布。插件在 `apply()` 中通过这同一个 `register` 调用播种三个默认条目（Lead generation、Income Statements、Balance sheet），因此其他插件也可以用完全相同的方式添加条目——无需改动本包。

`QuickActionsRow` 将可见条目渲染为按钮，末尾加一个 "More" 按钮，注册进 `conversation.input.dock`（`packages/client/ui-conversation` 既有的 `kind: 'list'` 座位），`order: 30`——该座位已发布条目中最高的 order（Todo 为 0、Goal 为 10、Queue 为 20），因此该行作为终端卡片，直接位于 composer 上方。"More" 始终渲染（并非仅当存在 overflow 条目时才渲染），复用 `Menu` primitive（`side="right"`，在按钮 ref 上使用 `getAnchorRect`），而非自建 popover。选中任意条目——无论是行内按钮还是菜单项——都会调用 `inputActions.setDraft(insertText)`（与 `/` 命令、文件提及插入使用的同一个面），且从不提交，用户发送前仍可编辑。当 `input.phase` 为 `'adjudicating'` 或 `'submitting'` 时，每个控件都会禁用，与 `InputBar` 自身的忙碌门控一致；该行从不直接订阅 session/input，只读取 `.dock` 座位本就会重新渲染的 owner-share 快照。

该插件已接入 web 客户端的默认组合（`packages/bundle/web-app/cordis.patch.yml`、`packages/bundle/web-app/package.json`）以及 client-plugin 聚合（`tsconfig.client.json`），因此 `pnpm dsh web` 无需任何开关即可挂载它。

## 已考虑的替代方案

- **直接在 `ui-conversation` 中硬编码这三个按钮，不设注册表**——已否决：本仓库中其他所有 `.dock`/`.overlay` 贡献者都以独立插件形式发布，而非让声明该 seat 的包变大；且固定集合、没有扩展点的方案与"其他插件应能在不改动本包的前提下添加条目"的需求相矛盾。
- **为 "More" 自建下拉/popover**——已否决：`Menu` 已经实现了完全相同的 side-anchored、键盘/焦点/dismiss 行为一致的交互（与驱动斜杠命令菜单、workspace picker 的是同一个 primitive）；新建组件只会重复该行为而毫无收益。
- **点击后立即提交**——已否决：这既不符合 `/` 命令的行为，也不符合文件提及插入的行为，二者都是写入 draft 并让用户复核；立即提交且不经复核，也有因误触额外一次点击而意外发送的风险。
- **注册进 `conversation.input.left`/`.right` 而非 `.dock`**——已否决：这两个座位与常驻 composer chrome 共享同一行高度预算，文档上定位为单个始终可见的小控件，而非带标签的多按钮行；`.dock` 才是希望独占一行内容的座位。

## 后果

其他插件只需一次 `ctx.quickActions.register(...)` 调用即可贡献 quick action，除声明的 service 面之外不依赖本包。代价是：随包发布的三个默认条目是固定的英文字符串，没有 `cordis.yml` 的 `Config` 面；"More" 始终以 `side="right"` 打开，不区分文字方向——这两点都记录在本包 `README.md` 的 `## Known Limitations and Deferred Work` 中，推迟到出现真正需要不同默认值或从右到左布局的第二个消费者时再解决。

## 测试

`packages/client/ui-quick-actions/tests/service.client.spec.ts` 覆盖 `QuickActionsService` 的 register、重复 id、dispose 以及 visible/overflow 排序，包括 HMR-safety 的形态（dispose 注册用的 fiber 会移除该条目）。`tests/apply.client.spec.ts` 在一个真实的 cordis `Context` + `SlotRegistry` 上覆盖真实的 `apply()` 接线（默认条目播种、以 `order: 30` 注册进 dock、按会话解析 scope 在未知会话时高声失败、fiber 拆卸）。`tests/quick-actions-row.client.spec.tsx` 直接渲染 `QuickActionsRow`（props-direct，`QueueDock`/`GoalDock` 先例），断言四个按钮、点击通过 `inputActions.setDraft` 写入 draft、一个 overflow 条目出现在 "More" 菜单中，以及忙碌 input phase 期间每个控件都会禁用。`apps/web/tests/quick-actions-row.snapshot.ts` 是一个 keyless 的 assembled-jsdom 快照（`packages/client/ui-quick-actions` 已加入 `apps/web/tests/assembled-boot.ts` 的启动图），在真实构建的 client bundle 之上锁定默认行的四个按钮标签，并验证一次真实点击会填充 composer draft。

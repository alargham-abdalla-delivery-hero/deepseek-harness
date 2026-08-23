# Agent Note: Composer quick-action row

Status: implemented

[English](2026-08-20-composer-quick-actions.md) | 中文

## 问题

composer 没有通向常见领域工作流（拉取 lead-generation 列表、income statement、balance sheet）的快捷路径；用户每次都要从头输入完整请求。composer 下方没有任何一键快捷方式，而且除了拥有某个 dock 条目的插件之外，没有其他插件能向它添加按钮。

## 决策

新增一个纯 client 包 `packages/client/ui-quick-actions/`（`@deepseek-ai/dsh-client-ui-quick-actions`），遵循 `ui-input-trigger`/`ui-commands` 的拆分方式：一个空的 host `apply()`（使插件仍出现在 `cordis.yml`/Loader 中），真正的行为放在 `src/client/` 中。

`QuickActionsService`（`ctx.quickActions`）是一个扁平的内存注册表，条目形如 `{ id, label, insertText, overflow?, order }`。`register(entry)` 在遇到重复 id 时抛出异常，并返回 disposer（register-as-effect 约定）；该 service 在每次 register/dispose 时按 `order` 升序派生出 `{ visible, overflow }` 拆分，并通过 `SnapshotStore` 重新发布。插件在 `apply()` 中通过这同一个 `register` 调用播种八个默认条目——四个可见（Lead generation、Income Statements、Balance sheet、Cash Flow Statement）、四个仅在 overflow 中出现（Market Research、Competitor Analysis、Financial Forecast、Investor Pitch）——因此其他插件也可以用完全相同的方式添加条目——无需改动本包。

`QuickActionsRow` 注册进 `conversation.composer.dock`（`packages/client/ui-conversation` 既有的 `kind: 'list'` 座位，是 composer 卡片下方、bar 宽度列内的条带），`order: -10`——位于随包发布的 `StatsLine` 条目（`order: 0`）之前，因此该行直接位于 composer 下方，ambient 的 stats 文本跟在它后面。它的 CSS 采用了与 composer 卡片自身相同的宽度规则（`width: 100%; max-width: var(--dsh-composer-card-max-width)`，不再额外收进），而不是再减一次 dock inset——因为这个 footer 本就已经处于 `InputBar` 带 side-clearance padding 的 root 内部；此前的二次相减会让该行相对卡片自身的左右边框向内收缩，而不是与之齐平。

该行是一个响应式的"priority+"工具条：标记为 `overflow` 的注册条目始终落在 "More" 菜单中；标记为 `visible` 的条目会渐进渲染为按钮，具体数量由导出的纯函数 `fitVisibleCount`（宽度数组、可用宽度、已固定的 overflow 数量）决定——只要后面还有 visible 条目或存在固定 overflow 条目可能溢出，就会为 "More" 预留空间，因此完全放得下时不预留任何空间，"More" 本身也就不渲染。一个 `useLayoutEffect` 会在绘制前，在屏幕外（`.measure`，`aria-hidden`）测量每个 visible 条目外加一个同样样式的 "More" 按钮的自然宽度，因此不会出现按钮先错后对的闪烁；该行上的 `ResizeObserver` 会在每次尺寸变化时重新测量（借鉴 `packages/client/ui-layout/src/client/AppFrame.tsx` 的 ResizeObserver 容器跟踪先例；仓库中此前没有组件实现过这种"计算能放下几个、其余溢出"的逻辑）。下拉本身复用 `Menu` primitive（`side="right"`，在按钮 ref 上使用 `getAnchorRect`），而非自建 popover。选中任意条目——无论是行内按钮还是菜单项——都会调用 `inputActions.setDraft(insertText)`（与 `/` 命令、文件提及插入使用的同一个面），且从不提交，用户发送前仍可编辑。当 `input.phase` 为 `'adjudicating'` 或 `'submitting'` 时，每个控件都会禁用，与 `InputBar` 自身的忙碌门控一致；该行从不直接订阅 session/input，只读取 `.dock` 座位本就会重新渲染的 owner-share 快照。

该插件已接入 web 客户端的默认组合（`packages/bundle/web-app/cordis.patch.yml`、`packages/bundle/web-app/package.json`）以及 client-plugin 聚合（`tsconfig.client.json`、`tsconfig.base.json`），因此 `pnpm dsh web` 无需任何开关即可挂载它；assembled-jsdom 测试基础设施（`apps/web/tests/assembled-boot.ts`）无需相应改动，因为它会从 `dsh web` 读取的同一套 bundle patch 与各包自身的 `dsh.client` 声明中自动发现启动条目。

`conversation.composer.dock` 的 footer 此前只在非 hero（非空白会话）状态下渲染，这是基于其唯一注册者 `StatsLine` 在轮次开始前无内容可显示的假设。`packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx` 现在只要 owner `zone` 已定义就会渲染该 footer，无论是否处于 hero，因为该座位现在有了第二个注册者，其整个目的就是帮助用户开始一个会话——恰恰在 composer 为空时把它隐藏掉，与需求背道而驰。`StatsLine` 保留了自己的 `groups.length === 0` 守卫，因此它在 hero 下的渲染表现不变；只是把座位级别的门控下放到了各注册者自己的逻辑中。`packages/client/ui-conversation/src/client/contract/slots.ts` 中 `conversation.composer.dock` 的 JSDoc 现已说明该座位也向 composer 本轮会作用于的控件开放，而不仅是 ambient 的只读内容。

## 已考虑的替代方案

- **直接在 `ui-conversation` 中硬编码这三个按钮，不设注册表**——已否决：本仓库中其他所有 `.dock`/`.overlay` 贡献者都以独立插件形式发布，而非让声明该 seat 的包变大；且固定集合、没有扩展点的方案与"其他插件应能在不改动本包的前提下添加条目"的需求相矛盾。
- **为 "More" 自建下拉/popover**——已否决：`Menu` 已经实现了完全相同的 side-anchored、键盘/焦点/dismiss 行为一致的交互（与驱动斜杠命令菜单、workspace picker 的是同一个 primitive）；新建组件只会重复该行为而毫无收益。
- **点击后立即提交**——已否决：这既不符合 `/` 命令的行为，也不符合文件提及插入的行为，二者都是写入 draft 并让用户复核；立即提交且不经复核，也有因误触额外一次点击而意外发送的风险。
- **注册进 `conversation.input.left`/`.right` 而非某个 dock 座位**——已否决：这两个座位与常驻 composer chrome 共享同一行高度预算，文档上定位为单个始终可见的小控件，而非带标签的多按钮行；dock 座位才是希望独占一行内容的座位。
- **注册进 `conversation.input.dock`（composer 上方，与 Todo/Goal/Queue 并列）而非 `conversation.composer.dock`**——已否决：位于整个输入区上方的横幅读起来像是在与常驻 chrome 竞争，而非一条紧贴 composer 的操作条；`conversation.composer.dock` 位于卡片正下方的同一宽度列内，更符合"针对即将输入的内容"的一组按钮。
- **保留该座位原有的 hero 门控，在空白屏幕上隐藏这一行**——已否决：空白/hero 屏幕恰恰是一键快捷方式进入某个领域工作流最有价值的地方；为了保留 `StatsLine` 最初的假设而在那里隐藏它，会与该功能本身的目的背道而驰。
- **保留静态的 visible/overflow 划分，"More" 始终渲染**——已否决：固定划分不会随视口或侧边栏宽度自适应，窗口变窄时按钮会被裁切或让该行换到第二行；测量真实行宽、只把放不下的部分移进 "More"（放得下时 "More" 也随之消失），更符合人们把"没地方放了"当作触发 overflow 菜单的直觉。

## 后果

其他插件只需一次 `ctx.quickActions.register(...)` 调用即可贡献 quick action，除声明的 service 面之外不依赖本包。代价是：随包发布的八个默认条目是固定的英文字符串，没有 `cordis.yml` 的 `Config` 面；"More" 始终以 `side="right"` 打开，不区分文字方向——这两点都记录在本包 `README.md` 的 `## Known Limitations and Deferred Work` 中，推迟到出现真正需要不同默认值或从右到左布局的第二个消费者时再解决。响应式测量在 jsdom 中无法端到端测试（没有布局引擎），因此下面的测试覆盖直接 mock `getBoundingClientRect`/`clientWidth`，而非依赖真实布局；真实像素级的适配与实时 resize 行为是在实现期间对着真实 Chromium 手工验证的，并非一个持续在 CI 上运行的自动化检查。

## 测试

`packages/client/ui-quick-actions/tests/service.client.spec.ts` 覆盖 `QuickActionsService` 的 register、重复 id、dispose 以及 visible/overflow 排序，包括 HMR-safety 的形态（dispose 注册用的 fiber 会移除该条目）。`tests/apply.client.spec.ts` 在一个真实的 cordis `Context` + `SlotRegistry` 上覆盖真实的 `apply()` 接线（默认条目播种、以 `order: -10` 注册进 dock、按会话解析 scope 在未知会话时高声失败、fiber 拆卸）。`tests/quick-actions-row.client.spec.tsx` 直接覆盖 `fitVisibleCount`（完全放得下且不预留任何空间、需要预留而溢出尾部、固定条目即便所有 visible 条目本可放下也仍保留预留、以及"至少保留一个"的兜底），并覆盖 `QuickActionsRow` 本身（props-direct，`QueueDock`/`GoalDock` 先例）：按按钮标签 mock `getBoundingClientRect`、按行 mock `clientWidth`（借鉴 `AppFrame` 的 ResizeObserver stub 惯例），断言：该行有余量且没有固定条目时，每个条目都直接渲染、不出现 "More"；即便所有 visible 条目都放得下，只要存在固定条目，"More" 仍会渲染；行宽不足时尾部会连同固定条目一起溢出到 "More"；实时 resize 会重新计算截断位置；点击会通过 `inputActions.setDraft` 写入 draft；忙碌 input phase 期间每个控件都会禁用。`tests/apply.client.spec.ts` 在一个真实的 cordis `Context` + `SlotRegistry` 上覆盖真实的 `apply()` 接线（默认条目播种——四个 visible、四个固定 overflow——以 `order: -10` 注册进 dock、按会话解析 scope 在未知会话时高声失败、fiber 拆卸）。`apps/web/tests/quick-actions-row.snapshot.ts` 是一个基于真实构建 client bundle 的 keyless assembled-jsdom 快照，`apps/web/tests/assembled-boot.ts` 会从 `dsh web` 读取的同一套 bundle patch 与包声明中自动发现它；由于 jsdom 没有布局引擎，它 mock 出一个足够宽的行，以锁定默认行的可见按钮标签，并验证一次行内按钮点击和一次 "More" 菜单项点击都会填充 composer draft。

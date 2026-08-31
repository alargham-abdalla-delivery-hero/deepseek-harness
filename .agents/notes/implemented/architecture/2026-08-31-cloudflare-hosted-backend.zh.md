# Agent Note：Cloudflare 托管后端（Worker + Container + D1）

状态：已实现

[English](2026-08-31-cloudflare-hosted-backend.md) | 中文

## 问题

现有的每个 `dsh` profile 都在操作者自己的机器上运行 Host 进程：`dsh web` 的浏览器 UI 仍需要一个本地 Node 进程注入 `window.__DSH_BOOT__` 并支撑 RPC/session/workspace 状态（`apps/web/vite.config.ts` 的 `rejectStandaloneServe` 对此强制要求）。此前没有办法在操作者自己的机器不保持开机可达的情况下，从浏览器触达一个真正的 `dsh` Host——完整的 subprocess/filesystem/lsp 工具能力，而非沙盒化的子集。`packages/e2b` 是最接近的远程运行时 provider 先例，但它专门面向 E2B 的沙盒产品，而非通用的托管部署。

## 决定

**架构。**`packages/cloudflare/cloudflare-worker`（`@deepseek-ai/dsh-cloudflare-worker`）是一个可部署的 `wrangler.jsonc` 单元，持有边缘层的两半：`src/gateway.ts`（Worker 入口）与 `src/host-container.ts`（Container 支撑的 Durable Object，`getContainer(env.HOST_CONTAINER, workspaceId)` 给出每个 Workspace 一个 Container、带会话亲和性）。gateway 先检查 Cloudflare Access 的 `Cf-Access-Jwt-Assertion` 头，再——仅针对显式的 `/w/<id>/` 路径，绝不针对 `DEFAULT_WORKSPACE_ID` 这一路由槽位回退——对 D1 支撑的注册表做一次 Workspace 存在性读取，然后才路由到 Durable Object。`HostContainer.fetch()` 是纯粹的透传：`@cloudflare/containers` 的 `startAndWaitForPorts()` 把原始请求（含 WebSocket 升级）直接代理到容器的 HTTP 端口；调用方在冷启动期间看到明确的 `{"status":"starting"}`（202），容器完全无法启动时看到 `{"status":"failed"}`（502），而不是一个无限期挂起的请求。容器打包的是已构建好的 `apps/cli/lib` Host——与本地 `dsh web` 路径已经测试过的同一代码路径——通过 `dsh --profile cloudflare` 启动，这是一个新的、opt-in 的 bundle（`packages/bundle/cloudflare-app`，`@deepseek-ai/dsh-cloudflare-app`），其打补丁方式与 `dsh-web-app` 完全一致地覆盖在 `dsh-base` 之上。`dsh-storage-d1` 与 `dsh-session-persistence-d1`（各自现有 `packages/storage/`／`packages/session/` 组中的新同级 backend）以及 `dsh-credentials-d1`（`packages/credentials/` 组中的新同级成员）通过 D1 的 REST 查询 API（`fetch` 加账户 id、数据库 id 与 API token）触达 D1——不需要 Workers/Durable Object 绑定，因此这些 backend 可以作为普通 Node 代码运行在容器内部。Workspace 注册表与 session/credential 状态之所以由 D1 支撑，正是因为它们必须在某个 Workspace 的 Container 停止时仍可读——列出 Workspace 是对 D1 支撑的 `storage-domain` 执行 `ctx.workspaceRegistry.list()`，绝不唤醒任何 Container。

**单一主体鉴权，而非多租户。**Cloudflare Access 把整个 Worker 限定给一个已授权主体，与本仓库已用于 PR 预览托管的模式相同。由于 `dsh-workspace` 的 `WorkspaceRecord` 不携带 owner 字段，且本提案排除多租户，「调用方拥有它所命名的 Workspace」这一条件坍缩为「Access 已经限定了整个 Worker」——每次部署恰好只有一个租户。edge-gateway 在 Access 之外多做的一步就是上述 Workspace 存在性检查，其存在是为了避免为一个无意义或陈旧的 Workspace id 付费唤醒一个 Container，而不是为了比较所有权。

**只有真正部署才发现的容器网络与安全防护现实。**容器绑定 `0.0.0.0`（所有接口）——`dsh-host-webserver` 的 `Config.host` schema 是一个封闭的 `'127.0.0.1' | '0.0.0.0'` 联合类型，没有别的字面量能通过解析，而 Cloudflare 自己的容器端口健康检查所连接的地址，这个进程既无法发现也无法单独绑定。`dsh-web-app` 的 CLI 特意拒绝字面量 `--host 0.0.0.0`，作为防止把远程代码执行暴露到局域网的本机安全防护；`dsh-cloudflare-app` 的配置补丁直接设置 webserver 这一行的 `host`，绕过 `--host` flag 路径（及其防护）而不是为共享的 `dsh-web-app` 表面削弱它，因为这个容器只能通过 Cloudflare 自己的内部代理触达。同样的推理又出现了两次，都是 `dsh-client-connection` 上新增的 `ConnectionConfig` 字段，在其他地方默认都是 false：`requireBrowserSession`（dsh-web-app 自己那个随机的每进程启动令牌门在这里永远无法被满足，因为该 profile 同时关闭了打印与打开那条本该携带令牌的 URL）与 `trustedAsHost`（`dsh-ui-settings` 的 Models Settings UI 默认对任何非 loopback 来源拒绝通过 Host 持久化，这是针对不可信局域网调用方的安全防护）。两个前提都以同一种方式失效：Cloudflare Access 在这个容器看到任何请求之前就已认证了每个调用方，所以来源非 loopback 不再意味着调用方不可信。`dsh-cloudflare-app` 的部署级声明主机名（`CLOUDFLARE_WORKER_HOSTNAME`，以与 D1 身份相同的方式从 Durable Object 自身的绑定转发进容器环境）喂给 Host/Origin 信任栏栅，否则它会拒绝任何 `Host` 既非 loopback 又不在显式配置的授权列表内的请求。

**D1 REST 批量请求是 `{"batch": [...]}`，不是裸数组。**`D1Client.batch()` 最初为多语句调用发送一个裸 JSON 数组；Cloudflare 的 REST API 要求把该数组包在 `batch` 键下（已对照真实 API 与 Cloudflare 当前文档确认）。每一个多语句的 `ensureSchema()` 调用——`dsh-storage-d1`、`dsh-session-persistence-d1`、`dsh-credentials-d1`——在真实部署中都以此方式失败，而同一个 bug 也悄悄弄坏了这三个包各自的 `fake-d1-server.ts` 测试替身，因此该 bug 出货时没有失败的测试能捕捉到它。

**基于 CI 的部署，而非本地 `wrangler dev`。**在本仓库这台 Apple Silicon 开发主机上本地构建容器镜像会确定性崩溃（`uv__io_poll: errno == EEXIST`，一个 libuv/Colima-VZ 交互问题，处于本 Agent Note 不解决的 QEMU/HVF 调查范围），无论 Colima VM 后端、内存大小，或改用 Docker Desktop 均如此。`.github/workflows/deploy-cloudflare-worker.yml`（仅 `workflow_dispatch`）改为从 GitHub 托管的 Linux runner 构建并部署，那里没有这层 VM。每次部署都必须带 `wrangler deploy --containers-rollout=immediate`：默认的渐进式 rollout 会让一个刚建立连接的实例停留在旧镜像上直到过了宽限期，而本次部署自身的每一次上线验证请求都在不断重置那个宽限窗口——单 Workspace 部署根本没有多实例种群可供渐进式 rollout 分批替换，因此立即替换在这里是正确行为，不是在拿风险做交易。

## 曾考虑的替代方案

**两个包（`cloudflare-host-container` / `cloudflare-edge-gateway`）而非一个。**无论包边界如何划分，两半都由同一次 `wrangler deploy` 一起编译并部署，从不被独立打版本或被不同调用方消费（gateway 是 Durable Object 唯一的调用方），因此拆分只会增加跨包 import 开销而没有真正的接缝需要保护——不同于 storage/session 的拆分，那里的两端各有独立的消费方。

**把 D1 provider 与 Worker/Container 插件用配置开关接入 `dsh-base` 或 `dsh-web-app`**，而非独立的 opt-in bundle。已否决：每个默认 profile 都会携带它从不使用的 Cloudflare 专属依赖（`@cloudflare/containers`、`wrangler` 类型），且需要一个开关来关闭行为，而不是干脆不挂载它——本仓库「插件中不写死可调项」的规则。

**每个 Session 一个 Container，而非每个 Workspace 一个。**已否决：同一 Workspace 内的多个 Session 如今需要彼此可见对方的文件（一个 Session 的编辑要对稍后在同一 Workspace 打开的另一个 Session 可见）；按 Session 分容器会悄悄破坏这一点。

**为 `dsh-credentials-d1` 的 `modifyRecord` 实现分布式锁**，而非接受最后写入者获胜。D1 的 REST API 不暴露任何事务原语，无法让一次「读-决定-写」序列在决定步骤上保持互斥；`dsh-session-persistence-d1` 已经为它自己的「读后批量写」序列接受了同样的权衡，而为一个这套 API 根本无法真正保证的锁去构建实现，只会比如实记录这个限制更糟。

**`dsh-credentials-d1` 的 `resolve()`／`describe()` 环境回退方向：以 `process.env` 作为 D1 之下的 bootstrap 默认值，而非沿用 `dsh-credentials-local` 「继承的环境变量优先」的规则。**这里的角色与本地部署相反：`process.env` 在这里是一个固定的部署期值（容器转发进来的 `DEEPSEEK_API_KEY`／`ANTHROPIC_API_KEY`），而 D1 才是调用方期望真正生效的、Settings UI 可写的存储。

## 后果

一次部署位于某个 `workers.dev` 子域名或自定义域名，由 Cloudflare Access 登录把关，默认模型通过直接组合的 `llm-pi-ai` `anthropic` 路由设为 Claude Haiku 4.5（绕开了这次部署无法用来做持久默认值的、依赖临时磁盘的 Settings 页面路径）。Cloudflare Containers 处于 beta 阶段，没有 SLA，API 可能不经通知就变化；`packages/cloudflare/cloudflare-worker` 里的容器编排代码是本次改动中最可能因该 API 变动而需要后续修改的地方。从空闲状态冷启动，对本仓库这套完整的 Cordis 组合（约 1000 个 workspace 包）而言耗时约一分钟量级，以明确的 `{"status":"starting"}` 呈现而非隐藏的延迟；`sleepAfter` 为 `'30m'`，尚未针对真实使用情况调优。D1 是持久性的下限：D1 中断或限流会让 Workspace 不可读，即便 Container 本身健康，这是一个被接受的依赖，除了把 D1 失败显式地暴露为错误之外，本仓库不做进一步缓解。`dsh-credentials-d1` 的 `modifyRecord` 在并发调用下是最后写入者获胜，记录在其 README 里而非被假定不存在。目前没有 Miniflare Container 测试覆盖（`cloudflare/workers-sdk#10408`，一个上游 bug）：`packages/cloudflare/cloudflare-worker` 自己的集成测试只跑到 Container 真正启动之前的那个点为止，这次部署在那条边界之外的实际行为，只由真实的已部署实例验证，而不是由 CI 验证。

## 测试

`packages/cloudflare/cloudflare-worker/tests/gateway.workers.spec.ts` 在 `@cloudflare/vitest-pool-workers` 下针对真实 Workers 运行时执行（Miniflare 的 D1/Durable Object 模拟，不需要真实 Cloudflare 账户）：未认证请求在不触碰 D1 的情况下被拒绝、对一个不存在的显式 Workspace 返回 404、D1 失败返回 502、`DEFAULT_WORKSPACE_ID` 完全跳过 D1 检查、以及按 Durable Object id 的会话亲和性。`packages/credentials/credentials-d1/tests/d1-provider.spec.ts` 针对一个包内本地的伪造 D1 REST server，覆盖了 `CredentialProvider` 每一个抽象方法、环境回退优先级、空值拒绝、以及两个 Cordis 事件，在 `src/**` 上达到 100% 的语句/分支/函数/行覆盖率。针对真实已部署实例的现场验证：Workspace 创建、带真实工具调用的 Session 创建（通过 shell 工具执行 `ls -la`，模型为 Claude Haiku 4.5），以及 Workspace/Session 在本次改动自身部署调试过程中历经数十次 Container 替换与冷重启后依然存活——全部状态由 D1 支撑，而非位于 Container 的临时磁盘上——均已通过实测确认。

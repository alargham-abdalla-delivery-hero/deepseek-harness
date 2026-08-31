---
description: "Cloudflare 边缘网关 Worker 与 Container 支持的 Durable Object，供部署、配置与调试 Cloudflare 托管 dsh 后端的运维人员使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-cloudflare-worker

[English](README.md) | 中文

## 概述

`dsh-cloudflare-worker` 是 `dsh-cloudflare-app` 托管后端可部署的 Cloudflare Worker：`src/gateway.ts` 是 Worker 入口，对每个客户端连接请求进行身份验证并路由到 `src/host-container.ts` 的 `HostContainer`——一个继承自 `@cloudflare/containers` 的 `Container` 的 Durable Object，它会为一个 Workspace 启动运行已构建 `dsh` Host 的 Cloudflare Container。它从不通过 Cordis 启动，也没有自己的 `dsh --profile` 行——它通过 `wrangler deploy`（本目录下的 `wrangler.jsonc`）独立部署，而 Cloudflare 后端中经 Cordis 承载的那一半（`dsh-storage-d1`、`dsh-session-persistence-d1`）只在这个 Worker 启动的 Container 内部挂载。当 `apps/web` 需要连接云托管 Workspace 而非本地 `dsh web` 进程时，选择部署这个包；它不向任何模型提示或工具贡献任何内容。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在本目录下运行 `wrangler deploy` 部署本包的 Worker，与它所启动的 `dsh-cloudflare-app` profile bundle 配套使用。`wrangler dev` 会针对 Cloudflare 的 Workers/Containers 模拟环境在本地运行它。

### 何时选择它

当需要一个已部署的 Cloudflare 托管后端的入口时选择它（参见 [Cloudflare 托管后端提案](../../../openspec/changes/cloudflare-hosted-backend/design.md)）。它不是一个库——没有任何代码以 `.` 的形式导入 `@deepseek-ai/dsh-cloudflare-worker`；它唯一可导入的入口是 `./invariant`，之所以存在是为了让本包像每个同级包一样参与工作区的 package-invariant 检查。

### 配置

`wrangler.jsonc` 声明了 Container 镜像（`../../../Dockerfile.cloudflare`）、`HOST_CONTAINER` Durable Object 绑定及其 `new_sqlite_classes` 迁移，以及请求未携带显式 `/w/<id>/` 前缀时使用的 `DEFAULT_WORKSPACE_ID` 变量（当今的浏览器客户端始终走这条路径——见"已知限制"）。`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_D1_DATABASE_ID` 与 `CLOUDFLARE_D1_API_TOKEN` 是部署密钥（`wrangler secret put`），从不提交到 `wrangler.jsonc`；网关读取它们以对照 D1 校验 Workspace 是否存在，Durable Object 则把它们转发进 Container 自身的环境变量，供 `dsh-storage-d1`/`dsh-session-persistence-d1` 使用。

### 可观察行为

网关会在触碰任何 Durable Object 之前，拒绝不带 `Cf-Access-Jwt-Assertion` 请求头的请求（`401`)——Cloudflare Access 本身（位于本 Worker 之前）才是真正的身份验证；这里的请求头检查只是纵深防御。随后它解析目标 Workspace：显式的 `/w/<id>/` 路径会在启动或唤醒任何 Container 之前，通过 `dsh-d1-client` 的 REST 路径（无需 D1 绑定）对照 D1 支持的注册表进行检查——不存在的 id 返回 `404`，D1 层面的失败返回 `502`。`DEFAULT_WORKSPACE_ID` 兜底路径（当今唯一由客户端触发的路径）则完全跳过该检查——它指的是本次部署的那一个 Container 槽位，而非需要校验的具体 Workspace 记录（见"已知限制"）。已解析出的目标会经由 `getContainer(env.HOST_CONTAINER, workspaceId)` 路由到其 `HostContainer`——确定性的 Durable Object 命名天然保证了同一目标的每个请求都具有会话亲和性。Durable Object 自身的 `fetch` 会启动或唤醒其 Container（`sleepAfter = '30m'` 空闲停止），并在容器端口尚未响应时报告明确的 `202 {status: "starting"}`，或在容器根本未能启动时报告 `502 {status: "failed", reason}`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 设计理念

- **一个包，两种角色，一个可部署单元。** 边缘网关 Worker 与 Container 支持的 Durable Object 作为单一 `wrangler.jsonc` 单元一起编译、定版并部署——两侧都没有独立的消费者或发布周期，因此拆分为多个包只会增加跨包导入开销，却保护不了任何真实的边界（参见 design.md 的包放置决策）。
- **D1 走 REST，而非绑定。** 网关自身的存在性检查，以及 Container 内的 `dsh-storage-d1`/`dsh-session-persistence-d1`，都使用 `dsh-d1-client` 的 REST 查询 API 与同样的三个凭据来访问 D1，与 Cloudflare 托管后端的其余部分保持一致——`wrangler.jsonc` 中没有 `d1_databases` 绑定。
- **存在性检查，而非按用户的所有权检查。** 本部署面向单一主体（Cloudflare Access 已经把整个 Worker 限制给一个主体或白名单）；`dsh-workspace` 的 `WorkspaceRecord` 不携带任何 owner 字段。因此网关的授权步骤是"这个 Workspace id 是否能在注册表中解析到记录"，而不是身份比对——参见 design.md 中修订后的 Auth 决策。
- **透传式 Container 代理。** `HostContainer.fetch()` 启动容器后，把请求委托给 `@cloudflare/containers` 自身的 `Container.fetch()`，后者会把原始请求——包括任何 WebSocket 升级——直接代理到容器的 HTTP 端口。Durable Object 层不缓存任何 `follow()` 或 WebSocket 路由状态；这一切都存在于 `dsh` Host 进程自身内部，与本地运行时完全一致。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Wrangler 入口：Worker 的默认导出，以及 `wrangler.jsonc` Durable Object 绑定名所需的 `HostContainer` 重新导出 |
| [`src/gateway.ts`](src/gateway.ts) | 边缘 Worker：身份验证、Workspace 解析与存在性检查、路由 |
| [`src/host-container.ts`](src/host-container.ts) | `HostContainer` Durable Object：容器启动/唤醒、starting/failed 状态分类 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生模块（无运行时不变量：本包从不通过 Cordis 启动） |
| [`wrangler.jsonc`](wrangler.jsonc) | Container 镜像、Durable Object 绑定与迁移、非敏感变量 |
| [`tsconfig.json`](tsconfig.json) | 在 `@cloudflare/workers-types` 下编译 `src`/`tests`；`wrangler` 自身的打包器直接读取 `src/index.ts`，从不读取 `lib/` |
| [`tsconfig.invariant.json`](tsconfig.invariant.json) | 独立的子工程，仅在本仓库普通的、Node 风格的 `tsconfig.base.json` 下编译 `src/invariant.ts`——由根级 `tsconfig.host.json` 引用，使 `pnpm run build` 仍能产出每个包都会发布的 `lib/invariant.js`（参见 `scripts/check-workspace-constraints.ts` 中的 `deployOnlyWorkerPackages`） |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Cloudflare 后端组映射](../README.zh.md)——本包相对于它所启动的、由 D1 支持的存储/会话持久化提供者的位置。
- [`dsh-cloudflare-app` bundle](../../bundle/cloudflare-app/README.zh.md)——本包 Container 镜像所启动的 `dsh --profile cloudflare` 组合。
- [Cloudflare 托管后端提案](../../../openspec/changes/cloudflare-hosted-backend/design.md)——更广泛的架构，包括本包从 `@cloudflare/containers` 继承而来的 beta API 风险。
- [`cloudflare/edge-gateway` 与 `cloudflare/host-container` 规范](../../../openspec/changes/cloudflare-hosted-backend/specs/cloudflare/)——本包实现的可观察行为要求。

-----

<a id="model-experience"></a>
## 模型体验

### 边缘路由与 Container 生命周期

#### 模型看到什么

无。本包只是一个部署用的 Worker/Durable Object 组合——`handleRequest` 与 `HostContainer` 完全运行在边缘以及 Container 自身的 host 进程内；它不贡献任何提示词、工具或模式（schema），也从不在 agent 循环内运行。

#### Token 影响

零实时请求 token。

#### KV 缓存影响

无——本包从不触及任何实时请求前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

以下限制界定了本包在何种情况下不适用、或需要特别的运维关注。它们是当前的包级约束，而非任务待办清单。

- **仅支持单一主体部署**——Workspace 存在性检查并非按用户的所有权检查;一个部署背后的每个 Workspace,都可以被 Cloudflare Access 放行的任何调用方访问。真正的按 Workspace、按用户所有权需要在 `WorkspaceRecord` 上添加一个今天并不存在的 owner 字段,已延后到后续的多租户提案(design.md 的 Non-Goals)。
- **客户端尚不支持 `/w/<id>/`**——`resolveWorkspaceId` 接受一个显式路径前缀,但今天的 `apps/web` 客户端从不发送它;今天的每次部署实际上都是单 Workspace 的,通过 `DEFAULT_WORKSPACE_ID` 路由。
- **没有冷启动/容器失败的测试覆盖**——`tests/gateway.spec.ts` 针对 `@cloudflare/vitest-pool-workers` 真实运行网关逻辑(拒绝未认证请求、拒绝不存在的 Workspace、D1 失败时返回 502、按 Durable Object id 验证会话亲和性),但在该工具下构造 `HostContainer` 会抛出 `Containers have not been enabled for this Durable Object class`——这是一个已确认、目前仍未解决的上游缺陷([cloudflare/workers-sdk#10408](https://github.com/cloudflare/workers-sdk/issues/10408)),与 Docker 是否可用无关。`HostContainer` 的 starting/failed 状态分类需针对真实的 `wrangler dev` 或部署来验证。
- **并非所有主机都能构建 Container 镜像**——`wrangler dev` 与 `wrangler deploy` 都会先在本地构建 Container 镜像,再运行或推送它。在某些 Docker 守护进程的主机上,镜像自身的 `pnpm install` 执行到一半时会出现 `node: ../deps/uv/src/unix/linux.c:1430: uv__io_poll: Assertion 'errno == EEXIST' failed. Aborted (core dumped)`(在一台内存充足的 Colima VZ 后端虚拟机上可复现,3/3 次尝试均如此),构建会确定性地失败——这是该特定虚拟化技术栈中的 libuv/内核交互问题,而不是本 Dockerfile 的缺陷,也不是内存上限问题(此前已解决的内存问题是另一回事——参见 Agent Note)。在这台主机上已排查并排除:内存上限(已单独解决,但未修复此崩溃)、Container 自身的 Node 版本(Node 22 与 Node 24 基础镜像崩溃表现完全一致——并非 libuv 版本缺陷)、以及 Colima 的 QEMU 后端(在更深一层被卡住——Homebrew 的 `qemu` bottle,即使从源码用默认 formula 重新构建,也完全没有编译进 HVF 硬件加速支持,`Accelerators supported in QEMU binary` 仅有 `tcg`;真正的修复需要在 Homebrew formula 之外,针对上游源码手动构建 QEMU 并显式传入 `--enable-hvf`,且不保证能解决最初的崩溃)。即使 Container 那一半构建失败,部署中 Worker 的那一半仍可独立成功并上线。请在没有此交互问题的主机(另一台机器、CI runner)上构建,而不要在这个特定环境中继续排查。
- **`DEFAULT_WORKSPACE_ID` 是一个路由槽位，而非 Workspace id**——`@deepseek-ai/dsh-workspace` 会为每个真实 Workspace 分配一个随机的 `randomUUID()` id，因此任何字面量配置值（例如 `"default"`）都不可能与之相等。网关只对*显式*的 `/w/<id>/` 请求做存在性检查；`DEFAULT_WORKSPACE_ID` 兜底路径完全跳过该检查，始终路由到本次部署的那一个 Container，从而让一个全新部署无需引导死锁即可创建它的第一个 Workspace。
- **`@cloudflare/containers` 处于 beta 阶段**——没有 SLA,其 API 可能随时发生不另行通知的变化;应将本包的 Container 编排代码视为该依赖更新时最可能需要后续修改的部分。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

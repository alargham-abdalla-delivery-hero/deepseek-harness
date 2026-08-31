---
description: "面向宿主与维护者的 Cloudflare 托管 profile 组合包：部署、配置或调试运行在 Cloudflare Container 中的 dsh Host。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-cloudflare-app

[English](README.md) | 中文

## 概述

运行 `dsh --profile cloudflare`，你将得到与本地 `dsh --profile web` 完全相同的浏览器 UI、Workspace 管理与聊天体验，只是绑定到 Cloudflare D1 而非本地文件系统。本组合包对 `dsh-web-app` 打 patch（profile 分层顺序：`dsh-base` → `dsh-web-app` → `dsh-cloudflare-app`），而不是重新复制一份：它禁用本地的 `storage-json`/`session-persistence-jsonl`/`credentials-local` 后端，将 `ctx.storageDomain` 路由到 `@deepseek-ai/dsh-storage-d1`，挂载 `@deepseek-ai/dsh-session-persistence-d1` 与 `@deepseek-ai/dsh-credentials-d1`，把 webserver 绑定到全部网络接口并信任本次部署自己的公网主机名，关闭本地浏览器唤起以及浏览器会话启动令牌门（改由 Cloudflare Access 认证每个调用方），基于同样的信任论证为这个非 loopback 来源解锁 Models Settings UI（`trustedAsHost`），并组合出一个默认的 `anthropic` 模型路由（Claude Haiku 4.5），使全新部署在任何人碰 Settings 之前就有一个可用模型——除此之外的每一行配置（聊天 UI、workspace/会话/设置控制器、目录选择器）都保持不变。当需要把 `dsh` Host 打包进 Cloudflare Container 的 Docker 镜像时选择该 profile；普通本地使用请选择 `web`。本组合包不贡献任何自己的提示词、工具或模式——每一个面向模型的表层都属于它所 patch 的那些配置行，而非本包。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 启动该 profile

```sh
dsh --profile cloudflare --port 8080 --no-open
```

这些参数都是 `dsh-web-app` 自己的——本组合包不新增任何参数，也刻意不传 `--host`：`dsh-host-webserver` 的 `Config.host` schema 是一个封闭的 `'127.0.0.1' | '0.0.0.0'` 联合类型，而 `dsh-web-app` 自身的命令行会把字面量 `--host 0.0.0.0` 作为本机安全防护直接拒绝。本组合包的 `cordis.patch.yml` 直接把 webserver 那一行的 `host` 设为 `0.0.0.0`，绕过 `--host` 参数路径（及其防护）而不是为共享的 `dsh-web-app` 表面削弱它——已对照真实部署确认：`127.0.0.1` 无法从 Cloudflare 自己的容器端口健康检查触达，该检查连接的是这个实例实际分配到的地址，而非 loopback。仓库根目录下的 `/Dockerfile.cloudflare` 把这条确切的调用方式固化进了它的 `CMD`。

### 必需的环境变量

| 变量 | 含义 |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | 拥有该 D1 数据库的 Cloudflare 账号 id |
| `CLOUDFLARE_D1_DATABASE_ID` | D1 数据库 id（来自 `wrangler d1 create` 的输出） |
| `CLOUDFLARE_D1_API_TOKEN` | 具备 D1 编辑权限的 Cloudflare API 令牌 |
| `CLOUDFLARE_WORKER_HOSTNAME` | 本次部署自己的公网主机名；供给 Host/Origin 信任栏栅，否则它会拒绝任何 `Host` 既非 loopback 又不在显式配置的授权列表内的请求 |

缺少上面三个 `CLOUDFLARE_*` 变量中的任何一个，都会让启动立即、明确地失败（`cloudflare-app-startup`），甚至在 D1 后端尝试任何 REST 调用之前——见"可观察行为"。另外两个变量是可选的，仅在设置时（`wrangler secret put <NAME>`）由 Durable Object 转发进容器环境：`DEEPSEEK_API_KEY` 与 `ANTHROPIC_API_KEY`。两者都不是启动所必需的——一个没有配置密钥的 Workspace 仍能创建并持久化 Session，只会让那次调用模型的具体轮次失败——但组合出来的默认模型（Claude Haiku 4.5）要真正给出回答，需要 `ANTHROPIC_API_KEY`。

### 构建容器镜像

```sh
pnpm run build   # apps/cli/lib, apps/web/dist, and every workspace package
docker build -f Dockerfile.cloudflare -t dsh-cloudflare-host .
```

`Dockerfile` 位于仓库根目录，而非本包目录下：Cloudflare Container 的构建模型要求 Dockerfile 自身所在目录即为构建上下文（没有单独的"上下文"设置），而这个镜像需要以整个仓库作为上下文（`COPY packages`、`COPY apps/cli/lib` 等），本包自己的目录无法提供这样的路径。`packages/cloudflare/cloudflare-worker` 的 `wrangler.jsonc`（把该镜像作为 Cloudflare Container 运行的 Worker + Durable Object）以 `../../../Dockerfile.cloudflare` 的形式引用它，解析结果是同一个文件。

该镜像打包的是已经构建好的 `dsh` Host——与本地 `dsh --profile web` 运行的完全是同一条代码路径，而非第二套实现——外加一次全新安装得到的 `node_modules` 闭包（并非从宿主机复制：pnpm 工作区的 `node_modules` 是一棵以宿主机绝对路径为键的符号链接树，无法在跨文件系统复制后存活）。镜像当前的打包范围见"已知限制"。

### 可观察行为

当某个必需的环境变量缺失或为空时，`cloudflare-app-startup` 会立即抛出错误，早于挂载任何其他 cloudflare-app 配置行。通过该检查之后，`dsh-storage-d1`/`dsh-session-persistence-d1` 会按照它们各自 README 中记录的方式，呈现自己特有的 D1 相关故障（模式不匹配、网络故障、D1 API 拒绝）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 设计理念

- **在上面打 patch，而不是另起分支。** 另一种做法——一棵独立的树，把 `dsh-web-app` 约 80 行配置连同 Cloudflare 后端替换全部复制一份——会在任何一侧变化时立刻产生偏差。打 patch 的方式为浏览器 UI/会话/workspace 技术栈保留了唯一的事实来源；本组合包的 patch 之所以很小，正是因为它只触碰真正与 Cloudflare 相关的部分。
- **复用 `dsh-web-app` 自身的命令行解析。** 主机/端口/`--no-open`/`--trusted-host` 全部来自 `dsh-web-app` 的 `web-startup` 配置行，它已经是组合 profile 的一部分（是一个层，而非本组合包需要重新实现的依赖）。本组合包不新增任何命令行接口。
- **在触网之前而非之后明确失败。** `cloudflare-app-startup` 只是一个不涉及任何 Cloudflare 调用的纯环境变量检查——它存在的意义是：让缺失的凭据在启动时就产生一条清晰的错误，而不是等到某次会话或 workspace 第一次触碰存储时才冒出一个难以理解的 D1 REST 故障。
- **profile 名称注册在每个已发布 profile 所在的地方。** `packages/boot/app-boot/src/profile.ts` 的 `PROFILE_TEMPLATES` 新增了一条（`cloudflare: { bundles: [dsh-base, dsh-web-app, dsh-cloudflare-app] }`）——这与定义 `web`/`headless`/`acp`/`sdk` 的机制完全相同，而不是另一条并行的解析路径。

### 源码索引

| 文件 | 角色 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 全部 Cloudflare 相关 patch：禁用本地后端、将 `storage-domain` 路由到 `d1`、插入 `storage-d1`/`session-persistence-d1`/`credentials-d1`/启动检查、把 webserver 绑定到全部网络接口并信任本次部署自己的主机名、关闭本地浏览器唤起以及浏览器会话启动令牌门、解锁 Models Settings UI（`trustedAsHost`）、组合出默认的 `anthropic` 模型路由 |
| [`src/index.ts`](src/index.ts) | `cloudflare-app-startup`：必需环境变量检查 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件（无运行时不变量：环境变量检查是一次性的启动时断言） |
| [`/Dockerfile.cloudflare`](../../../Dockerfile.cloudflare) | 打包已构建的 `dsh` Host，并以该 profile 作为容器入口启动（位于仓库根目录——原因见"构建容器镜像"） |
| [`/docker-entrypoint.cloudflare.sh`](../../../docker-entrypoint.cloudflare.sh) | 容器实际的 `CMD`：不带 `--host` 参数，因为本组合包的配置 patch 直接设置了它 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`dsh-web-app` README](../web-app/README.zh.md)——本包所 patch 的组合包；凡是本包 `cordis.patch.yml` 未列出的配置行，其行为完全与该文档一致。
- [Profile 组合包设计笔记](../../../.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.zh.md)——本包所参与的 profile/组合包组合机制。
- [`dsh-storage-d1` README](../../storage/storage-d1/README.zh.md)、[`dsh-session-persistence-d1` README](../../session/session-persistence-d1/README.zh.md) 与 [`dsh-credentials-d1` README](../../credentials/credentials-d1/README.zh.md)——本组合包挂载的三个 D1 支撑的 provider。
- [Cloudflare 托管后端提案](../../../openspec/changes/cloudflare-hosted-backend/design.md)——本包镜像所部署到的更大架构（边缘 Worker、Container 支撑的 Durable Object）。
- [Agent Note：Cloudflare 托管后端](../../../.agents/notes/implemented/architecture/2026-08-31-cloudflare-hosted-backend.zh.md)——本组合包 patch 所编码的那些决定，其中好几个只有在真正部署之后才被发现。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只 patch 配置行并检查环境变量；每一个面向模型的提示词、工具与模式都属于它所 patch 的那些配置行（`dsh-web-app` 及其自身的依赖树），而非本组合包。

#### KV 缓存影响

无——本包不注册任何请求时行为。

## 已知限制与待办事项

<a id="known-limitations-and-deferred-work"></a>

- **容器镜像打包尚未面向生产环境做精简** —— 镜像执行的是一次完整的 `pnpm install --frozen-lockfile`（每个工作区成员，开发依赖与运行时依赖一并安装——本仓库"peerDependency 通过 devDependency 满足"的约定意味着仅生产环境的安装会悄悄丢弃若干运行时导入实际需要的包），而非仅生产环境的精简安装（例如通过 `pnpm deploy`）；镜像可以正常工作，但远大于必要体积。精简工作被推迟。
- **`--help` 文字显示为 "dsh --profile web"** —— 这是从 `dsh-web-app` 自身的 `Command().name()` 调用中原样继承而来，因为本组合包刻意复用了那套命令行解析而不是重新实现；纯属外观问题，在 `--profile cloudflare` 下每个参数的行为都完全一致。
- **`$DSH_HOME` 位于容器自身的临时磁盘上** —— `/Dockerfile.cloudflare` 设置了 `DSH_HOME=/app/.dsh-home`，让 profile 解析的簿记有一个可写位置，但其下的任何内容都不会在容器重启后持久保留；只有经由 `dsh-storage-d1`/`dsh-session-persistence-d1`/`dsh-credentials-d1` 存入 D1 的状态才会存活。
- **在这台 Apple Silicon 开发主机上本地 `docker build` 会确定性崩溃**（`uv__io_poll: errno == EEXIST`，一个 libuv/Colima-VZ 交互问题），无论 Colima VM 后端或内存大小如何——已改用 GitHub Actions CI 部署绕开（`.github/workflows/deploy-cloudflare-worker.yml`，GitHub 托管的 Linux runner 没有这层 VM），而非在本地修复。在 Apple Silicon 上构建这个镜像仍未经验证；只有 CI 这条路径已确认可用。
- **没有 Miniflare Container 测试覆盖**（`cloudflare/workers-sdk#10408`，一个上游 bug）—— `packages/cloudflare/cloudflare-worker` 自己的集成测试只跑到 Container 真正启动之前的那个点为止；这次部署在那条边界之外的实际行为，只由真实的已部署实例验证，而不是由 CI 验证。
- **`wrangler deploy` 需要 `--containers-rollout=immediate`** —— 默认的渐进式 rollout 会让一个刚建立连接的 Container 实例停留在旧镜像上直到过了宽限期；单 Workspace 部署根本没有多实例种群可供渐进式 rollout 分批替换，因此 `.github/workflows/deploy-cloudflare-worker.yml` 始终传这个 flag。手动 `wrangler deploy` 时省略它会让旧代码悄悄继续服务真实流量。
- **组合出的默认模型（`anthropic`／Claude Haiku 4.5）需要一个按 workspace 限定范围的 `ANTHROPIC_API_KEY`** —— 一个 identity-linked（由组织签发、未限定 workspace）的密钥会让每个请求都以 `anthropic-workspace-id is required` 失败，因为 `llm-pi-ai` 的 adapter 不会发送该请求头。请在 Anthropic Console 中创建时显式限定该密钥的 workspace 范围；如果无法获得限定范围的密钥，也可以通过该路由的 `headers` 配置字段添加这个请求头。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景——点击展开</summary>

无。

</details>

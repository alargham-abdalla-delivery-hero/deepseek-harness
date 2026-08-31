---
description: "面向宿主与维护者的 Cloudflare D1 凭据提供方：选择、配置或调试通过 D1 REST API 访问的持久化 CredentialRef/CredentialKey 存储。"
kind: "package-reference"
---

# @deepseek-ai/dsh-credentials-d1

[English](README.md) | 中文

## 概述

`dsh-credentials-d1` 是一个 `CredentialProvider`，将每个 `CredentialRef` 值和 `CredentialKey` 记录存储在一个 Cloudflare D1 数据库中，注册为 `ctx.credentials`。它通过 Cloudflare 的 REST 查询 API（`fetch`、账号 id、数据库 id 和 API 令牌）访问 D1，而不是通过 Workers 绑定，因此可以在任何 Node 进程中运行——本地开发 shell、CI 任务，或在 Cloudflare Container 中运行的 `dsh` Host。与 `dsh-credentials-local` 分层的文件/`.env`/继承环境变量栈不同，本提供方只有一个持久的可写来源：`set`、`unset` 和 `modifyRecord` 写入的正是 D1，而它读取的唯一其他来源是 `process.env`，且严格作为 D1 之下的只读引导回退（参见[可观察行为](#use-this-package)）。当某次 Cloudflare 托管部署中，Models 设置界面必须独立于任何一个容器的生命周期持久保存密钥时选择它；单机、本地优先的部署应选择 `dsh-credentials-local`。该提供方仅面向宿主侧：它不贡献任何提示词、工具或模式，模型与 agent 循环永远不会看到它。

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

当某次 Cloudflare 托管部署需要其凭据能够独立于任何一个容器而持久保存时使用本包：它在组合中取代 `dsh-credentials-local`，并注册相同的 `ctx.credentials` 接缝。

### 何时选择它

当某次部署存储的 API 密钥与授权授予必须独立于任何单个容器存活时选择它——Cloudflare 托管的部署是主要场景。当部署是本地优先、由单一机器在其整个生命周期内拥有凭据文件时选择 `dsh-credentials-local`。每次调用都是一次到 Cloudflare API 的网络往返，单次操作延迟高于本地文件读取——该提供方在性能上并非本地提供方的直接等价替代。

### 配置

三个必填字段：Cloudflare 账号 id、D1 数据库 id，以及一个已获授权访问 D1 的 API 令牌。

```yaml
- name: '@deepseek-ai/dsh-credentials-d1'
  config:
    accountId: !!js process.env.CLOUDFLARE_ACCOUNT_ID
    databaseId: !!js process.env.CLOUDFLARE_D1_DATABASE_ID
    apiToken: !!js process.env.CLOUDFLARE_D1_API_TOKEN
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `accountId` | 必填 | 拥有该 D1 数据库的 Cloudflare 账号 id |
| `databaseId` | 必填 | D1 数据库 id（来自 `wrangler d1 create` 的输出，而非可读的数据库名称） |
| `apiToken` | 必填 | 具备 D1 编辑权限的 Cloudflare API 令牌 |

如上例所示，在 cordis.yml 层通过环境变量或其他 `!!js` 求值表达式来提供 `apiToken`——切勿提交字面量令牌。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-credentials-d1)是每个可接受字段及其 JSDoc 的详尽来源。

### 可观察行为

`resolve` 与 `describe` 首先检查已存储的 D1 行，仅当不存在该行时才回退到非空的 `process.env[ref]`——此处 D1 的优先级*高于* `process.env`，这与 `dsh-credentials-local`“继承环境变量优先”的规则相反，因为两者的角色本身就是相反的：本部署中的 `process.env` 是固定的部署时引导值（例如容器转发的 `DEEPSEEK_API_KEY`），容器启动后运维者无法编辑它；而 D1 是 Settings UI 可写的存储，写入后必须立即生效。`set`/`unset` 永远不会因为“会被遮蔽”而拒绝——没有任何层级优先于 D1，因此写入永远不会被更高优先级的层悄悄覆盖为无效。`modifyRecord` 在并发调用者之间是“最后写入者获胜”而非串行化的（参见[已知限制](#known-limitations-and-deferred-work)）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 设计理念

- **只有一个可写来源，因此无需遮蔽逻辑。** `dsh-credentials-local` 分层了继承环境变量、其管理的文件,以及两个 `.env` 回退,并且必须拒绝会被环境变量遮蔽的写入。本提供方恰好只有一个可写来源（D1）；它读取的唯一其他来源（`process.env`）优先级*低于* D1，因此写入永远不会有被更高优先级层悄悄覆盖的风险。这正是本实现体量远小于 `dsh-credentials-local` 的原因：没有文件锁、没有监视器、没有分层文档格式。
- **两张固定表，而非 KV 单元布局。** `credential_refs (ref TEXT PRIMARY KEY, value TEXT NOT NULL)` 与 `credential_records (key TEXT PRIMARY KEY, value TEXT NOT NULL)` 直接保存该接缝的两个互不相交的键空间。本提供方并非 `ctx.storageDomain` 后端，因此不使用 `dsh-d1-client` 的 `recordTableName`/`u_<unit>_<table>` 约定——这与 `dsh-session-persistence-d1` 为其自身的 `sessions`/`events` 表所做的选择相同。
- **无需 Workers 绑定。** `D1Client` 使用 `fetch`、账号 id、数据库 id 和 API 令牌直接调用 D1 文档化的 REST 查询端点——这正是 Cloudflare 为“服务端脚本”和“非 Worker 集成”所记录的路径。
- **无分布式锁的读改写。** `modifyRecord` 读取当前记录、运行调用者的 `mutate`，并以两次独立的 HTTP 往返写入结果——D1 的 REST API 没有暴露任何可供无状态 REST 客户端在两次调用之间持有的跨调用事务原语。参见已知限制。

### 源码索引

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `D1CredentialProvider`：针对 `credential_refs`/`credential_records` 实现每个抽象 `CredentialProvider` 方法 |
| [`src/schema.ts`](src/schema.ts) | 模式确保序列与物理布局版本 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件（无运行时不变量：版本检查发生在打开时） |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [凭据子系统参考](../../../docs/subsystems/credentials.zh.md) — `CredentialRef` 与 `CredentialKey`、按操作解析、对 UI 安全的 `CredentialInfo`。
- [凭据包索引](../README.zh.md) — 该系列包及其在仓库中的位置。
- [本地凭据提供方](../credentials-local/README.zh.md) — 在 Cloudflare 托管组合中被本包取代的本地优先提供方。
- [Cloudflare 托管后端提案](../../../openspec/changes/cloudflare-hosted-backend/design.md) — 本提供方所属的更大架构。

-----

<a id="model-experience"></a>
## 模型体验

### 存储的凭据

#### 模型所见

无。该提供方不贡献任何提示词、工具或模式；它仅在 `ctx.credentials` 之后为宿主侧消费者存储密钥值，其实现的抽象接缝永远不会让值直接进入模型请求。

#### Token 影响

对实时请求零 token 影响。

#### KV 缓存影响

无——该提供方从不触及实时请求前缀。

## 已知限制与待办事项

<a id="known-limitations-and-deferred-work"></a>

以下限制界定了该提供方在何种情况下不合适，或需要特别的运维关注。它们是当前包的约束，而非任务待办列表。

- **`modifyRecord` 无跨进程串行化** — 与 `dsh-credentials-local` 的跨进程写入者锁（一个真实的文件锁）不同，本提供方的读后写序列在两次网络调用之间没有原子性。来自*不同*进程、针对*同一*键的并发 `modifyRecord` 调用可能发生竞争，最后写入者获胜；这是可接受的，因为更广泛的 Cloudflare 托管架构每个 Workspace 恰好运行一个 Host 进程，正常运行中不会出现真正的跨进程并发记录写入者——这与 `dsh-session-persistence-d1` 为其自身的读后批处理写入序列所记录的权衡完全相同。
- **没有忙等待或重试策略** — 失败的 D1 请求（网络错误、限流、瞬时 5xx）会立即拒绝而非重试。
- **仅当前物理模式版本可打开** — 任何其他已标记的 `d1_credentials_schema_version` 都会被拒绝而非迁移（预发布阶段立场）。
- **单次操作的网络延迟** — 每个提供方原语都是一到两次到 Cloudflare API 的 HTTP 往返；对于本地文件读取场景，该提供方在性能上并非 `dsh-credentials-local` 的直接等价替代。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景——点击展开</summary>

无。

</details>

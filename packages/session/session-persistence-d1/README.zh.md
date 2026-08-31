---
description: "面向宿主与维护者的 Cloudflare D1 持久会话存储：选择、配置或调试通过 D1 REST API 访问的会话日志。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-persistence-d1

[English](README.md) | 中文

## 概述

`dsh-session-persistence-d1` 是一个 `SessionPersistence` 提供方，将每个会话的事件日志持久存储在一个 Cloudflare D1 数据库中，通过 D1 的 REST 查询 API（`fetch`，无需 Workers 绑定）访问，因此可以在任何 Node 进程中运行——包括在 Cloudflare Container 中运行的 `dsh` Host。所有版本号追踪、写回批处理、prepare/inspect 编排与崩溃修复排序都来自 `@deepseek-ai/dsh-session-persistence` 共享的 `PersistenceCoordinator`；本包只实现协调器所委托的物理 D1 读写原语——这与 `dsh-session-persistence-sqlite` 对协调器的关系完全相同。当某次部署的会话数据必须独立于任何一台机器而持久存在时选择它；本地优先、单机部署应选择 SQLite 或 JSONL 后端。该后端不贡献任何提示词、工具或模式——模型通过普通的会话机制看到已恢复的对话历史，永远不会直接看到本包。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办事项](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时选择它

当某次部署的会话历史必须独立于任何一台机器或容器存活时选择它——Cloudflare 托管的部署是主要场景。当部署是本地优先、由单一机器在其整个生命周期内拥有数据时选择 SQLite 后端。每次调用都是一次到 Cloudflare API 的网络往返，单次操作延迟高于本地数据库——该后端在性能上并非本地后端的直接等价替代。

### 配置

```yaml
- name: '@deepseek-ai/dsh-session-persistence-d1'
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
| `preparedSessionCacheSize` | `5` | 为“历史转恢复”复用保留的最大冷 Session 准备数量 |
| `writeBatchMaxDelayMs` | `200` | 固定的实时事件合并窗口；并非完成期限 |

如上例所示，在 cordis.yml 层通过环境变量或其他 `!!js` 求值表达式来提供 `apiToken`——切勿提交字面量令牌。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-session-persistence-d1)是每个可接受字段及其 JSDoc 的详尽来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 设计理念

- **协调器承担所有难题。** `PersistenceCoordinator`（来自 `dsh-session-persistence`）在任意 `PersistenceBackend` 之上通用地提供版本号追踪、写回批处理、冷准备缓存、prepare/inspect/borrow 编排与崩溃修复排序。本包只实现那个更小的接口——`loadStored`/`readStoredRevision`/`appendBatch`/`commitRepair`/`list`/`listSnapshots`，以及可选的支持定位读取的 `loadStoredFrom` 与 `materializeHeader`——这与 `dsh-storage-sqlite` 对 `storage-domain` 的 `DomainFacility` 的关系相同。
- **每行一个事件——刻意比 SQLite 后端更简单。** `dsh-session-persistence-sqlite` 将符合条件的事件序列打包进更少的、经 zstd 压缩的行，以最小化本地磁盘的行数。D1 的 REST 访问模式不具有相同的激励（没有本地磁盘需要节省），因此本后端为每个逻辑事件存储一个物理行——没有分块打包，没有压缩编解码。该权衡取舍参见"已知限制"。
- **会话 id 本身就是事件表的外键。** SQLite 后端使用内部自增整数键来紧凑地引用一个会话的事件；本后端直接使用会话自身的 id 字符串引用事件，去掉了这层间接，因为 D1 的行存储经济性并不以同样的方式回报这种做法。
- **无需 Workers 绑定。** `D1Store` 使用 `fetch`、账号 id、数据库 id 和 API 令牌直接调用 D1 文档化的 REST 查询端点——这正是 Cloudflare 为"服务端脚本"和"非 Worker 集成"所记录的路径。

### 源码索引

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `D1SessionPersistence`：将每个 `SessionPersistence` 方法委托给一个 `PersistenceCoordinator` 的薄胶水层 |
| [`src/store.ts`](src/store.ts) | `D1Store`：`PersistenceBackend<number>` 实现——物理 D1 读写、版本号令牌、断尾检测与修复 |
| [`src/schema.ts`](src/schema.ts) | 物理模式版本、模式确保序列、行编解码、断尾扫描 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件（无运行时不变量：版本与版本号检查发生在读取时） |

### 没有 SQL 事务的断尾修复

D1 的 REST API 没有跨调用的事务概念——每次 `query`/`batch` 调用都是一次独立的 HTTP 往返。`appendBatch` 与 `commitRepair` 通过"先读后批写"序列来弥补：读取当前存储的尾部，校验即将写入的批次是否延续了它，然后将每条语句（事件插入加上版本号递增）作为一次原子 D1 批处理写入。畸形或有缺口的物理行的检测方式与 SQLite 后端相同——按 seq 顺序扫描已存储的行，把第一个不连续或无法解析的行视为断尾边界——只是没有分块打包带来的关于"一行代表什么"的额外歧义。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [会话持久化子系统](../../../docs/subsystems/persistence.zh.md) — 本包实现的 `PersistenceBackend`/`SessionPersistence` 约定。
- [会话持久化包索引](../README.zh.md) — 该系列包及其在仓库中的位置。
- [SQLite 会话持久化](../session-persistence-sqlite/README.zh.md) — 本包模式在物理布局上刻意简化的兄弟后端。
- [Cloudflare 托管后端提案](../../../openspec/changes/cloudflare-hosted-backend/design.md) — 本后端所属的更大架构。

-----

<a id="model-experience"></a>
## 模型体验

### 已恢复的对话历史

#### 模型所见

不直接来自本包的任何内容。已恢复会话的先前对话轮次会按照 `PersistenceCoordinator` 重建的方式送达模型——本后端只提供持久化字节。

#### Token 影响

固定：已恢复的历史恰好占用其事件本身所代表的 token 数量，与任何其他持久化后端相同。

#### KV 缓存影响

无——本后端从不触及实时请求前缀；它在请求之间持久化，而非在单次请求内部持久化。

## 已知限制与待办事项

<a id="known-limitations-and-deferred-work"></a>

以下限制界定了该后端在何种情况下不合适，或需要特别的运维关注。它们是当前包的约束，而非任务待办列表。

- **没有跨进程写隔离** — 与 SQLite 后端的 `begin-immediate` 事务（会获取真实的文件锁）不同，本后端的"先读后批写"序列在两次网络调用之间没有原子性。来自*不同*进程对*同一*会话的并发写入者可能产生竞争；之所以接受这一点，是因为更广泛的 Cloudflare 托管架构为每个 Workspace 恰好运行一个 Host 进程，因此在正常运行中不应出现对同一会话的真正跨进程并发写入者。
- **没有忙等待或重试策略** — 失败的 D1 请求（网络错误、限流、瞬时 5xx）会立即拒绝而非重试。
- **仅当前物理模式版本可打开** — 任何其他已标记的 `d1_session_schema_version` 都会被拒绝而非迁移（预发布阶段立场）。
- **没有分块打包或压缩** — 每行一个事件，不同于 SQLite 后端打包、经 zstd 压缩的行；该权衡为何适配 D1 的访问模式见"设计理念"。
- **单次操作的网络延迟** — 每个持久化原语都是一次或多次到 Cloudflare API 的 HTTP 往返；对于高频写入场景，该后端在性能上并非本地 SQLite/JSONL 后端的直接等价替代。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>面向维护者的工作背景——点击展开</summary>

无。

</details>

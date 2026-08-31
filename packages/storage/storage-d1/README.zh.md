---
description: "面向宿主与维护者的 Cloudflare D1 存储后端：选择、配置或调试通过 D1 REST API 访问的按行存储文档式 KV 存储。"
kind: "package-reference"
---

# @deepseek-ai/dsh-storage-d1

[English](README.md) | 中文

## 概述

`dsh-storage-d1` 是一个存储后端，将每个路由到它的单元托管在一个 Cloudflare D1 数据库中，每条记录以一行 JSON 文档的形式存储，注册为后端 `d1`。它通过 Cloudflare 的 REST 查询 API（`fetch`、账号 id、数据库 id 和 API 令牌）访问 D1，而不是通过 Workers 绑定,因此可以在任何 Node 进程中运行——本地开发 shell、CI 任务，或在 Cloudflare Container 中运行的 `dsh` Host。当某次部署的 Workspace 或会话数据必须独立于任何一个进程或机器而持久存在时选择它；单机、本地优先的部署应选择 SQLite 或 JSON 后端。该后端仅面向宿主侧：它不贡献任何提示词、工具或模式,模型与 agent 循环永远不会看到它。

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

当某次组合需要其领域数据能够独立于任何一个进程而持久保存时使用本包：将相关领域路由到该后端,每个单元便会在所配置的 D1 数据库中具化为若干张表。

### 何时选择它

当某次部署的 Workspace 注册表或会话数据必须独立于任何一台机器或容器存活时选择它——Cloudflare 托管的部署是主要场景。当部署是本地优先、由单一机器在其整个生命周期内拥有数据时选择 SQLite 后端；当需要以纯文本文件形式供人查看或编辑存储数据时选择 JSON 后端。每次调用都是一次到 Cloudflare API 的网络往返,单次操作延迟高于本地数据库——该后端在性能上并非本地后端的直接等价替代。

### 配置

三个必填字段：Cloudflare 账号 id、D1 数据库 id,以及一个已获授权访问 D1 的 API 令牌。

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-d1'
  config:
    accountId: !!js process.env.CLOUDFLARE_ACCOUNT_ID
    databaseId: !!js process.env.CLOUDFLARE_D1_DATABASE_ID
    apiToken: !!js process.env.CLOUDFLARE_D1_API_TOKEN
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: d1
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `accountId` | 必填 | 拥有该 D1 数据库的 Cloudflare 账号 id |
| `databaseId` | 必填 | D1 数据库 id（来自 `wrangler d1 create` 的输出,而非可读的数据库名称） |
| `apiToken` | 必填 | 具备 D1 编辑权限的 Cloudflare API 令牌 |

如上例所示,在 cordis.yml 层通过环境变量或其他 `!!js` 求值表达式来提供 `apiToken`——切勿提交字面量令牌。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-storage-d1)是每个可接受字段及其 JSDoc 的详尽来源。

### 可观察行为

当某个单元存储的格式版本与其描述符不一致时,拒绝并返回 `version-mismatch`；当数据库标记的物理格式版本与当前版本不同,则整体拒绝——不做迁移,这是预发布阶段的立场。到达 D1 的网络失败、无法解析的 D1 响应,以及 D1 报告的查询错误,均以普通 `Error` 的形式呈现（而非 `StorageError`）——它们是基础设施故障,而非契约违反；文档化的 `StorageError` 代码（`version-mismatch`、`malformed-medium`、`closed`）只覆盖 KV 后端契约所定义的特定契约失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

该后端是构建在 Cloudflare D1 REST 查询 API 之上的按行文档式布局,物理布局与 SQLite 后端结构相同——D1 本质上就是 SQLite——只是通过 HTTP 而非本地连接访问。

### 设计理念

- **按行存储文档。** 每个单元表都会具化为一张物理表 `u_<unit>_<table> (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,其 `value` 列保存记录的 JSON 文本；全局单例保存在共享的 `unit_globals` 表中。一次按键更新只涉及一行。
- **无需 Workers 绑定。** `D1Client` 使用 `fetch`、账号 id、数据库 id 和 API 令牌直接调用 D1 文档化的 REST 查询端点——这正是 Cloudflare 为“服务端脚本”和“非 Worker 集成”所记录的路径。这也是该后端能够在普通 Node 进程中运行,而无需 Workers/Durable Object 执行环境的原因。
- **每次调用一条语句；批处理具有原子性。** 每个写入原语只发出一次 D1 查询；多语句的模式确保序列使用 D1 的批处理端点,Cloudflare 文档说明该端点以原子方式执行（所有语句要么全部成功,要么全部失败）。
- **在任何查询之前先校验名称。** 单元名与表名必须匹配 `UNIT_NAME_RE` 之后才能进入查询,因此绝不会将外部输入插值进 SQL 标识符。
- **版本不一致时明确失败。** 物理布局版本保存在一张显式的单行表 `d1_schema_version` 中（D1 的 REST 接口没有等价于 SQLite 本地 `PRAGMA user_version` 的便利机制）；单元格式版本保存在 `units` 表中。任何其他已标记的值都会被拒绝——不做迁移。
- **基础设施故障仍是基础设施故障。** 网络错误、非 JSON 响应或 D1 报告的查询失败均以带有诊断信息的普通 `Error` 呈现——不会被误判为 KV 后端契约中某个特定的 `StorageError` 代码。

### 源码索引

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：后端注册、`accountId`/`databaseId`/`apiToken` 配置、单元表 |
| [`src/schema.ts`](src/schema.ts) | 模式确保序列、物理布局版本、元数据表；从 `dsh-d1-client` 重新导出 `recordTableName` |
| [`src/unit.ts`](src/unit.ts) | 一个已打开的单元：逐次调用的 D1 查询、JSON 值解析、关闭 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件（无运行时不变量：版本检查发生在打开时） |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当本后端的视角不够用时,请阅读以下页面：子系统参考是权威契约,而两个兄弟后端展示了本地优先的替代方案。

- [存储子系统](../../../docs/subsystems/storage.zh.md) — 后端契约、领域语义与生成的 API。
- [存储包索引](../README.zh.md) — 该系列包及其在仓库中的位置。
- [SQLite 存储后端](../storage-sqlite/README.zh.md) — 本后端在物理布局上所模仿的本地优先介质。
- [Cloudflare 托管后端提案](../../../openspec/changes/cloudflare-hosted-backend/design.md) — 本后端所属的更大架构。

-----

<a id="model-experience"></a>
## 模型体验

### 存储的领域记录

#### 模型所见

无。该后端不贡献任何提示词、工具或模式；它仅在 `ctx.storage` 之后为宿主侧消费者持久化非会话领域数据。

#### Token 影响

对实时请求零 token 影响。

#### KV 缓存影响

无——该后端从不触及实时请求前缀。

## 已知限制与待办事项

<a id="known-limitations-and-deferred-work"></a>

以下限制界定了该后端在何种情况下不合适,或需要特别的运维关注。它们是当前包的约束,而非任务待办列表。

- **没有忙等待或重试策略** — 失败的 D1 请求（网络错误、限流、瞬时 5xx）会立即拒绝而非重试；领域层的写入链在单个进程内串行化写入,但针对 Cloudflare API 的跨请求重试不在本包范围内。
- **仅当前物理模式版本可打开** — 任何其他已标记的 `d1_schema_version` 都会被拒绝而非迁移（预发布阶段立场）。
- **单次操作的网络延迟** — 每个 KV 原语都是一次到 Cloudflare API 的 HTTP 往返；对于高频写入场景,该后端在性能上并非本地 SQLite/JSON 后端的直接等价替代。
- **未使用 Sessions API** — 未使用 D1 的长时会话（用于超出 D1 默认语句超时的操作）；每次调用都是单次无状态的查询或批处理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景——点击展开</summary>

无。

</details>

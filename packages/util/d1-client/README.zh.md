---
description: "面向维护者的共享 Cloudflare D1 REST HTTP 客户端，用于构建或调试基于 D1 的存储提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-d1-client

[English](README.md) | 中文

## 概述

`dsh-d1-client` 是一个面向 Cloudflare D1 REST 查询 API（`/accounts/:id/d1/database/:id/query`）的小型 HTTP 客户端，这是在 Workers 运行时之外访问 D1 数据库的文档化路径。它接收账号 id、数据库 id 与 API 令牌，并通过 `fetch` 发出 `query`/`batch` 调用——无需 Workers 绑定，因此基于它构建的任何提供方都可以在普通 Node 进程中运行，包括在 Cloudflare Container 中运行的进程。本仓库中每个基于 D1 的提供方（`@deepseek-ai/dsh-storage-d1`、`@deepseek-ai/dsh-session-persistence-d1`）都共享该客户端，而不是各自重复实现 HTTP 管道。这是一个纯客户端库：它不贡献任何提示词、工具或模式,模型与 agent loop（智能体循环）永远不会看到它。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
import { D1Client } from '@deepseek-ai/dsh-d1-client'

const client = new D1Client({ accountId, databaseId, apiToken })
const result = await client.query('SELECT * FROM units WHERE name = ?', ['workspace'])
await client.batch([{ sql: 'CREATE TABLE IF NOT EXISTS a (k TEXT)' }, { sql: 'CREATE TABLE IF NOT EXISTS b (k TEXT)' }])
```

`query` 运行一条语句并返回其单个结果。`batch` 将多条语句作为一次 HTTP 往返执行；Cloudflare 文档说明 `batch` 以原子方式执行（所有语句要么全部成功，要么全部失败）。构造函数的第二个参数是一个可注入的 HTTP 调用（`(input, init) => Promise<Response>`，默认取全局 `fetch`），因此测试可以直接传入替身，而无需打桩全局对象。任何失败——网络错误、非 JSON 响应，或 D1 报告的查询错误——都会以带有诊断信息的普通 `Error` 呈现；本客户端本身不定义任何错误分类体系，因为它只是一层轻量传输，而非存储约定。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包是一个纯 HTTP 传输层，不涉及任何会话、提示词、工具或模式。

#### KV 缓存影响

无——本包从不触及实时请求前缀。

## 已知限制与待办事项

<a id="known-limitations-and-deferred-work"></a>

- **没有重试策略** — 失败的请求（网络错误、限流、瞬时 5xx）会立即拒绝；重试策略由调用方自行负责。
- **未支持 D1 Sessions API** — 未暴露 D1 的长时会话（用于超出 D1 默认语句超时的操作）；每次调用都是单次无状态的查询或批处理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景——点击展开</summary>

无。

</details>

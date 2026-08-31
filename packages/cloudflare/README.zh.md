---
description: "Cloudflare 托管后端组映射：将浏览器客户端路由到每个 Workspace 专属 dsh Host 的边缘 Worker 与 Container 支持的 Durable Object，供 Cloudflare 托管部署的用户与维护者浏览。"
kind: "package-group"
---

# packages/cloudflare

[English](README.md) | 中文

## 概述

cloudflare 组承载 `dsh-cloudflare-app` 托管后端（参见 [`packages/bundle/cloudflare-app`](../bundle/cloudflare-app/README.zh.md)）可部署的 Cloudflare Worker：一个 Worker 入口对每个客户端连接请求进行身份验证，并将其路由到拥有目标 Workspace 的、由 Container 支持的 Durable Object，该对象会启动一个运行同一份已构建 `dsh` Host 的 Cloudflare Container——与本地路径已测试的构建产物完全相同。它从不通过 Cordis 启动，也没有自己的 `dsh --profile` 行——它通过 `wrangler deploy` 独立部署，而 Cloudflare 后端中经 Cordis 承载的那一半（D1 存储与会话持久化提供者）分别位于 [`packages/storage/storage-d1`](../storage/storage-d1/README.zh.md) 与 [`packages/session/session-persistence-d1`](../session/session-persistence-d1/README.zh.md)，只在这个 Worker 启动的 Container 内部挂载。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包（package） | 职责 |
|---|---|
| [`cloudflare-worker`](cloudflare-worker/README.zh.md) | 边缘网关 Worker + Container 支持的 Durable Object，每个 Workspace 一个 Container |

-----

<a id="related-documentation"></a>
## 相关文档

- [`packages/bundle/cloudflare-app`](../bundle/cloudflare-app/README.zh.md)——这个 Worker 的 Container 镜像所启动的、可选启用的 `dsh --profile cloudflare` bundle。
- [`packages/storage/storage-d1`](../storage/storage-d1/README.zh.md)——在 Container 内运行的、由 D1 支持的 `ctx.storageDomain` 提供者。
- [`packages/session/session-persistence-d1`](../session/session-persistence-d1/README.zh.md)——在 Container 内运行的、由 D1 支持的会话持久化提供者。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

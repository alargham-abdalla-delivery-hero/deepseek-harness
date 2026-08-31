---
description: "The shared Cloudflare D1 REST HTTP client for maintainers building or debugging a D1-backed provider."
kind: "package-library"
---

# @deepseek-ai/dsh-d1-client

English | [中文](README.zh.md)

## Summary

`dsh-d1-client` is a small HTTP client for Cloudflare D1's REST query API (`/accounts/:id/d1/database/:id/query`), the documented path for reaching a D1 database from outside the Workers runtime. It takes an account id, a database id, and an API token, and issues `query`/`batch` calls over `fetch` — no Workers binding required, so any provider built on it runs from an ordinary Node process, including one hosted inside a Cloudflare Container. Shared by every D1-backed provider in this repo (`@deepseek-ai/dsh-storage-d1`, `@deepseek-ai/dsh-session-persistence-d1`) instead of each duplicating its own HTTP plumbing. This is a pure client library: it contributes no prompt, tool, or schema, so the model and the agent loop never see it.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```ts
import { D1Client } from '@deepseek-ai/dsh-d1-client'

const client = new D1Client({ accountId, databaseId, apiToken })
const result = await client.query('SELECT * FROM units WHERE name = ?', ['workspace'])
await client.batch([{ sql: 'CREATE TABLE IF NOT EXISTS a (k TEXT)' }, { sql: 'CREATE TABLE IF NOT EXISTS b (k TEXT)' }])
```

`query` runs one statement and returns its single result. `batch` runs multiple statements as one HTTP round trip; Cloudflare documents `batch` as executing atomically (every statement succeeds or none do). The constructor's second parameter is an injectable HTTP call (`(input, init) => Promise<Response>`, defaulting to global `fetch`) so tests can supply a double directly instead of stubbing globals. Every failure — a network error, a non-JSON response, or a D1-reported query error — surfaces as a plain `Error` with a diagnostic message; this client defines no error taxonomy of its own, since it is a thin transport, not a storage contract.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package is a pure HTTP transport with no session, prompt, tool, or schema involvement.

#### KV Cache effect

None — this package never touches live request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No retry policy** — a failed request (network error, rate limit, transient 5xx) rejects immediately; callers own any retry policy.
- **No D1 Sessions API support** — long-running D1 Sessions (for operations exceeding D1's default statement timeout) are not exposed; every call is a single stateless query or batch.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

---
description: "Cloudflare D1 durable session persistence for hosts and maintainers choosing, configuring, or debugging session logs reached over D1's REST API."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-persistence-d1

English | [中文](README.zh.md)

## Summary

`dsh-session-persistence-d1` is a `SessionPersistence` provider that durably stores every session's event log in a Cloudflare D1 database, reached over D1's REST query API (`fetch`, no Workers binding required) so it runs from any Node process — including a `dsh` Host running inside a Cloudflare Container. All revision tracking, write-behind batching, prepare/inspect orchestration, and crash-repair sequencing come from `@deepseek-ai/dsh-session-persistence`'s shared `PersistenceCoordinator`; this package only implements the physical D1 read/write primitives the coordinator delegates to — the same relationship `dsh-session-persistence-sqlite` has to the coordinator. Choose it when a deployment's session data must survive independently of any one machine; choose the SQLite or JSONL backends for a local-first, single-machine deployment. The backend contributes no prompt, tool, or schema — the model sees resumed conversation history through the ordinary session mechanism, never this package directly.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to choose it

Choose it when a deployment's session history must outlive any single machine or container — a Cloudflare-hosted backend is the primary case. Choose the SQLite backend when the deployment is local-first and one machine owns the data for its whole lifetime. Every call is a network round trip to Cloudflare's API, which is slower per-operation than a local database — this backend is not a drop-in performance equivalent to the local backends.

### Configuration

```yaml
- name: '@deepseek-ai/dsh-session-persistence-d1'
  config:
    accountId: !!js process.env.CLOUDFLARE_ACCOUNT_ID
    databaseId: !!js process.env.CLOUDFLARE_D1_DATABASE_ID
    apiToken: !!js process.env.CLOUDFLARE_D1_API_TOKEN
```

| Field | Default | Meaning |
|---|---|---|
| `accountId` | required | Cloudflare account id owning the D1 database |
| `databaseId` | required | D1 database id (from `wrangler d1 create`'s output, not the human-readable name) |
| `apiToken` | required | Cloudflare API token with D1 Edit permission |
| `preparedSessionCacheSize` | `5` | Maximum cold Session preparations retained for history-to-resume reuse |
| `writeBatchMaxDelayMs` | `200` | Fixed live-event coalescing window; not a completion deadline |

Source `apiToken` from an environment variable or another `!!js`-evaluated expression at the cordis.yml layer, as shown above — never commit a literal token. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-session-persistence-d1) is the exhaustive source for every accepted field and its JSDoc.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **The coordinator owns every hard problem.** `PersistenceCoordinator` (from `dsh-session-persistence`) supplies revision tracking, write-behind batching, cold-preparation caching, prepare/inspect/borrow orchestration, and crash-repair sequencing generically over any `PersistenceBackend`. This package implements only that smaller interface — `loadStored`/`readStoredRevision`/`appendBatch`/`commitRepair`/`list`/`listSnapshots`, plus the optional seek-capable `loadStoredFrom` and `materializeHeader` — the same relationship `dsh-storage-sqlite` has to `storage-domain`'s `DomainFacility`.
- **One row per event — deliberately simpler than the SQLite backend.** `dsh-session-persistence-sqlite` packs eligible event runs into fewer, zstd-compressed rows to minimize local-disk row count. D1's REST access pattern does not share that incentive (there is no local disk to economize), so this backend stores one physical row per logical event — no chunk-packing, no compression codec. See Known Limitations for the trade-off this simplification accepts.
- **The session id is the event table's own foreign key.** The SQLite backend uses an internal auto-increment integer key to reference a session's events compactly; this backend references events directly by the session's own id string, removing that indirection since D1's row-storage economics do not reward it the same way.
- **No Workers binding required.** `D1Store` calls D1's documented REST query endpoint directly with `fetch`, an account id, a database id, and an API token — the same path Cloudflare documents for "server-side scripts" and "non-Worker integrations".

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `D1SessionPersistence`: thin glue delegating every `SessionPersistence` method to one `PersistenceCoordinator` |
| [`src/store.ts`](src/store.ts) | `D1Store`: the `PersistenceBackend<number>` implementation — physical D1 reads/writes, revision tokens, torn-tail detection and repair |
| [`src/schema.ts`](src/schema.ts) | Physical schema version, schema-ensure sequence, row encode/decode, torn-tail scan |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant: versions and revisions are read-time checks) |

### Torn-tail repair without SQL transactions

D1's REST API has no cross-call transaction concept — each `query`/`batch` call is a single independent HTTP round trip. `appendBatch` and `commitRepair` compensate with a read-then-batch-write sequence: read the current stored tail, validate the incoming batch continues it, then write every statement (event inserts plus the revision bump) as one atomic D1 batch. A malformed or gapped physical row is detected the same way the SQLite backend detects one — scanning stored rows in seq order and treating the first non-contiguous or unparsable row as the torn boundary — just without chunk-packing's added ambiguity about what a "row" represents.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session persistence subsystem](../../../docs/subsystems/persistence.md) — the `PersistenceBackend`/`SessionPersistence` contract this package implements.
- [Session-persistence package map](../README.md) — the family's packages and their repository position.
- [SQLite session persistence](../session-persistence-sqlite/README.md) — the local-first backend this package's schema is a deliberately simplified sibling of.
- [Cloudflare-hosted backend proposal](../../../openspec/changes/cloudflare-hosted-backend/design.md) — the wider architecture this backend is one piece of.

-----

<a id="model-experience"></a>
## Model Experience

### Resumed conversation history

#### What the model sees

Nothing from this package directly. A resumed session's prior turns reach the model exactly as `PersistenceCoordinator` reconstructs them — this backend only supplies the durable bytes.

#### Token effect

Fixed: the resumed history occupies exactly the tokens its events already represent, identical to any other persistence backend.

#### KV Cache effect

None — this backend never touches live request prefixes; it persists between requests, not within one.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when this backend is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **No cross-process write isolation** — unlike the SQLite backend's `begin-immediate` transaction (which takes a real file lock), this backend's read-then-batch-write sequence has no atomicity across the two network calls. Concurrent writers to the *same* session from *different* processes can race; this is accepted because the wider Cloudflare-hosted architecture runs exactly one Host process per Workspace, so genuine cross-process concurrent writers to one session are not expected in normal operation.
- **No busy-wait or retry policy** — a D1 request that fails (network error, rate limit, transient 5xx) rejects immediately instead of retrying.
- **Only the current physical schema version opens** — any other stamped `d1_session_schema_version` is rejected rather than migrated (pre-release stance).
- **No chunk-packing or compression** — one row per event, unlike the SQLite backend's packed, zstd-compressed rows; see Design philosophy for why this trade-off fits D1's access pattern.
- **Per-operation network latency** — every persistence primitive is one or more HTTP round trips to Cloudflare's API; this backend is not a drop-in performance equivalent to the local SQLite/JSONL backends for high-frequency writes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

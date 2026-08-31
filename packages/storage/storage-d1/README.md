---
description: "Cloudflare D1 storage backend for hosts and maintainers choosing, configuring, or debugging document-per-row KV storage reached over D1's REST API."
kind: "package-reference"
---

# @deepseek-ai/dsh-storage-d1

English | [中文](README.zh.md)

## Summary

`dsh-storage-d1` is a storage backend that hosts every routed unit in one Cloudflare D1 database, storing each record as one JSON document per row, registered as backend `d1`. It reaches D1 over Cloudflare's REST query API (`fetch`, an account id, a database id, and an API token) rather than a Workers binding, so it runs from any Node process — a local dev shell, a CI job, or a `dsh` Host running inside a Cloudflare Container. Choose it when a deployment's Workspace or session data must survive independently of any one process or machine; choose the SQLite or JSON backends for a single-machine, local-first deployment. The backend is host-side only: it contributes no prompt, tool, or schema, so the model and the agent loop never see it.

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

Use this package when a composition needs its domain data to durably survive outside any one process: route the relevant domains to this backend and each unit materializes as tables in the configured D1 database.

### When to choose it

Choose it when a deployment's Workspace registry or session data must outlive any single machine or container — a Cloudflare-hosted backend is the primary case. Choose the SQLite backend when the deployment is local-first and one machine owns the data for its whole lifetime; choose the JSON backend when humans inspect or edit the stored data as plain files. Every call is a network round trip to Cloudflare's API, which is slower per-operation than a local database — this backend is not a drop-in performance equivalent to the local backends.

### Configuration

Three required fields: the Cloudflare account id, the D1 database id, and an API token authorized for D1 access.

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

| Field | Default | Meaning |
|---|---|---|
| `accountId` | required | Cloudflare account id owning the D1 database |
| `databaseId` | required | D1 database id (from `wrangler d1 create`'s output, not the human-readable name) |
| `apiToken` | required | Cloudflare API token with D1 Edit permission |

Source `apiToken` from an environment variable or another `!!js`-evaluated expression at the cordis.yml layer, as shown above — never commit a literal token. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-storage-d1) is the exhaustive source for every accepted field and its JSDoc.

### Observable behavior

A unit whose stored format version differs from its descriptor rejects `version-mismatch`, and a database stamped with a physical schema version other than the current one rejects outright — no migration, pre-release stance. A network failure reaching D1, an unparsable D1 response, or a D1-reported query error all surface as plain `Error`s (not `StorageError`s — they are infrastructure failures, not contract violations); the documented `StorageError` codes (`version-mismatch`, `malformed-medium`, `closed`) cover only the specific contract failures the KV backend contract defines.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The backend is a document-per-row layout over Cloudflare D1's REST query API, structurally the same physical layout as the SQLite backend — D1 is SQLite — but reached over HTTP instead of a local connection.

### Design concept

- **Document per row.** Each unit table becomes a physical table `u_<unit>_<table> (key TEXT PRIMARY KEY, value TEXT NOT NULL)` whose `value` column holds the record's JSON text; the global singleton lives in a shared `unit_globals` table. One key update touches exactly one row.
- **No Workers binding required.** `D1Client` calls D1's documented REST query endpoint directly with `fetch`, an account id, a database id, and an API token — the same path Cloudflare documents for "server-side scripts" and "non-Worker integrations". This is why the backend runs from an ordinary Node process instead of requiring a Workers/Durable Object execution context.
- **One statement per call; batches are atomic.** Every write primitive issues one D1 query; multi-statement schema-ensure sequences use D1's batch endpoint, which Cloudflare documents as executing atomically (all statements succeed or all fail together).
- **Names validated before any query.** Unit and table names must match `UNIT_NAME_RE` before they reach a query, so no external input is ever interpolated into SQL identifiers.
- **Versions fail loud.** The physical layout version lives in an explicit single-row `d1_schema_version` table (D1's REST surface has no equivalent of SQLite's local `PRAGMA user_version` convenience); unit format versions live in the `units` table. Any other stamped value rejects — no migrations.
- **Infrastructure failures stay infrastructure failures.** A network error, a non-JSON response, or a D1-reported query failure surface as plain `Error`s with diagnostic messages — not miscast as one of the KV backend contract's specific `StorageError` codes.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: backend registration, `accountId`/`databaseId`/`apiToken` config, unit table |
| [`src/schema.ts`](src/schema.ts) | Schema-ensure sequence, physical layout version, metadata tables; re-exports `recordTableName` from `dsh-d1-client` |
| [`src/unit.ts`](src/unit.ts) | One opened unit: per-call D1 queries, JSON value parse, close |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant: versions are open-time checks) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when this backend's view is not enough: the subsystem reference is the authoritative contract, and the sibling backends show the local-first alternatives.

- [Storage subsystem](../../../docs/subsystems/storage.md) — the backend contract, domain semantics, and generated API.
- [Storage package map](../README.md) — the family's packages and their repository position.
- [SQLite storage backend](../storage-sqlite/README.md) — the local-first medium this backend mirrors physically.
- [Cloudflare-hosted backend proposal](../../../openspec/changes/cloudflare-hosted-backend/design.md) — the wider architecture this backend is one piece of.

-----

<a id="model-experience"></a>
## Model Experience

### Stored domain records

#### What the model sees

Nothing. This backend contributes no prompt, tool, or schema; it persists non-session domain data behind `ctx.storage` for host-side consumers only.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the backend never touches live request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when this backend is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **No busy-wait or retry policy** — a D1 request that fails (network error, rate limit, transient 5xx) rejects immediately instead of retrying; the domain layer's write chain serializes writes within one process, but cross-request retry against Cloudflare's API is out of scope.
- **Only the current physical schema version opens** — any other stamped `d1_schema_version` is rejected rather than migrated (pre-release stance).
- **Per-operation network latency** — every KV primitive is one HTTP round trip to Cloudflare's API; this backend is not a drop-in performance equivalent to the local SQLite/JSON backends for high-frequency writes.
- **No Sessions API usage** — long-running D1 Sessions (for operations exceeding D1's default statement timeout) are not used; every call is a single stateless query or batch.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

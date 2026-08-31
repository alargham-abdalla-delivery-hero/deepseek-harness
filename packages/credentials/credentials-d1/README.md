---
description: "Cloudflare D1 credentials provider for hosts and maintainers choosing, configuring, or debugging durable CredentialRef/CredentialKey storage reached over D1's REST API."
kind: "package-reference"
---

# @deepseek-ai/dsh-credentials-d1

English | [中文](README.zh.md)

## Summary

`dsh-credentials-d1` is a `CredentialProvider` that stores every `CredentialRef` value and `CredentialKey` record in a Cloudflare D1 database, registering as `ctx.credentials`. It reaches D1 over Cloudflare's REST query API (`fetch`, an account id, a database id, and an API token) rather than a Workers binding, so it runs from any Node process — a local dev shell, a CI job, or a `dsh` Host running inside a Cloudflare Container. Unlike `dsh-credentials-local`'s layered file/`.env`/inherited-environment stack, this provider has one durable, writable source: D1 is what `set`, `unset`, and `modifyRecord` write to, and the only other source it reads at all is `process.env`, strictly as a read-only bootstrap fallback below D1 (see [Observable behavior](#use-this-package)). Choose it for a Cloudflare-hosted deployment where the Models Settings UI must durably persist a key independently of any one container's lifetime; choose `dsh-credentials-local` for a local-first, single-machine deployment. The provider is host-side only: it contributes no prompt, tool, or schema, so the model and the agent loop never see it.

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

Use this package when a Cloudflare-hosted deployment needs its credentials to durably survive outside any one container: it replaces `dsh-credentials-local` in the composition and registers the same `ctx.credentials` seam.

### When to choose it

Choose it when a deployment's stored API keys and authorization grants must outlive any single container — a Cloudflare-hosted backend is the primary case. Choose `dsh-credentials-local` when the deployment is local-first and one machine owns the credentials file for its whole lifetime. Every call is a network round trip to Cloudflare's API, which is slower per-operation than a local file read — this provider is not a drop-in performance equivalent to the local provider.

### Configuration

Three required fields: the Cloudflare account id, the D1 database id, and an API token authorized for D1 access.

```yaml
- name: '@deepseek-ai/dsh-credentials-d1'
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

Source `apiToken` from an environment variable or another `!!js`-evaluated expression at the cordis.yml layer, as shown above — never commit a literal token. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-credentials-d1) is the exhaustive source for every accepted field and its JSDoc.

### Observable behavior

`resolve` and `describe` check a stored D1 row first and fall back to a non-empty `process.env[ref]` only when no row exists — D1 ranks *above* `process.env` here, the reverse of `dsh-credentials-local`'s "inherited environment wins" rule, because the roles are reversed too: `process.env` in this deployment is a fixed deploy-time bootstrap (for example the container's forwarded `DEEPSEEK_API_KEY`), not something an operator edits after the container starts, while D1 is the Settings-UI-writable store that must take effect immediately when written. `set`/`unset` never reject for a shadowing reason — nothing ranks above D1, so a write can never be shadowed into apparent no-effect. `modifyRecord` is last-write-wins under concurrent callers rather than serialized (see [Known Limitations](#known-limitations-and-deferred-work)).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **One writable source, so no shadowing logic.** `dsh-credentials-local` layers the inherited environment, its managed file, and two `.env` fallbacks, and must reject a write the environment would shadow. This provider has exactly one writable source (D1); the only other source it reads (`process.env`) ranks *below* D1, so a write is never at risk of being silently overridden by a higher-ranked layer. This is the whole reason the implementation is a fraction of `dsh-credentials-local`'s size: no file lock, no watcher, no layered document format.
- **Two fixed tables, not a KV-unit layout.** `credential_refs (ref TEXT PRIMARY KEY, value TEXT NOT NULL)` and `credential_records (key TEXT PRIMARY KEY, value TEXT NOT NULL)` hold this seam's two disjoint key spaces directly. This provider is not a `ctx.storageDomain` backend, so it does not use `dsh-d1-client`'s `recordTableName`/`u_<unit>_<table>` convention — the same choice `dsh-session-persistence-d1` makes for its own `sessions`/`events` tables.
- **No Workers binding required.** `D1Client` calls D1's documented REST query endpoint directly with `fetch`, an account id, a database id, and an API token — the same path Cloudflare documents for "server-side scripts" and "non-Worker integrations".
- **Read-modify-write without a distributed lock.** `modifyRecord` reads the current record, runs the caller's `mutate`, and writes the result as two independent HTTP round trips — D1's REST API exposes no primitive for a cross-call transaction a stateless REST client could hold across them. See Known Limitations.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `D1CredentialProvider`: every abstract `CredentialProvider` method against `credential_refs`/`credential_records` |
| [`src/schema.ts`](src/schema.ts) | Schema-ensure sequence and physical layout version |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant: the schema-version check is an open-time read) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Credentials subsystem reference](../../../docs/subsystems/credentials.md) — `CredentialRef` and `CredentialKey`, per-operation resolution, UI-safe `CredentialInfo`.
- [Credentials package map](../README.md) — the family's packages and their repository position.
- [Local credentials provider](../credentials-local/README.md) — the local-first provider this package replaces in a Cloudflare-hosted composition.
- [Cloudflare-hosted backend proposal](../../../openspec/changes/cloudflare-hosted-backend/design.md) — the wider architecture this provider is one piece of.

-----

<a id="model-experience"></a>
## Model Experience

### Stored credentials

#### What the model sees

Nothing. This provider contributes no prompt, tool, or schema; it stores secret values behind `ctx.credentials` for host-side consumers only, and the abstract seam it implements never lets a value cross into a model request directly.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the provider never touches live request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when this provider is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **No cross-process serialization for `modifyRecord`** — unlike `dsh-credentials-local`'s cross-process writer lock (a real file lock), this provider's read-then-write sequence has no atomicity across the two network calls. Concurrent `modifyRecord` callers for the *same* key from *different* processes can race, last-write-wins; accepted because the wider Cloudflare-hosted architecture runs exactly one Host process per Workspace, so genuine cross-process concurrent record writers are not expected in normal operation — the same accepted trade-off `dsh-session-persistence-d1` documents for its own read-then-batch-write sequence.
- **No busy-wait or retry policy** — a D1 request that fails (network error, rate limit, transient 5xx) rejects immediately instead of retrying.
- **Only the current physical schema version opens** — any other stamped `d1_credentials_schema_version` is rejected rather than migrated (pre-release stance).
- **Per-operation network latency** — every provider primitive is one or two HTTP round trips to Cloudflare's API; this provider is not a drop-in performance equivalent to `dsh-credentials-local`'s local file reads.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

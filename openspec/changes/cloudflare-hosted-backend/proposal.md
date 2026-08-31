## Why

DeepSeek Harness only runs against a local Node host today (`dsh web`): `apps/web`'s static bundle cannot boot standalone and every Workspace is tied to whichever machine keeps that process alive. There is no way to create a Workspace, run sessions and agent tool calls, and reload it later purely from a browser. This proposal adds Cloudflare as a real, complete backend — Workers for edge routing, Containers for the actual `dsh` Host process (so cloud-hosted tools keep real subprocess/filesystem/lsp capability), and D1 for durable Workspace registry and session history — so `apps/web` can create, run, and reload cloud-hosted Workspaces entirely against a deployed Cloudflare account.

## What Changes

- Add a new, opt-in profile bundle, `@deepseek-ai/dsh-cloudflare-app` (`packages/bundle/cloudflare-app`), following the exact pattern `dsh-web-app` already establishes for `dsh --profile web`: it declares its own `dsh.bundle.patch`, patches over `dsh-base`, and is the single thing a user installs/enables to turn on the entire Cloudflare-hosted backend. It is never mounted by the default `web`, `headless`, `acp`, or `sdk` profiles — selecting `dsh --profile cloudflare` (or `dsh plugin --profile <name> add @deepseek-ai/dsh-cloudflare-app` as an out-of-tree add-on) is the only way this functionality is present at all.
- The bundle composes four plugins, each registering only through `ctx.effect()`/`ctx.on()` per this repo's registration-as-effects rule, so the whole capability is fully unmounted if the bundle is removed:
  - A Cloudflare Worker (`cloudflare/edge-gateway`) that terminates the Client Connection (Typert API Gateway calls plus streaming) at the edge, authenticates the caller, and routes each request to the Durable Object owning its Workspace.
  - A Container-backed Durable Object (`cloudflare/host-container`) per Workspace that starts a Container instance running the built `dsh` Host, giving cloud-hosted Workspaces real subprocess/filesystem/lsp tool capability inside that container's own disk.
  - A `dsh-storage-d1` Service Provider for the existing `ctx.storageDomain` seam, so `@deepseek-ai/dsh-workspace`'s registry (create/rename/reorder/archive) persists in and reloads from Cloudflare D1 without changing the Service Definition or `packages/api/workspace-controller`'s Remote surface.
  - A `dsh-session-persistence-d1` Service Provider mirroring `session-persistence-sqlite`'s schema/versioning discipline, so cloud-hosted session event logs persist in D1 instead of local SQLite/JSONL.
- **New behavior, not a regression of the existing local flow**: a Workspace created against the Cloudflare backend is rooted at its container's own disk, not an arbitrary path on the end user's machine — `dsh-fs`, `dsh-shell`, and `dsh-subprocess` operate inside that disk for cloud-hosted Workspaces. This is a deliberate scope boundary (see design.md Non-Goals), not an oversight.
- Deploy for real to the user's Cloudflare account — Worker, Container image, Durable Object bindings, D1 database — which requires the user's Cloudflare API token/account authorization obtained before any live `wrangler deploy` step (see tasks.md).

## Capabilities

### New Capabilities
- `cloudflare/backend-bundle`: the opt-in `dsh-cloudflare-app` profile bundle itself — how the capability is installed/enabled, and the guarantee that default profiles are unaffected when it is not.
- `cloudflare/edge-gateway`: the Worker entrypoint terminating the Client Connection and authenticating and routing calls to the right Workspace's Durable Object.
- `cloudflare/host-container`: the Container-backed Durable Object running the `dsh` Host process per Workspace — its lifecycle (cold start, sleep, restart), routing, and tool-capability posture.
- `cloudflare/workspace-persistence`: the D1-backed Service Provider for the `ctx.storageDomain` seam backing `@deepseek-ai/dsh-workspace`'s registry.
- `cloudflare/session-persistence`: the D1-backed Service Provider for `packages/session`'s durable session event log.

### Modified Capabilities
(none — the existing Service Definitions for storage-domain, session persistence, and `workspace-controller`'s Remote surface are unchanged; this proposal adds new Providers behind them, and the default profile bundles are untouched)

## Impact

- **New packages** (exact names in design.md, `@deepseek-ai/dsh-<name>` convention): a profile bundle package (`packages/bundle/cloudflare-app`), a combined Cloudflare Worker + Container-hosting Durable Object package (`packages/cloudflare/cloudflare-worker`), a D1-backed storage-domain provider, a D1-backed session-persistence provider, a shared D1 REST client (`packages/util/d1-client`).
- **Dependencies**: `@cloudflare/containers`, `wrangler`, Durable Object and D1 bindings, a Dockerfile packaging the built `dsh` Host for the Container image.
- **Infrastructure**: creates real, billed Cloudflare resources (Worker, Container instance type, Durable Object namespace, D1 database) in the user's account — not free, and not undone by `git revert`.
- **Security**: the edge Worker becomes the first externally reachable surface for this harness; authenticating and authorizing who may create or open which Workspace at the Worker is a hard requirement, detailed in design.md.
- **No changes** to the existing local `dsh web` / local Node host path, the default `web`/`headless`/`acp`/`sdk` profile bundles, `packages/api/workspace-controller`'s Remote method signatures, or `packages/session`'s existing SQLite/JSONL providers — Cloudflare is an additional, separately-installed profile bundle, not a replacement or a modification of any existing one.

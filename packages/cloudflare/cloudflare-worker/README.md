---
description: "Cloudflare edge-gateway Worker and Container-backed Durable Object for operators deploying, configuring, and debugging the Cloudflare-hosted dsh backend."
kind: "package-reference"
---

# @deepseek-ai/dsh-cloudflare-worker

English | [中文](README.zh.md)

## Summary

`dsh-cloudflare-worker` is the deployable Cloudflare Worker for the `dsh-cloudflare-app` hosted backend: `src/gateway.ts` is the Worker entrypoint that authenticates each Client Connection request and routes it to `src/host-container.ts`'s `HostContainer`, a Durable Object extending `@cloudflare/containers`' `Container` that starts a Cloudflare Container running the built `dsh` Host for one Workspace. It never boots through Cordis and carries no `dsh --profile` row of its own — it deploys independently via `wrangler deploy` (`wrangler.jsonc` in this directory), while the Cordis-side halves of the Cloudflare backend (`dsh-storage-d1`, `dsh-session-persistence-d1`) mount only inside the Container this Worker starts. Choose this package's deployment when `apps/web` needs to reach a cloud-hosted Workspace instead of a local `dsh web` process; it contributes nothing to any model prompt or tool.

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

Deploy this package's Worker (`wrangler deploy` from this directory) alongside the `dsh-cloudflare-app` profile bundle it starts a Container running. `wrangler dev` runs it locally against Cloudflare's Workers/Containers emulation.

### When to choose it

Choose it as the entrypoint for a deployed Cloudflare-hosted backend (see the [Cloudflare-hosted backend proposal](../../../openspec/changes/cloudflare-hosted-backend/design.md)). It is not a library — nothing imports `@deepseek-ai/dsh-cloudflare-worker` as `.`; its only importable surface is `./invariant`, present so this package participates in the workspace's package-invariant gate like every sibling package.

### Configuration

`wrangler.jsonc` declares the Container image (`../../../Dockerfile.cloudflare`), the `HOST_CONTAINER` Durable Object binding and its `new_sqlite_classes` migration, and the `DEFAULT_WORKSPACE_ID` var used when a request carries no explicit `/w/<id>/` prefix (today's browser client always takes this path — see Known Limitations). `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, and `CLOUDFLARE_D1_API_TOKEN` are deployment secrets (`wrangler secret put`), never committed to `wrangler.jsonc`; the gateway reads them to check Workspace existence against D1 and the Durable Object forwards them into the Container's own environment for `dsh-storage-d1`/`dsh-session-persistence-d1` to use.

### Observable behavior

The gateway rejects a request with no `Cf-Access-Jwt-Assertion` header (`401`) before touching any Durable Object — Cloudflare Access itself, in front of this Worker, is the real authentication; this header check is defense in depth. It then resolves the target Workspace: an explicit `/w/<id>/` path is checked against the D1-backed registry over `dsh-d1-client`'s REST path (no D1 binding) before any container is started or woken — a nonexistent id returns `404`, a D1-level failure returns `502`. The `DEFAULT_WORKSPACE_ID` fallback (today's only client-driven path) skips this check entirely — it names this deployment's one Container slot, not a specific Workspace record to verify (see Known Limitations). A resolved target routes to its `HostContainer` via `getContainer(env.HOST_CONTAINER, workspaceId)` — deterministic Durable Object naming gives every request for the same target session affinity by construction. The Durable Object's own `fetch` starts or wakes its Container (`sleepAfter = '30m'` idle-stop) and reports a distinct `202 {status: "starting"}` while the container's port is not answering yet, or `502 {status: "failed", reason}` when the container did not come up at all.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

- **One package, two roles, one deployable.** The edge-gateway Worker and the Container-backed Durable Object compile, version, and deploy together as a single `wrangler.jsonc` unit — neither side has an independent consumer or release cycle, so a package split would add cross-package import overhead without protecting a real seam (see design.md's package-placement decision).
- **D1 over REST, not a binding.** Both the gateway's existence check and the Container's own `dsh-storage-d1`/`dsh-session-persistence-d1` reach D1 over `dsh-d1-client`'s REST query API with the same three credentials, consistent with the rest of the Cloudflare-hosted backend — no `d1_databases` binding in `wrangler.jsonc`.
- **Existence, not per-user ownership.** This deployment targets a single principal (Cloudflare Access already restricts the whole Worker); `dsh-workspace`'s `WorkspaceRecord` carries no owner field. The gateway's authorization step is therefore "does this Workspace id resolve to a registry record", not an identity comparison — see design.md's revised Auth decision.
- **Pass-through Container proxying.** `HostContainer.fetch()` starts the container then delegates to `@cloudflare/containers`' own `Container.fetch()`, which proxies the raw request — including any WebSocket upgrade — straight to the container's HTTP port. No `follow()` or WebSocket-routing state is cached at the Durable Object layer; it all lives inside the `dsh` Host process itself, exactly as it does locally.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Wrangler entrypoint: the Worker's default export plus the `HostContainer` re-export `wrangler.jsonc`'s Durable Object binding names |
| [`src/gateway.ts`](src/gateway.ts) | Edge Worker: authentication, Workspace resolution and existence check, routing |
| [`src/host-container.ts`](src/host-container.ts) | `HostContainer` Durable Object: container start/wake, starting/failed status classification |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant: this package never boots through Cordis) |
| [`wrangler.jsonc`](wrangler.jsonc) | Container image, Durable Object binding and migration, non-secret vars |
| [`tsconfig.json`](tsconfig.json) | Compiles `src`/`tests` under `@cloudflare/workers-types`; `wrangler`'s own bundler reads `src/index.ts` directly, never `lib/` |
| [`tsconfig.invariant.json`](tsconfig.invariant.json) | Isolated sub-project compiling only `src/invariant.ts` under this repo's ordinary Node-flavored `tsconfig.base.json` — referenced from the root `tsconfig.host.json` so `pnpm run build` still produces `lib/invariant.js`, the one artifact every package publishes (see `deployOnlyWorkerPackages` in `scripts/check-workspace-constraints.ts`) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Cloudflare backend group map](../README.md) — this package's position alongside the D1-backed storage/session-persistence providers it starts.
- [`dsh-cloudflare-app` bundle](../../bundle/cloudflare-app/README.md) — the `dsh --profile cloudflare` composition this package's Container image boots.
- [Cloudflare-hosted backend proposal](../../../openspec/changes/cloudflare-hosted-backend/design.md) — the wider architecture, including the beta-API risk this package inherits from `@cloudflare/containers`.
- [`cloudflare/edge-gateway` and `cloudflare/host-container` specs](../../../openspec/changes/cloudflare-hosted-backend/specs/cloudflare/) — the observable-behavior requirements this package implements.

-----

<a id="model-experience"></a>
## Model Experience

### Edge routing and Container lifecycle

#### What the model sees

Nothing. This package is a deployment-only Worker/Durable-Object pair — `handleRequest` and `HostContainer` run entirely at the edge and inside the Container's own host process; it contributes no prompt, tool, or schema, and never runs inside an agent loop.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — this package never touches a live request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when this package is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Single-principal deployment only** — the Workspace-existence check is not a per-user ownership check; every Workspace behind one deployment is reachable by any caller Cloudflare Access admits. Real per-Workspace, per-user ownership needs an owner field on `WorkspaceRecord` that does not exist today, deferred to a later multi-tenant proposal (design.md Non-Goals).
- **No `/w/<id>/` client support yet** — `resolveWorkspaceId` accepts an explicit path prefix, but today's `apps/web` client never sends one; every deployment today is effectively single-Workspace, routed via `DEFAULT_WORKSPACE_ID`.
- **No cold-start/container-failure test coverage** — `tests/gateway.spec.ts` runs the gateway against `@cloudflare/vitest-pool-workers` for real (reject-unauthenticated, reject-nonexistent-workspace, D1-failure-surfaces-502, session affinity by Durable Object id), but constructing `HostContainer` under this tool throws `Containers have not been enabled for this Durable Object class` — a confirmed, currently-open upstream bug ([cloudflare/workers-sdk#10408](https://github.com/cloudflare/workers-sdk/issues/10408)), independent of Docker availability. Verify `HostContainer`'s starting/failed classification against a real `wrangler dev` or deployment instead.
- **The Container image cannot be built on every host** — both `wrangler dev` and `wrangler deploy` build the Container image locally before running or pushing it. On a host whose Docker daemon hits `node: ../deps/uv/src/unix/linux.c:1430: uv__io_poll: Assertion 'errno == EEXIST' failed. Aborted (core dumped)` partway through the image's own `pnpm install` (observed reproducibly, 3/3 attempts, on a Colima VZ-backend VM even with ample memory), the build fails deterministically — a libuv/kernel interaction in that specific virtualization stack, not a defect in this Dockerfile or a memory ceiling (the earlier, resolved memory finding is separate — see the Agent Note). Investigated and ruled out on this host: the memory ceiling (resolved separately, did not fix this crash), the container's own Node version (identical crash on Node 22 and Node 24 base images — not a libuv version bug), and Colima's QEMU backend (blocked one layer deeper — Homebrew's `qemu` bottle, even rebuilt from source with the default formula, ships without HVF hardware-acceleration support compiled in at all, `Accelerators supported in QEMU binary: tcg` only; a genuine fix would need a manual QEMU build against upstream source with explicit `--enable-hvf`, outside Homebrew's formula, with no guarantee it addresses the original crash). The Worker half of a deployment can still succeed and go live independently of the Container half failing. Build from a host without this interaction (a different machine, a CI runner) rather than continuing to chase it in this specific environment.
- **`DEFAULT_WORKSPACE_ID` is a routing slot, not a Workspace id** — `@deepseek-ai/dsh-workspace` assigns every real Workspace a random `randomUUID()` id, so a literal configured value (e.g. `"default"`) never equals one. The gateway only existence-checks an *explicit* `/w/<id>/` request; the `DEFAULT_WORKSPACE_ID` fallback skips the D1 check entirely and always routes to this deployment's one Container, letting a fresh deployment create its first Workspace without a bootstrap deadlock.
- **`@cloudflare/containers` is beta** — no SLA, and its API can change without notice; treat this package's Container-orchestration code as the piece most likely to need follow-up changes when that package updates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

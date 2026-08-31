---
description: "The Cloudflare-hosted profile bundle for hosts and maintainers deploying, configuring, or debugging the dsh Host inside a Cloudflare Container."
kind: "package-bundle"
---

# @deepseek-ai/dsh-cloudflare-app

English | [中文](README.zh.md)

## Summary

Run `dsh --profile cloudflare` and the exact same browser UI, workspace management, and chat experience `dsh --profile web` serves locally comes up bound to Cloudflare D1 instead of the local filesystem. This bundle patches `dsh-web-app` (profile layer order: `dsh-base` → `dsh-web-app` → `dsh-cloudflare-app`) rather than duplicating it: it disables the local `storage-json`/`session-persistence-jsonl`/`credentials-local` backends, routes `ctx.storageDomain` at `@deepseek-ai/dsh-storage-d1`, mounts `@deepseek-ai/dsh-session-persistence-d1` and `@deepseek-ai/dsh-credentials-d1`, binds the webserver to every interface and trusts this deployment's own public hostname, disables the local browser-launch handoff and the browser-session launch-token gate (Cloudflare Access authenticates every caller instead), unlocks the Models Settings UI for this non-loopback origin on the same trust argument, and composes an `anthropic` model route (Claude Haiku 4.5) as the default so a fresh deployment has a working model before anyone touches Settings — every other row (the chat UI, workspace/session/settings controllers, directory picker) is untouched. Choose this profile when packaging the `dsh` Host into a Docker image for a Cloudflare Container; choose `web` for ordinary local use. This bundle contributes no prompt, tool, or schema of its own — every model-facing surface belongs to the rows it patches, not to this package.

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

### Starting the profile

```sh
dsh --profile cloudflare --port 8080 --no-open
```

The flags are `dsh-web-app`'s own — this bundle adds no new ones, and deliberately passes no `--host`: `dsh-host-webserver`'s `Config.host` schema is a closed `'127.0.0.1' | '0.0.0.0'` union, and `dsh-web-app`'s own CLI rejects the literal `--host 0.0.0.0` outright as a local-machine safety guard. This bundle's `cordis.patch.yml` sets the webserver row's `host` directly to `0.0.0.0`, bypassing that flag path (and its guard) rather than weakening it for the shared `dsh-web-app` surface — confirmed against a real deployment: `127.0.0.1` is not reachable from Cloudflare's own container port health check, which connects on this instance's actual assigned address, not loopback. `/Dockerfile.cloudflare` at the repository root bakes exactly this invocation into its `CMD`.

### Required environment

| Variable | Meaning |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id owning the D1 database |
| `CLOUDFLARE_D1_DATABASE_ID` | D1 database id (from `wrangler d1 create`'s output) |
| `CLOUDFLARE_D1_API_TOKEN` | Cloudflare API token with D1 Edit permission |
| `CLOUDFLARE_WORKER_HOSTNAME` | This deployment's own public hostname; feeds the Host/Origin trust fence, which otherwise refuses every request whose `Host` is neither loopback nor an explicitly configured authority |

Missing any of the three `CLOUDFLARE_*` variables above fails the boot loud and immediately (`cloudflare-app-startup`), before the D1 backends ever attempt a REST call — see Observable behavior. Two further variables are optional, forwarded by the Durable Object into the container's environment only when set (`wrangler secret put <NAME>`): `DEEPSEEK_API_KEY` and `ANTHROPIC_API_KEY`. Neither is required to boot — a Workspace with no key configured still creates and persists Sessions, only failing the specific turn that calls a model without one — but the composed `anthropic` route needs `ANTHROPIC_API_KEY` for the default model (Claude Haiku 4.5) to actually answer.

### Building the container image

```sh
pnpm run build   # apps/cli/lib, apps/web/dist, and every workspace package
docker build -f Dockerfile.cloudflare -t dsh-cloudflare-host .
```

The `Dockerfile` lives at the repository root, not under this package: Cloudflare Containers' build model requires the Dockerfile's own directory to be the build context (there is no separate "context" setting), and this image needs the whole repository as context (`COPY packages`, `COPY apps/cli/lib`, …) — a path this package's own directory cannot provide. `packages/cloudflare/cloudflare-worker`'s `wrangler.jsonc` (the Worker + Durable Object that runs this image as a Cloudflare Container) references it as `../../../Dockerfile.cloudflare`, resolving to the same file.

The image packages the already-built `dsh` Host — the identical code path `dsh --profile web` runs locally, not a second implementation — plus a freshly-installed `node_modules` closure (not copied from the host: a pnpm workspace's `node_modules` is a tree of symlinks keyed by absolute host paths, which do not survive copying into another filesystem). See Known Limitations for the image's current packaging scope.

### Observable behavior

`cloudflare-app-startup` throws immediately, before mounting any other cloudflare-app row, when a required environment variable is absent or empty. Past that check, `dsh-storage-d1`/`dsh-session-persistence-d1` surface their own `StorageError`/plain-`Error` failures for D1-specific problems (schema mismatch, network failure, D1 API rejection) exactly as documented in their own READMEs.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Patch on top, never fork.** The alternative — a standalone tree duplicating `dsh-web-app`'s ~80 rows with Cloudflare backends substituted in — would drift the moment either side changed. Patching preserves one source of truth for the browser UI/session/workspace stack; this bundle's patch is small precisely because it touches only what is genuinely Cloudflare-specific.
- **Reuses `dsh-web-app`'s own CLI parsing.** Host/port/`--no-open`/`--trusted-host` all come from `dsh-web-app`'s `web-startup` row, already part of the composed profile (it is a layer, not a dependency this bundle reimplements). This bundle adds no command-line surface of its own.
- **Fails loud before the network, not after.** `cloudflare-app-startup` is a plain environment check with no Cloudflare call of its own — it exists so a missing credential produces one clear error at boot instead of a cryptic D1 REST failure the first time a session or workspace touches storage.
- **The profile name is registered where every shipped profile is.** `packages/boot/app-boot/src/profile.ts`'s `PROFILE_TEMPLATES` gained one entry (`cloudflare: { bundles: [dsh-base, dsh-web-app, dsh-cloudflare-app] }`) — the same mechanism that defines `web`/`headless`/`acp`/`sdk`, not a parallel resolution path.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The whole Cloudflare-specific patch: disables local backends, routes `storage-domain` at `d1`, inserts `storage-d1`/`session-persistence-d1`/`credentials-d1`/the startup guard, binds the webserver to every interface and trusts this deployment's own hostname, disables the local browser handoff and the browser-session launch-token gate, unlocks the Models Settings UI (`trustedAsHost`), and composes the default `anthropic` model route |
| [`src/index.ts`](src/index.ts) | `cloudflare-app-startup`: the required-environment-variable check |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant: the environment check is a one-time boot-time assertion) |
| [`/Dockerfile.cloudflare`](../../../Dockerfile.cloudflare) | Packages the built `dsh` Host and boots this profile as the container entrypoint (lives at the repository root — see Building the container image for why) |
| [`/docker-entrypoint.cloudflare.sh`](../../../docker-entrypoint.cloudflare.sh) | The container's actual `CMD`: no `--host` flag, since this bundle's config patch sets it directly |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-web-app` README](../web-app/README.md) — the bundle this one patches; every row not listed in this package's `cordis.patch.yml` behaves exactly as documented there.
- [Profile plugin bundles note](../../../.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.md) — the profile/bundle composition mechanism this package participates in.
- [`dsh-storage-d1` README](../../storage/storage-d1/README.md), [`dsh-session-persistence-d1` README](../../session/session-persistence-d1/README.md), and [`dsh-credentials-d1` README](../../credentials/credentials-d1/README.md) — the three D1-backed providers this bundle mounts.
- [Cloudflare-hosted backend proposal](../../../openspec/changes/cloudflare-hosted-backend/design.md) — the wider architecture (edge Worker, Container-backed Durable Object) this bundle's image is deployed into.
- [Agent Note: Cloudflare-hosted backend](../../../.agents/notes/implemented/architecture/2026-08-31-cloudflare-hosted-backend.md) — the decisions this bundle's patch encodes, including several found only by deploying for real.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package only patches configuration rows and checks environment variables; every model-facing prompt, tool, and schema belongs to the rows it patches (`dsh-web-app` and its own dependency tree), not to this bundle.

#### KV Cache effect

None — this package registers no request-time behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Container image packaging is not yet production-pruned** — the image does a full `pnpm install --frozen-lockfile` (every workspace member, dev and runtime dependencies alike — this repo's peerDependency-via-devDependency convention means a `--prod`-only install silently drops packages several runtime imports need) rather than a production-only pruned install (for example via `pnpm deploy`); the image works but is far larger than necessary. Pruning is deferred.
- **`--help` text says "dsh --profile web"** — inherited verbatim from `dsh-web-app`'s own `Command().name()` call, since this bundle deliberately reuses that CLI parsing rather than reimplementing it; cosmetic only, every flag behaves identically under `--profile cloudflare`.
- **`$DSH_HOME` lives on the container's own ephemeral disk** — `/Dockerfile.cloudflare` sets `DSH_HOME=/app/.dsh-home` so profile-resolution bookkeeping has a writable location, but nothing under it is durable across a container restart; only D1-backed state (via `dsh-storage-d1`/`dsh-session-persistence-d1`/`dsh-credentials-d1`) survives.
- **Local `docker build` on Apple Silicon dev hosts crashes deterministically** (`uv__io_poll: errno == EEXIST`, a libuv/Colima-VZ interaction) regardless of Colima VM backend or memory — worked around via a GitHub Actions CI deploy (`.github/workflows/deploy-cloudflare-worker.yml`, a GitHub-hosted Linux runner has no such VM layer), not fixed locally. Building this image on Apple Silicon remains unverified; the CI path is the only one confirmed to work.
- **No Miniflare Container test coverage** (`cloudflare/workers-sdk#10408`, an upstream bug) — `packages/cloudflare/cloudflare-worker`'s own integration tests run everything up to the point the Container would actually start; this deployment's live behavior beyond that boundary is verified only by the real, deployed instance, not by CI.
- **`wrangler deploy` needs `--containers-rollout=immediate`** — the default gradual rollout leaves a recently-connected Container instance on its old image until it passes a grace period; a single-Workspace deployment has no multi-instance population to stage a gradual rollout across, so `.github/workflows/deploy-cloudflare-worker.yml` always passes this flag. Omitting it on a manual `wrangler deploy` will silently serve stale code to live traffic.
- **The composed default model (`anthropic`/Claude Haiku 4.5) requires a workspace-scoped `ANTHROPIC_API_KEY`** — an identity-linked (organization-issued, not workspace-scoped) key fails every request with `anthropic-workspace-id is required`, since `llm-pi-ai`'s adapter does not send that header. Create the key with an explicit workspace scope in the Anthropic Console, or add the header via the route's `headers` config field if a workspace-scoped key is not obtainable.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

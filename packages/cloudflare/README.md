---
description: "The Cloudflare-hosted backend group map: the edge Worker and Container-backed Durable Object that route a browser client to a per-Workspace dsh Host, for users and maintainers of the Cloudflare-hosted deployment."
kind: "package-group"
---

# packages/cloudflare

English | [中文](README.zh.md)

## Summary

The cloudflare group holds the deployable Cloudflare Worker for `dsh-cloudflare-app`'s hosted backend (see [`packages/bundle/cloudflare-app`](../bundle/cloudflare-app/README.md)): one Worker entrypoint authenticates each Client Connection request and routes it to the Container-backed Durable Object owning the named Workspace, which starts a Cloudflare Container running the same built `dsh` Host the local path already tests. It never boots through Cordis and carries no `dsh --profile` row of its own — it deploys independently via `wrangler deploy`, while the Cordis-side halves of the Cloudflare backend (the D1 storage and session-persistence providers) live in [`packages/storage/storage-d1`](../storage/storage-d1/README.md) and [`packages/session/session-persistence-d1`](../session/session-persistence-d1/README.md) and mount only inside the container this Worker starts.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`cloudflare-worker`](cloudflare-worker/README.md) | Edge-gateway Worker + Container-backed Durable Object, one Container per Workspace |

-----

<a id="related-documentation"></a>
## Related documentation

- [`packages/bundle/cloudflare-app`](../bundle/cloudflare-app/README.md) — the opt-in `dsh --profile cloudflare` bundle this Worker's Container image boots.
- [`packages/storage/storage-d1`](../storage/storage-d1/README.md) — the D1-backed `ctx.storageDomain` provider running inside the Container.
- [`packages/session/session-persistence-d1`](../session/session-persistence-d1/README.md) — the D1-backed session-persistence provider running inside the Container.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

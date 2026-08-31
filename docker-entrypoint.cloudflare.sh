#!/bin/sh
# Cloudflare Containers assigns each instance a private, non-routable IP
# reachable only through Cloudflare's own internal proxy (Dockerfile.cloudflare's
# "network": {"mode": "private", "assign_ipv4": "none"} — no public IPv4/IPv6,
# and no interface Node's os.networkInterfaces() can enumerate either: this
# runtime does not assign the container a conventional interface at all).
# 127.0.0.1 is unreachable from outside this process's own network namespace
# here — confirmed live: "Failed to verify port 8080 ... The container is not
# listening in the TCP address 10.0.0.1:8080" while bound to 127.0.0.1.
# `10.0.0.1` is the address Cloudflare's own container port-health-check
# connects to — confirmed identical across every distinct container instance
# observed (a fixed guest-side address for this network mode, not one that
# varies per instance). dsh-web-app's CLI intentionally rejects the literal
# `--host 0.0.0.0` (packages/bundle/web-app/src/startup.ts) as a local-machine
# safety guard; it does not reject this specific, non-loopback address.
exec node apps/cli/lib/bin.js --profile cloudflare --host 10.0.0.1 --port 8080 --no-open

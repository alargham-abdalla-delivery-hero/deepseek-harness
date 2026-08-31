#!/bin/sh
# Cloudflare Containers assigns each instance a private, non-routable IP
# reachable only through Cloudflare's own internal proxy (Dockerfile.cloudflare's
# "network": {"mode": "private"} — no public IPv4/IPv6). Cloudflare's own
# container port-health-check connects to that address, not 127.0.0.1 (which is
# unreachable from outside this process's own network namespace in this
# runtime — confirmed live: "Failed to verify port 8080 ... The container is
# not listening in the TCP address 10.0.0.1:8080" while bound to 127.0.0.1).
# dsh-web-app's CLI intentionally rejects the literal `--host 0.0.0.0`
# (packages/bundle/web-app/src/startup.ts) as a local-machine safety guard; it
# does not reject binding to this container's own actual address, discovered
# here at boot since it is assigned per-instance, not fixed.
HOST=$(node -e "
const { networkInterfaces } = require('node:os')
const nets = networkInterfaces()
let ip = '127.0.0.1'
outer: for (const name in nets) {
  for (const net of nets[name] ?? []) {
    if (net.family === 'IPv4' && !net.internal) { ip = net.address; break outer }
  }
}
console.log(ip)
")
exec node apps/cli/lib/bin.js --profile cloudflare --host "$HOST" --port 8080 --no-open

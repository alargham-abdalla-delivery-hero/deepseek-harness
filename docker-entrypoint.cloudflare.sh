#!/bin/sh
# The webserver's bind host is fixed to 0.0.0.0 by dsh-cloudflare-app's own
# config patch (packages/bundle/cloudflare-app/cordis.patch.yml), not by a
# --host flag here — dsh-web-app's CLI rejects --host 0.0.0.0 as a
# local-machine safety guard that does not apply inside this network-isolated
# Container. No host flag is passed on this line for that reason.
exec node apps/cli/lib/bin.js --profile cloudflare --port 8080 --no-open

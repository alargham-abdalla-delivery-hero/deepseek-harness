/**
 * Startup guard for the `cloudflare` profile: fails loud at boot when a
 * required Cloudflare credential is missing, instead of surfacing later as an
 * opaque D1 REST failure on the first storage, session-persistence, or
 * credentials call.
 * @module @deepseek-ai/dsh-cloudflare-app
 */

import type { Context } from '@deepseek-ai/cordis'

/** Stable Cordis plugin name. */
export const name = 'cloudflare-app-startup'

/** Environment variables the `cloudflare` profile's D1 backends require. */
const REQUIRED_ENV_VARS = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_D1_API_TOKEN'] as const

/**
 * Validate every required Cloudflare credential is present in the process
 * environment before the D1 storage/session-persistence/credentials backends
 * mount.
 * @param _ctx - plugin context (unused; the check is a pure environment read).
 * @throws when a required environment variable is missing or empty.
 */
export function apply(_ctx: Context): void {
  for (const key of REQUIRED_ENV_VARS) {
    const value = process.env[key]
    if (value === undefined || value === '') {
      throw new Error(`dsh --profile cloudflare requires the ${key} environment variable to be set`)
    }
  }
}

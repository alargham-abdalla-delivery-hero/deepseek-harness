import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as CloudflareAppStartup from '../src/index.ts'

const REQUIRED_ENV_VARS = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_D1_API_TOKEN'] as const

const originalEnv: Record<string, string | undefined> = {}
for (const key of REQUIRED_ENV_VARS) originalEnv[key] = process.env[key]

afterEach(() => {
  for (const key of REQUIRED_ENV_VARS) {
    if (originalEnv[key] === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = originalEnv[key]
  }
})

describe('cloudflare-app-startup', () => {
  it('boots cleanly when every required environment variable is set', async () => {
    for (const key of REQUIRED_ENV_VARS) process.env[key] = 'value'
    const ctx = new Context()
    await ctx.plugin(CloudflareAppStartup).await()
    await ctx.fiber.dispose()
  })

  it.for(REQUIRED_ENV_VARS)('rejects when %s is missing', async (missing) => {
    for (const key of REQUIRED_ENV_VARS) {
      if (key === missing) Reflect.deleteProperty(process.env, key)
      else process.env[key] = 'value'
    }
    const ctx = new Context()
    await expect(ctx.plugin(CloudflareAppStartup).await()).rejects.toThrow(
      new RegExp(`requires the ${missing} environment variable to be set`),
    )
    await ctx.fiber.dispose()
  })

  it('rejects when a required environment variable is set to an empty string', async () => {
    for (const key of REQUIRED_ENV_VARS) process.env[key] = 'value'
    process.env['CLOUDFLARE_ACCOUNT_ID'] = ''
    const ctx = new Context()
    await expect(ctx.plugin(CloudflareAppStartup).await()).rejects.toThrow(
      /requires the CLOUDFLARE_ACCOUNT_ID environment variable to be set/,
    )
    await ctx.fiber.dispose()
  })
})

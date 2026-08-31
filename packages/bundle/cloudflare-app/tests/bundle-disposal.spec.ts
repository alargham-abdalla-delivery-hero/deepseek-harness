import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import SessionStore from '@deepseek-ai/dsh-session'
import * as StorageD1 from '@deepseek-ai/dsh-storage-d1'
import SessionPersistenceD1 from '@deepseek-ai/dsh-session-persistence-d1'
import * as CloudflareAppStartup from '../src/index.ts'

const REQUIRED_ENV_VARS = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_D1_API_TOKEN'] as const
const D1_CONFIG = { accountId: 'acc', databaseId: 'db', apiToken: 'token' }

const originalEnv: Record<string, string | undefined> = {}
for (const key of REQUIRED_ENV_VARS) originalEnv[key] = process.env[key]

afterEach(() => {
  for (const key of REQUIRED_ENV_VARS) {
    if (originalEnv[key] === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = originalEnv[key]
  }
})

describe('dsh-cloudflare-app bundle removal', () => {
  it('mounts storage-d1, session-persistence-d1, and the startup guard as one unit, and disposing all three leaves no residual registration behind', async () => {
    for (const key of REQUIRED_ENV_VARS) process.env[key] = 'value'

    const ctx = new Context()
    await ctx.plugin(Storage)
    await ctx.plugin(SessionStore)

    const storageFiber = await ctx.plugin(StorageD1, D1_CONFIG)
    const sessionFiber = await ctx.plugin(SessionPersistenceD1, D1_CONFIG)
    const startupFiber = await ctx.plugin(CloudflareAppStartup)
    await Promise.all([storageFiber.await(), sessionFiber.await(), startupFiber.await()])

    // Present while the bundle is mounted.
    expect(ctx.storage.backend.get('d1')).toBeDefined()
    expect(ctx.get(storageBackendServiceKey('d1'))).toBeDefined()
    expect(ctx.get('sessionPersistence')).toBeDefined()

    // Removing the bundle disposes all three plugins it mounts, together.
    await Promise.all([storageFiber.dispose(), sessionFiber.dispose(), startupFiber.dispose()])

    expect(ctx.storage.backend.names()).toEqual([])
    expect(ctx.get(storageBackendServiceKey('d1'))).toBeUndefined()
    expect(ctx.get('sessionPersistence')).toBeUndefined()

    // The hubs the bundle plugged into (dsh-base/dsh-web-app's own services)
    // are unaffected — removing the bundle does not tear down the profile.
    expect(ctx.storage).toBeDefined()
    expect(ctx.sessions).toBeDefined()

    await ctx.fiber.dispose()
  })
})

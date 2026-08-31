/**
 * Host-side `trustedAsHost` config: whether apply() answers an index-inject
 * collection with the boot-time global that unlocks Host-persistable client
 * behavior for a non-loopback deployment (see src/index.ts's Config JSDoc for
 * the trust argument).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { IndexInjection, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply } from '../src/index.ts'
import { TRUSTED_AS_HOST_GLOBAL } from '../src/trusted-as-host.ts'
import { provideBrowserCredentials } from './browser-credentials.ts'

/** Structural webServer fake; only `register` is exercised by apply(). */
function fakeWebServer(): WebServer {
  return { register: () => () => {} } as unknown as WebServer
}

/** Collect the injection table the way an index render or boot payload does. */
function collect(ctx: Context): IndexInjection[] {
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table)
  return table
}

async function mount(config?: { trustedAsHost?: boolean }): Promise<Context> {
  const ctx = new Context()
  provideBrowserCredentials(ctx)
  ctx.provide('webServer', fakeWebServer())
  await ctx.plugin({ apply }, config).await()
  return ctx
}

describe('trustedAsHost boot injection', () => {
  it('answers no boot-global row when trustedAsHost is left at its default', async () => {
    const ctx = await mount()
    expect(collect(ctx)).toEqual([])
  })

  it('answers no boot-global row when trustedAsHost is explicitly false', async () => {
    const ctx = await mount({ trustedAsHost: false })
    expect(collect(ctx)).toEqual([])
  })

  it('answers the boot-global row only when trustedAsHost is true', async () => {
    const ctx = await mount({ trustedAsHost: true })
    expect(collect(ctx)).toEqual([{ kind: 'global', name: TRUSTED_AS_HOST_GLOBAL, value: true }])
  })
})

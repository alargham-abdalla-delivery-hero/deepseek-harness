/**
 * Cross-package check: `@deepseek-ai/dsh-workspace`'s real domain spec round-trips
 * through this backend with zero code changes, proving the D1 backend is a
 * drop-in `ctx.storageDomain` provider — the exact seam `dsh-workspace` and
 * `packages/api/workspace-controller` depend on.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { workspaceDomainSpec } from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId, WorkspaceRecord } from '@deepseek-ai/dsh-workspace'
import * as StorageD1 from '../src/index.ts'
import { FakeD1Server } from './fake-d1-server.ts'

describe('dsh-workspace domain spec over the d1 backend', () => {
  it('opens the real workspace domain spec and round-trips a record with no code changes to either package', async () => {
    const server = new FakeD1Server()
    try {
      const ctx = new Context()
      // The plugin's apply() reads global fetch at construction time (it
      // kicks off the schema-ensure call immediately), so the stub must be in
      // place before StorageD1 mounts.
      const originalFetch = globalThis.fetch
      globalThis.fetch = server.client as typeof fetch
      try {
        await ctx.plugin(Storage)
        await ctx.plugin(StorageD1, { accountId: 'acc', databaseId: 'db', apiToken: 'token' })
        await ctx.plugin(StorageDomain, { backend: 'd1' })
        const domain = await ctx.storageDomain.open(workspaceDomainSpec)
        const table = domain.table('workspaces')
        const id = 'ws_1' as WorkspaceId
        const record: WorkspaceRecord = {
          path: '/tmp/my-workspace',
          title: 'My Workspace',
          sessionIds: [],
          createdAt: '2026-08-30T00:00:00.000Z',
          updatedAt: '2026-08-30T00:00:00.000Z',
        }
        await table.put(id, record)
        expect(table.get(id)).toEqual(record)

        // Reload through a second domain open, simulating a process restart.
        await domain.close()
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      server.close()
    }
  })
})

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyClient, inject, name } from '../src/client/index.ts'
import { RenderUiView } from '../src/client/RenderUiView.tsx'

describe('ui-openui client registration', () => {
  it('registers RenderUiView under the render_ui keyed toolview slot', () => {
    const registered: { key: string; component: unknown }[] = []
    const ctx = {
      slots: {
        inject: (_name: string, callback: () => unknown) => {
          callback()
          return () => undefined
        },
        register: (options: { name: string; key: string }, component: unknown) => {
          registered.push({ key: options.key, component })
          return () => {}
        },
      },
    } as unknown as Context
    applyClient(ctx)
    expect(registered).toEqual([{ key: 'render_ui', component: RenderUiView }])
    expect(inject).toEqual(['slots'])
    expect(name).toBe('ui-openui')
  })
})

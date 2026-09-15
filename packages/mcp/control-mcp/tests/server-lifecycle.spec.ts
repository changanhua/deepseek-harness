import { Context } from '@deepseek-ai/cordis'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/server.ts'
import { startManagedDshHost } from '../src/lifecycle.ts'

vi.mock('../src/lifecycle.ts', () => ({ startManagedDshHost: vi.fn() }))

describe('managed Host shutdown ownership', () => {
  it('waits for Host shutdown before completing connector disposal', async () => {
    const stopping = Promise.withResolvers<undefined>()
    const stopped = Promise.withResolvers<undefined>()
    vi.mocked(startManagedDshHost).mockResolvedValue({
      origin: 'http://127.0.0.1:3000', token: 'fixture-token', home: 'fixture-home',
      stop: async () => { stopping.resolve(undefined); await stopped.promise },
    })
    const ctx = new Context()
    const [, transport] = InMemoryTransport.createLinkedPair()
    let disposed = false
    try {
      await apply(ctx, { autoStartHost: true, transport })
      const disposal = ctx.fiber.dispose().then(() => { disposed = true })
      await stopping.promise
      // Drain microtasks so a fire-and-forget Host shutdown can expose itself.
      await new Promise(resolve => setImmediate(resolve))
      expect(disposed).toBe(false)
      stopped.resolve(undefined)
      await disposal
      expect(disposed).toBe(true)
    } finally {
      stopped.resolve(undefined)
      await ctx.fiber.dispose()
    }
  })
})

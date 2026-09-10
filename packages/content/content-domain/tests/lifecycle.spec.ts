import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import ContentDomain from '../src/index.ts'
import { createEntry } from '../src/mutations.ts'

const allow = () => {}

describe('content activation failures', () => {
  it('rejects calls while opening and rejects new admission while draining accepted work', async () => {
    const ctx = new Context()
    const storage = await ctx.plugin(Storage)
    const backend = new MemoryStorageBackend()
    const gate = Promise.withResolvers<undefined>()
    ctx.storage.backend.register('test', {
      guarantees: ['single-writer', 'commit-sync', 'private-root'],
      kv: { open: async (descriptor) => { await gate.promise; return backend.kv.open(descriptor) } },
      close: () => backend.close(),
    })
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'test' }))
    const fiber = ctx.plugin(ContentDomain)
    try {
      await vi.waitFor(() => { expect(ctx.content.status().phase).toBe('opening') })
      const content = ctx.content
      expect(() => content.get('e', allow)).toThrow(/unavailable/u)
      gate.resolve(undefined)
      await fiber
      await vi.waitFor(() => { expect(content.status().phase).toBe('ready') })
      const sourceGate = Promise.withResolvers<undefined>()
      const capture = content.capture({ operationId: 'op', sessionId: 's', messageId: 'm' }, async () => {
        await sourceGate.promise
        return { source: { type: 'session-message', sessionId: 's', messageId: 'm', captureId: 'c',
          scope: 'full-message', verification: 'host-verified', boundary: 'completed-text' }, title: '', body: 'kept' }
      }, allow)
      const dispose = fiber.dispose()
      await vi.waitFor(() => { expect(() => content.get('e', allow)).toThrow(/closed/u) })
      sourceGate.resolve(undefined)
      await expect(capture).resolves.toMatchObject({ operationId: 'op' })
      await dispose
      expect(content.status().phase).toBe('closed')
    } finally {
      gate.resolve(undefined)
      await fiber.dispose()
      await backend.close()
      await storage.dispose()
    }
  })

  it.each(['write', 'open'] as const)('contains a failing close after an uncertain %s outcome', async (phase) => {
    const pool = new MemoryMediaPool()
    const ctx = new Context()
    const storage = await ctx.plugin(Storage)
    const backend = new MemoryStorageBackend(pool)
    const invalid = createEntry({ type: 'save-text', entryId: 'e', operationId: 'o', title: '', body: 'original' }, 'a'.repeat(64))
    for (const version of invalid.versions) version.body = 'tampered'
    ctx.storage.backend.register('test', {
      guarantees: ['single-writer', 'commit-sync', 'private-root'],
      kv: { open: async (descriptor) => {
        const unit = await backend.kv.open(descriptor)
        return {
          loadAll: phase === 'open' ? async () => ({ tables: { entries: { e: invalid } }, global: null }) : () => unit.loadAll(),
          putRecord: async () => { throw new Error('failed write') },
          deleteRecord: (table, key) => unit.deleteRecord(table, key),
          setGlobal: value => unit.setGlobal(value),
          close: async () => { await unit.close(); throw new Error('close status unknown') },
        }
      } },
      close: () => backend.close(),
    })
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'test' }))
    const fiber = await ctx.plugin(ContentDomain)
    try {
      if (phase === 'write') {
        await vi.waitFor(() => { expect(ctx.content.status().phase).toBe('ready') })
        await expect(ctx.content.execute({ type: 'create', entryId: 'e', operationId: 'o', title: '', body: 'x' }, allow))
          .rejects.toMatchObject({ code: 'storage_failed' })
      }
      await vi.waitFor(() => { expect(ctx.content.status().phase).toBe('unavailable') })
      expect(() => ctx.content.snapshot(allow)).toThrow()
      expect(pool.media.get('content_library')?.tables.get('entries')?.size ?? 0).toBe(0)
    } finally {
      await fiber.dispose()
      await backend.close()
      await storage.dispose()
    }
  })

  it('sanitizes a non-Error rejection from the backend', async () => {
    const ctx = new Context()
    const storage = await ctx.plugin(Storage)
    ctx.storage.backend.register('test', {
      guarantees: ['single-writer', 'commit-sync', 'private-root'],
      kv: { open: vi.fn().mockRejectedValue('private backend detail') }, close: async () => {},
    })
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'test' }))
    const fiber = await ctx.plugin(ContentDomain)
    try {
      await vi.waitFor(() => { expect(ctx.content.status()).toMatchObject({ phase: 'unavailable', reason: 'storage_failed' }) })
      expect(() => ctx.content.get('e', allow)).toThrow('Content operation failed: storage_failed')
    } finally {
      await fiber.dispose()
      await storage.dispose()
    }
  })
})

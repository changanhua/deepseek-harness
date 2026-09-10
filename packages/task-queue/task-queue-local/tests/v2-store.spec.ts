import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { digestIntent, WorkId } from '@changanhua/dsh-task-queue'
import type { ChangeSet, WorkKindDefinition } from '@changanhua/dsh-task-queue'
import { WorkQueueStore } from '../src/v2-store.ts'

const fsControl = vi.hoisted(() => ({ failNextSync: false }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      if (!fsControl.failNextSync) return handle
      fsControl.failNextSync = false
      vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('injected sync failure'))
      return handle
    },
  }
})

declare module '@changanhua/dsh-task-queue' {
  interface WorkKindMap {
    'store-test@1': WorkKindDefinition<{ readonly prompt: string }, { readonly value: string }, { readonly value: string }, { readonly value: string }>
  }
}

const AT = '2026-08-26T00:00:00.000Z'

function admitted(seq: number, id = WorkId('work-1')): ChangeSet {
  const intent = { prompt: 'x' }
  const work = { id, kind: 'store-test@1' as const, title: 'test', intent, intentDigest: digestIntent(intent), resolved: { value: 'x' }, policy: { maxAttempts: 1 }, resources: [], tags: [], batchId: null, ownerSessionId: 'session-1', createdAt: AT }
  return { seq, changeId: `change-${seq}`, at: AT, events: [{ type: 'work/admitted' as const, work }, { type: 'receipt/recorded' as const, receipt: { owner: { type: 'agent' as const, sessionId: 'session-1' }, source: 'agent', key: `key-${seq}`, intentDigest: work.intentDigest, workIds: [id], batchId: null, createdAt: AT } }] }
}

describe('WorkQueueStore', () => {
  it('publishes a ChangeSet only after its durable append settles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-v2-'))
    try {
      const store = new WorkQueueStore(root)
      await store.open()

      const append = store.append(admitted(1))

      expect(store.current().lastSeq).toBe(0)
      await append
      expect(store.current().lastSeq).toBe(1)
      await store.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps the previous projection and faults future writes after sync fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-v2-'))
    try {
      const store = new WorkQueueStore(root)
      await store.open()
      fsControl.failNextSync = true

      await expect(store.append(admitted(1))).rejects.toThrow('injected sync failure')
      expect(store.current().lastSeq).toBe(0)
      expect(store.isFaulted()).toBe(true)
      await expect(store.append(admitted(1))).rejects.toThrow(/store is faulted/)
      await store.close()

      const reopened = new WorkQueueStore(root)
      expect((await reopened.open()).lastSeq).toBe(1)
      await reopened.close()
    } finally {
      fsControl.failNextSync = false
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects the prior manifest schema before folding its log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-v2-'))
    try {
      await writeFile(join(root, 'manifest.json'), '{"schemaVersion":2}\n', 'utf8')

      await expect(new WorkQueueStore(root).open()).rejects.toThrow(/refuses schemaVersion 2/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('recovers a snapshot and folds only the durable JSONL tail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-v2-'))
    try {
      const first = new WorkQueueStore(root)
      await first.open()
      await first.append(admitted(1))
      await first.writeSnapshot()
      await first.append(admitted(2, WorkId('work-2')))
      await first.close()

      const restarted = new WorkQueueStore(root)
      const recovered = await restarted.open()
      expect(recovered.lastSeq).toBe(2)
      expect(recovered.worksById.size).toBe(2)
      await restarted.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

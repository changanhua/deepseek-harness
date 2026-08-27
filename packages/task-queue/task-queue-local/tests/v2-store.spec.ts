import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { digestIntent, WorkId } from '@deepseek-ai/dsh-task-queue'
import type { ChangeSet, WorkKindDefinition } from '@deepseek-ai/dsh-task-queue'
import { WorkQueueStore } from '../src/v2-store.ts'

declare module '@deepseek-ai/dsh-task-queue' {
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

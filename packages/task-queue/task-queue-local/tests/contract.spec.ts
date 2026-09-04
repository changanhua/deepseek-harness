import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as queueCore from '@changanhua/dsh-task-queue'
import {
  WorkId,
  createVerifiedOperatorAuthority,
  digestIntent,
} from '@changanhua/dsh-task-queue'
import type { WorkKindDefinition } from '@changanhua/dsh-task-queue'
import LocalTaskQueue, { WorkQueueStore } from '../src/index.ts'

declare module '@changanhua/dsh-task-queue' {
  interface WorkKindMap {
    'test@1': WorkKindDefinition<
      { readonly prompt: string },
      { readonly prompt: string; readonly model: string },
      { readonly argv: readonly string[] },
      { readonly artifact: string }
    >
  }
}

const AT = '2026-08-30T00:00:00.000Z'

describe('Queue v2 provider contract', () => {
  it('exposes provider-owned authority constructors without exposing the opaque brand', () => {
    expect(queueCore).toHaveProperty('createVerifiedAgentAuthority')
    expect(queueCore).toHaveProperty('createVerifiedOperatorAuthority')
  })

  it('keeps byte persistence outside the Queue core contract', () => {
    expect(queueCore).not.toHaveProperty('createStartContext')
  })

  it('finishes durable recovery before the Cordis service plugin becomes available', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-queue-service-ready-'))
    const workId = WorkId('persisted-work')
    const intent = { prompt: 'persisted' }
    const raw = new WorkQueueStore(root)
    const ctx = new Context()
    try {
      await raw.open()
      await raw.transaction(() => raw.append({
        seq: 1,
        changeId: 'persisted-admission',
        at: AT,
        events: [
          {
            type: 'work/admitted',
            work: {
              id: workId,
              kind: 'test@1',
              title: 'persisted',
              intent,
              intentDigest: digestIntent(intent),
              resolved: { ...intent, model: 'test' },
              policy: { maxAttempts: 1 },
              resources: [],
              tags: [],
              batchId: null,
              ownerSessionId: null,
              createdAt: AT,
            },
          },
          {
            type: 'receipt/recorded',
            receipt: {
              owner: { type: 'operator' },
              source: 'operator',
              key: 'persisted-key',
              intentDigest: digestIntent(intent),
              workIds: [workId],
              batchId: null,
              createdAt: AT,
            },
          },
        ],
      }))
      await raw.close()

      await ctx.plugin(LocalTaskQueue, { queueRoot: root })

      const operator = ctx.taskQueue.forOperator(
        createVerifiedOperatorAuthority(),
      )
      expect(operator.list().map(view => view.work.id)).toEqual([workId])
    } finally {
      await ctx.fiber.dispose()
      await raw.close().catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  })
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createVerifiedAgentAuthority, createVerifiedOperatorAuthority, digestIntent, WorkId } from '@deepseek-ai/dsh-task-queue'
import type { ImageGeneration } from '@deepseek-ai/dsh-image-generation'
import { createImageGenerateHandler } from '../../../image/image-generation-task-queue/src/index.ts'
import LocalTaskQueue, { WorkQueueStore } from '../src/index.ts'

const AT = '2026-08-26T00:00:00.000Z'

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('image task did not settle')
}

describe('Queue v2 image vertical', () => {
  it('runs resolved image facts and persists the bytes as durable attachments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-image-queue-v2-'))
    try {
      const ctx = new Context()
      const attachments = new LocalAttachmentStore(ctx, { dshHome: root })
      const queue = new LocalTaskQueue(ctx, { queueRoot: root, resourceCapacity: { 'image-generation': 1 } })
      const internals = queue as unknown as { store: WorkQueueStore; pump(): Promise<void> }
      const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64'))
      const image = { async resolve() { throw new Error('generation must use admitted facts') }, async generate() { return { provider: 'arkcli', model: 'seedream', images: [{ bytes, mediaType: 'image/png', width: 1, height: 1 }] } } } as unknown as ImageGeneration
      queue.registerHandler(createImageGenerateHandler(image, attachments))
      const intent = { prompt: 'a tense classic cover', provider: 'arkcli', size: '1920x1920', outputFormat: 'png' as const, watermark: false }
      const resolved = { prompt: intent.prompt, spec: { provider: 'arkcli', model: 'seedream', size: intent.size, outputFormat: 'png' as const, watermark: false, providerSpec: { profile: 'agent-plan' } } }
      const work = { id: WorkId('image-work-1'), kind: 'image.generate@1' as const, title: 'cover', intent, intentDigest: digestIntent(intent), resolved, policy: { maxAttempts: 1 }, resources: [{ resource: 'image-generation', units: 1 }], tags: [], batchId: null, ownerSessionId: 'session-1', createdAt: AT }
      await internals.store.transaction(() => internals.store.append({ seq: 1, changeId: 'image-admitted', at: AT, events: [{ type: 'work/admitted', work }, { type: 'receipt/recorded', receipt: { owner: { type: 'agent', sessionId: 'session-1' }, source: 'agent', key: 'image-key', intentDigest: work.intentDigest, workIds: [work.id], batchId: null, createdAt: AT } }] }))
      await internals.pump()
      await waitFor(() => internals.store.current().statesByWorkId.get(work.id)?.status === 'succeeded')
      const result = [...internals.store.current().resultsById.values()][0]!
      const output = result.output as { attachments: readonly unknown[] }
      expect(output.attachments).toHaveLength(1)
      const stored = await attachments.readImage(output.attachments[0] as never)
      expect(stored.data).toEqual(bytes)
      expect(stored.ref).toMatchObject({ mediaType: 'image/png', width: 1, height: 1 })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('runs ten image WorkItems under Batch and resource limits without an agent.run worker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-image-batch-v2-'))
    const queueRoot = join(root, 'queue')
    try {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      const session = ctx.sessions.create(SessionId('ten-cover-owner'))
      const attachments = new LocalAttachmentStore(ctx, { dshHome: root })
      const queue = new LocalTaskQueue(ctx, {
        queueRoot,
        maxConcurrent: 10,
        resourceCapacity: { 'image-generation': 3, 'agent-run': 1 },
      })
      let active = 0
      let maximumActive = 0
      let generationCalls = 0
      let workerStarts = 0
      let releaseInitial!: () => void
      const initialBarrier = new Promise<void>((resolve) => { releaseInitial = resolve })
      const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64'))
      const image = {
        async resolve(request: { size: string; outputFormat: 'png' | 'jpeg'; watermark: boolean; provider?: string; model?: string }) {
          return { provider: request.provider ?? 'arkcli', model: request.model ?? 'seedream', size: request.size, outputFormat: request.outputFormat, watermark: request.watermark, providerSpec: { profile: 'agent-plan' } }
        },
        async generate() {
          generationCalls += 1
          active += 1
          maximumActive = Math.max(maximumActive, active)
          if (active === 3) releaseInitial()
          try {
            if (generationCalls <= 3) {
              await Promise.race([
                initialBarrier,
                new Promise(resolve => setTimeout(resolve, 250)),
              ])
            } else {
              await new Promise(resolve => setTimeout(resolve, 10))
            }
            return { provider: 'arkcli', model: 'seedream', images: [{ bytes, mediaType: 'image/png', width: 1, height: 1 }] }
          } finally {
            active -= 1
          }
        },
      } as unknown as ImageGeneration
      queue.registerHandler(createImageGenerateHandler(image, attachments))
      queue.registerHandler({
        kind: 'agent.run@1' as never,
        async resolveAdmission(input) { return input },
        resources() { return [{ resource: 'agent-run', units: 1 }] },
        policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start() { workerStarts += 1; return { done: Promise.resolve({ status: 'succeeded', output: {} } as never), async cancel() {} } },
      })
      const titles = [
        'Crime and Punishment', 'Moby-Dick', 'The Brothers Karamazov', 'Wuthering Heights', 'The Great Gatsby',
        'One Hundred Years of Solitude', 'Les Misérables', 'The Trial', 'Anna Karenina', 'Don Quixote',
      ]
      const agentQueue = queue.forAgent(createVerifiedAgentAuthority(session))
      const batchId = await agentQueue.enqueueBatch({
        kind: 'image.generate@1',
        items: titles.map((title, index) => ({
          title,
          input: {
            prompt: `Complete high-tension cover prompt ${index + 1} for ${title}`,
            provider: 'arkcli',
            model: 'seedream',
            size: '1920x1920',
            outputFormat: 'png' as const,
            watermark: false,
          },
        })),
        sharedPayload: {},
        idempotencyKey: 'ten-classic-covers',
        maxParallel: 3,
      })
      const operator = queue.forOperator(createVerifiedOperatorAuthority())
      await waitFor(() => operator.list().length === 10 && operator.list().every(view => view.state.status === 'succeeded'))
      const views = operator.list()
      expect(views.map(view => view.work.title)).toEqual(titles)
      expect(views.every(view => view.work.kind === 'image.generate@1' && view.work.batchId === batchId)).toBe(true)
      expect(generationCalls).toBe(10)
      expect(maximumActive).toBe(3)
      expect(workerStarts).toBe(0)
      expect(views.flatMap((view) => {
        const output = view.result?.output as { attachments?: readonly unknown[] } | undefined
        return output?.attachments ?? []
      })).toHaveLength(10)

      await ctx.fiber.dispose()
      const reopened = new WorkQueueStore(queueRoot)
      const projection = await reopened.open()
      try {
        expect(projection.batchesById.get(batchId)?.maxParallel).toBe(3)
        expect(projection.resultsById.size).toBe(10)
        const attachmentContext = new Context()
        const reopenedAttachments = new LocalAttachmentStore(attachmentContext, { dshHome: root })
        for (const result of projection.resultsById.values()) {
          const output = result.output as { attachments: readonly unknown[] }
          const stored = await reopenedAttachments.readImage(output.attachments[0] as never)
          expect(stored.data).toEqual(bytes)
        }
        await attachmentContext.fiber.dispose()
      } finally {
        await reopened.close()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

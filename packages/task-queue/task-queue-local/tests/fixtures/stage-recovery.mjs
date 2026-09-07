import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'

export const name = 'queue-stage-recovery-fixture'
export const inject = ['taskQueue']

async function waitFor(predicate) {
  for (let n = 0; n < 1000; n++) {
    if (predicate()) return
    await sleep(10)
  }
  throw new Error('stage recovery fixture timed out')
}

export function apply(ctx, config) {
  void run(ctx, config).catch(error => {
    console.error(error)
    ctx.get('appExit')(1)
  })
}

async function run(ctx, { root, phase }) {
  await ctx.loader.await()
  const queue = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
  let prepareCount = 0
  ctx.effect(() => ctx.taskQueue.registerHandler({
    kind: 'stage-recovery-test@1',
    async resolveAdmission(input) { return input },
    resources() { return [] },
    policy() { return { maxAttempts: 3 } },
    async prepare(input) {
      if (phase === 'idle-retry' && ++prepareCount === 1) throw new Error('temporary idle worker failure')
      if (input.stage === 'draft' && phase === 'draft') throw new Error('temporary research service failure')
      return input
    },
    start(input) {
      let stop
      const stopped = new Promise(resolve => { stop = resolve })
      const done = (async () => {
        await appendFile(join(root, 'executions.jsonl'), JSON.stringify({ ...input, at: Date.now() }) + '\n')
        if (input.stage === 'interrupted') {
          await writeFile(join(root, 'live.json'), JSON.stringify({ pid: process.pid }))
          await stopped
          return { status: 'canceled' }
        }
        return { status: 'succeeded', output: { stage: input.stage, artifact: input.stage + '-v1', inputArtifact: input.inputArtifact } }
      })()
      return { done, async cancel() { stop() } }
    },
  }))
  const request = (stage, inputArtifact = 'topic-v1') => ({
    kind: 'stage-recovery-test@1', title: stage, input: { stage, inputArtifact },
    idempotencyKey: 'entry-1:' + stage + ':v1',
  })
  if (phase === 'idle-retry') {
    const id = await queue.enqueue(request('research'))
    ctx.on('task-queue/changed', () => {
      if (queue.get(id).state.status !== 'succeeded') return
      void writeFile(join(root, phase + '.json'), JSON.stringify(queue.get(id))).then(() => ctx.get('appExit')(0))
    })
    await waitFor(() => queue.get(id).state.status === 'queued' && queue.get(id).state.attemptCount === 1)
    // Return with no polling, server or keepalive: the Queue timer must own the wait.
    return
  }
  if (phase === 'unknown-start') {
    const id = await queue.enqueue(request('interrupted'))
    await waitFor(() => queue.get(id).state.status === 'running')
    await writeFile(join(root, 'unknown-work.json'), JSON.stringify({ id }))
    // The test kills this owning process after observing its durable running state.
    const keeper = setInterval(() => {}, 1000)
    ctx.effect(() => () => clearInterval(keeper))
    return
  }
  if (phase === 'unknown-inspect') {
    const { id } = JSON.parse(await readFile(join(root, 'unknown-work.json'), 'utf8'))
    const duplicate = await queue.enqueue(request('interrupted'))
    await writeFile(join(root, phase + '.json'), JSON.stringify({ id, duplicate, view: queue.get(id) }))
  } else {
    const researchRequest = request('research')
    const [research, duplicate] = await Promise.all([queue.enqueue(researchRequest), queue.enqueue(researchRequest)])
    await waitFor(() => queue.get(research).state.status === 'succeeded')
    let conflict = false
    try { await queue.enqueue({ ...researchRequest, input: { stage: 'research', inputArtifact: 'changed-topic' } }) }
    catch { conflict = true }
    const output = { research, duplicate, conflict, researchView: queue.get(research) }
    if (phase !== 'research') {
      const draft = await queue.enqueue(request('draft', queue.get(research).result.output.artifact))
      if (phase === 'draft') {
        await waitFor(() => queue.get(draft).state.status === 'queued' && queue.get(draft).state.attemptCount === 1)
        output.draft = draft
        output.wait = queue.waitReason(draft)
      } else {
        await waitFor(() => queue.get(draft).state.status === 'succeeded')
        const review = await queue.enqueue(request('review', queue.get(draft).result.output.artifact))
        await waitFor(() => queue.get(review).state.status === 'succeeded')
        output.draft = draft
        output.review = review
        output.works = queue.list()
      }
    }
    // This report is test evidence, not a business receipt. Each process reconstructs its bindings.
    await writeFile(join(root, phase + '.json'), JSON.stringify(output))
  }
  ctx.get('appExit')(0)
}

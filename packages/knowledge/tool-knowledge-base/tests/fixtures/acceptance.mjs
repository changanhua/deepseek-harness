import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { canonicalHash } from '@changanhua/dsh-knowledge-base'
import { createVerifiedOperatorAuthority } from '../../../../task-queue/task-queue/lib/index.js'
import { executeKnowledgeRequest } from '../../lib/index.js'

export const name = 'knowledge-acceptance-fixture'
export const inject = ['knowledgeBase', 'knowledgeQueue', 'tools', 'taskQueue']
export function apply(ctx, config) {
  void run(ctx, config).catch(async error => {
    await writeFile(join(config.root, 'failure.json'), JSON.stringify({ error: String(error), stack: error.stack }, null, 2))
    console.error(String(error))
    ctx.get('appExit')(1)
  })
}
async function run(ctx, config) {
  await ctx.loader.await()
  const repo = ctx.knowledgeBase.repository
  const queue = ctx.knowledgeQueue
  const data = JSON.parse(await readFile(config.example, 'utf8'))
  const selected = config.limit ? data.spec.seeds.slice(0, config.limit) : data.spec.seeds
  const needed = new Set(selected.flatMap(seed => seed.sourceIds))
  const spec = { ...data.spec, id: config.projectId ?? data.spec.id, seeds: selected }
  if (config.inspectOnly) {
    const record = repo.get(spec.id)
    const check = await repo.check(spec.id)
    const draft = await repo.exportDraft(spec.id, 'quota-stop-20260908')
    const stages = Object.values(record.stages).map(stage => ({
      id: stage.prepared.id, entryId: stage.prepared.entryId, action: stage.prepared.action,
      workId: stage.workId, state: stage.state, owner: stage.owner, responseHash: stage.responseHash,
      execution: stage.execution,
      work: stage.workId === null ? null : queue.status(stage.workId).state,
    }))
    await writeFile(join(config.root, 'stopped-snapshot.json'), JSON.stringify({
      projectId: spec.id, generationStop: repo.generationStop(), check, draft, stages,
    }, null, 2))
    console.log(JSON.stringify({ projectId: spec.id, covered: check.covered, required: check.required, draft }))
    ctx.get('appExit')(0)
    return
  }
  await repo.create(spec)
  for (const source of data.sources.filter(source => needed.has(source.sourceId))) await repo.ingest(spec.id, source)
  await repo.confirmPlan(spec.id, canonicalHash(spec))
  await mkdir(config.root, { recursive: true })
  for (const revision of config.revisions ?? []) {
    if (repo.get(spec.id).entries[revision.entryId]?.review?.stageId !== revision.reviewStageId) continue
    const bound = await executeKnowledgeRequest({ action: 'generate', projectId: spec.id, entryId: revision.entryId }, { repository: repo, queue }, new AbortController().signal)
    await writeFile(join(config.root, 'requested-revision.json'), JSON.stringify({ ...revision, ...bound }, null, 2))
    for (;;) {
      const view = queue.status(bound.workId)
      if (view.state.status === 'succeeded') break
      if (['failed', 'unknown', 'canceled'].includes(view.state.status)) throw new Error(JSON.stringify({ bound, state: view.state }))
      await sleep(250)
    }
  }
  if (config.useBuild) {
    const deps = { repository: repo, queue }
    const signal = new AbortController().signal
    const built = await executeKnowledgeRequest({ action: 'build', projectId: spec.id }, deps, signal)
    const check = await executeKnowledgeRequest({ action: 'check', projectId: spec.id }, deps, signal)
    const release = check.publishable
      ? await executeKnowledgeRequest({ action: 'publish', projectId: spec.id, version: config.version ?? 'v1' }, deps, signal) : null
    const stages = Object.values(repo.get(spec.id).stages).map(stage => ({
      id: stage.prepared.id, entryId: stage.prepared.entryId, action: stage.prepared.action,
      workId: stage.workId, state: stage.state, responseHash: stage.responseHash,
    }))
    await writeFile(join(config.root, 'result.json'), JSON.stringify({ projectId: spec.id, built, check, release, stages }, null, 2))
    console.log(JSON.stringify({ projectId: spec.id, built, publishable: check.publishable, release }))
    ctx.get('appExit')(check.publishable ? 0 : 1)
    return
  }
  const trace = []
  const execute = async (entryId, action) => {
    const binding = await queue.enqueueStage(spec.id, entryId, action)
    trace.push({ entryId, action, ...binding })
    await writeFile(join(config.root, 'progress.json'), JSON.stringify({ trace }, null, 2))
    let view
    let prepareRetries = 0
    const deadline = Date.now() + 600000
    while (true) {
      view = queue.status(binding.workId)
      if (view.state.status === 'failed' && view.state.failure?.sideEffect === 'not-started'
        && view.state.failure?.category === 'prepare-threw' && prepareRetries < 1) {
        prepareRetries++
        const operator = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
        await operator.retry(binding.workId)
        continue
      }
      if (['succeeded', 'failed', 'unknown', 'canceled'].includes(view.state.status)) break
      if (Date.now() >= deadline) { await queue.cancel(binding.workId); throw new Error('knowledge acceptance stage deadline') }
      await sleep(250)
    }
    if (view.state.status !== 'succeeded') throw new Error(JSON.stringify({ binding, state: view.state, result: view.result }))
    await writeFile(join(config.root, 'progress.json'), JSON.stringify({ trace, completed: trace.length }, null, 2))
  }
  for (const seed of selected) {
    await execute(seed.id, 'generate')
    await execute(seed.id, 'review')
    for (let revisions = 0; revisions < 2; revisions++) {
      const report = await repo.check(spec.id)
      if (!report.entries.find(entry => entry.id === seed.id)?.issues.includes('review_not_passed')) break
      await execute(seed.id, 'generate')
      await execute(seed.id, 'review')
    }
  }
  const check = await repo.check(spec.id)
  const release = check.publishable ? await repo.publish(spec.id, config.version ?? 'v1') : null
  const result = { projectId: spec.id, check, release, trace, toolAvailable: !!ctx.tools }
  await writeFile(join(config.root, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ projectId: spec.id, entries: check.entries.length, publishable: check.publishable, release }))
  ctx.get('appExit')(check.publishable ? 0 : 1)
}

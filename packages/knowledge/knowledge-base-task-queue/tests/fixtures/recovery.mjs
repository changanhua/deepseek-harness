import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalHash } from '@changanhua/dsh-knowledge-base'
import { createKnowledgeStageHandler } from '@changanhua/dsh-knowledge-base-task-queue'
import { createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'

export const name = 'knowledge-recovery-fixture'
export const inject = ['knowledgeBase', 'taskQueue']

const project = {
  id: 'recovery-project', title: '恢复验证', readerTask: '验证持久恢复', language: 'zh-CN',
  seeds: [{ id: 'recovery-entry', title: '恢复条目', goal: '恢复业务提交', type: 'method', depends: [], sourceIds: ['source'], required: true }],
}
const source = { sourceId: 'source', title: '受控资料', text: '受控恢复测试资料。', fetchedAt: '2026-09-08T00:00:00.000Z' }

const wait = () => new Promise(() => {})
async function until(predicate) {
  for (let n = 0; n < 1_000; n++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('knowledge recovery fixture timed out')
}
async function mark(root, name) {
  await mkdir(join(root, 'windows'), { recursive: true })
  await writeFile(join(root, 'windows', name), 'ready')
}
async function write(root, name, value) {
  await writeFile(join(root, `${name}.json`), JSON.stringify(value))
}

export function apply(ctx, config) {
  void run(ctx, config).catch(async error => {
    await write(config.root, 'failure', { error: String(error), stack: error?.stack })
    console.error(error)
    ctx.get('appExit')(1)
  })
}

async function run(ctx, { root, phase }) {
  await ctx.loader.await()
  const repository = ctx.knowledgeBase.repository
  const operator = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
  await repository.create(project)
  await repository.ingest(project.id, source)
  await repository.confirmPlan(project.id, canonicalHash(project))
  const stage = await repository.prepareStage(project.id, 'recovery-entry', 'generate')
  const request = { kind: 'knowledge.stage@1', title: 'recovery', input: { projectId: project.id, stageId: stage.id }, idempotencyKey: `knowledge:${project.id}:${stage.id}` }

  const originalWriteEntry = repository.files.writeEntry.bind(repository.files)
  if (phase === 'candidate-window') {
    repository.files.writeEntry = async (...args) => {
      await mark(root, 'candidate-window')
      await wait()
      return originalWriteEntry(...args)
    }
  }
  const originalAccept = repository.acceptResult.bind(repository)
  if (phase === 'completed-window') {
    repository.acceptResult = async (...args) => {
      const result = await originalAccept(...args)
      await mark(root, 'completed-window')
      await wait()
      return result
    }
  }
  const start = async request => {
    await appendFile(join(root, 'invocations.jsonl'), JSON.stringify({ phase, at: Date.now() }) + '\n')
    if (phase === 'model-window') {
      await mark(root, 'model-started')
      await wait()
    }
    const prompt = request.prompt[0].text
    const context = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1))
    const output = {
      id: context.seed.id, title: context.seed.title, type: context.seed.type,
      seedIds: [context.seed.id], depends: context.seed.depends, related: [], conditions: '受控恢复测试',
      body: '恢复后的内容可从候选或已完成业务记录回填。',
      citations: [{ sourceId: context.sources[0].sourceId, snapshotId: context.sources[0].snapshotId, quote: context.sources[0].text }],
    }
    return { result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: JSON.stringify(output) }] }), dispose: async () => {} }
  }
  ctx.effect(() => ctx.taskQueue.registerHandler(createKnowledgeStageHandler({ repository, operator, start }, { permissionMode: 'never', disposeGraceMs: 10 })))

  if (phase === 'inspect-model') {
    const workId = await operator.enqueue(request)
    await write(root, phase, { workId, stageId: stage.id, view: operator.get(workId) })
    ctx.get('appExit')(0)
    return
  }
  if (phase.startsWith('recover-')) {
    const workId = await operator.enqueue(request)
    await until(() => operator.get(workId).state.status === 'unknown')
    const recovered = await repository.recoverStage(project.id, stage.id, String(workId))
    if (recovered === null) throw new Error('expected a verified stage recovery')
    await operator.resolveUnknown(workId, { kind: 'authorize-retry' })
    await until(() => operator.get(workId).state.status === 'succeeded')
    await write(root, phase, { workId, stageId: stage.id, view: operator.get(workId) })
    ctx.get('appExit')(0)
    return
  }
  const workId = await operator.enqueue(request)
  await repository.bindStage(project.id, stage.id, String(workId))
  await until(() => operator.get(workId).state.status === 'running')
  // 父测试只会杀掉这个子进程；三个窗口都已由真实生产调用抵达。
  const keeper = setInterval(() => {}, 1_000)
  ctx.effect(() => () => clearInterval(keeper))
}

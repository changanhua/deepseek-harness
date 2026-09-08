import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { KnowledgeRepository, renderEntry } from '../src/repository.ts'
import { canonicalHash } from '../src/model.ts'
import type { KnowledgeEntry, KnowledgeSeed } from '../src/model.ts'

const roots: string[] = []
const closers: (() => Promise<void>)[] = []

function specification(id: string, seeds: KnowledgeSeed[] = [{
  id: 'first', title: '第一步', goal: '完成第一步', type: 'method' as const,
  depends: [], sourceIds: ['source'], required: true,
}]) {
  return { id, title: '最终覆盖', readerTask: '完成可验证任务', language: 'zh-CN', seeds }
}

function entry(snapshotId: string, id = 'first', depends: string[] = [], sourceId = 'source'): KnowledgeEntry {
  return {
    id, title: id === 'first' ? '第一步' : '后续步骤', type: 'method', seedIds: [id], depends, related: [],
    conditions: '本地验证', body: '来源中的可验证事实。',
    citations: [{ sourceId, snapshotId, quote: '来源中的可验证事实。' }],
  }
}

async function open(root?: string) {
  root ??= await mkdtemp(join(tmpdir(), 'knowledge-final-coverage-'))
  if (!roots.includes(root)) roots.push(root)
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(join(root, 'domain'))
  ctx.storage.backend.register('json', backend)
  const repository = await KnowledgeRepository.open(new DomainFacility(ctx, { backend: 'json' }), join(root, 'content'))
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await repository.close()
    await backend.close()
    await ctx.fiber.dispose()
  }
  closers.push(close)
  return { root, repository, close }
}

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function prepared(id = 'final', seeds?: KnowledgeSeed[]) {
  const environment = await open()
  const project = specification(id, seeds)
  await environment.repository.create(project)
  const source = await environment.repository.ingest(id, {
    sourceId: 'source', title: '来源', text: '来源中的可验证事实。', fetchedAt: '2026-09-08T00:00:00.000Z',
  })
  await environment.repository.confirmPlan(id, canonicalHash(project))
  return { ...environment, project, source }
}

async function generate(repository: KnowledgeRepository, projectId: string, snapshotId: string, id = 'first', depends: string[] = [], sourceId = 'source') {
  const stage = await repository.prepareStage(projectId, id, 'generate')
  const workId = `work-${id}-${stage.id.slice(0, 8)}`
  await repository.bindStage(projectId, stage.id, workId)
  await repository.acceptResult(projectId, stage.id, JSON.stringify(entry(snapshotId, id, depends, sourceId)), { workId, attemptId: `${workId}-attempt` })
  return stage
}

async function review(repository: KnowledgeRepository, projectId: string, id = 'first') {
  const stage = await repository.prepareStage(projectId, id, 'review')
  const workId = `review-${id}-${stage.id.slice(0, 8)}`
  await repository.bindStage(projectId, stage.id, workId)
  await repository.acceptResult(projectId, stage.id, '{"status":"pass","issues":[],"summary":"来源支持。"}', { workId, attemptId: `${workId}-attempt` })
  return { stage, workId }
}

describe('KnowledgeRepository 最终可达分支', () => {
  it('来源更新使受影响条目失效，并在依赖恢复后自动恢复下游新鲜度', async () => {
    const seeds: KnowledgeSeed[] = [
      { id: 'first', title: '第一步', goal: '完成第一步', type: 'method', depends: [], sourceIds: ['source-a'], required: true },
      { id: 'second', title: '第二步', goal: '完成第二步', type: 'method', depends: ['first'], sourceIds: ['source-b'], required: true },
    ]
    const environment = await open()
    const { repository } = environment, project = specification('freshness', seeds)
    await repository.create(project)
    const firstSource = await repository.ingest(project.id, { sourceId: 'source-a', title: '来源 A', text: '来源中的可验证事实。', fetchedAt: '2026-09-08T00:00:00.000Z' })
    const secondSource = await repository.ingest(project.id, { sourceId: 'source-b', title: '来源 B', text: '来源中的可验证事实。', fetchedAt: '2026-09-08T00:00:00.000Z' })
    await repository.confirmPlan(project.id, canonicalHash(project))
    await generate(repository, project.id, firstSource.snapshotId, 'first', [], 'source-a')
    await generate(repository, project.id, secondSource.snapshotId, 'second', ['first'], 'source-b')
    const refreshed = await repository.ingest(project.id, { sourceId: 'source-a', title: '新来源', text: '来源中的可验证事实。新增资料。', fetchedAt: '2026-09-09T00:00:00.000Z' })
    expect(repository.get(project.id).entries).toMatchObject({ first: { stale: true }, second: { stale: true } })
    const directory = await repository.files.workingDirectory(project.id)
    await writeFile(join(directory, 'entries', 'first.md'), renderEntry(entry(refreshed.snapshotId, 'first', [], 'source-a')))
    await repository.adopt(project.id, 'first')
    await repository.adopt(project.id, 'second')
    await repository.setPlan(project.id, project.seeds)
    await repository.confirmPlan(project.id, canonicalHash(project))
    const stage = await repository.prepareStage(project.id, 'second', 'generate')
    expect(stage.entryId).toBe('second')
    expect(repository.get(project.id).entries.second?.stale).toBe(false)
  })

  it('首次接收手工条目、草稿和检查传播保留真实状态', async () => {
    const seeds: KnowledgeSeed[] = [
      { id: 'first', title: '第一步', goal: '完成第一步', type: 'method', depends: [], sourceIds: ['source'], required: true },
      { id: 'second', title: '第二步', goal: '完成第二步', type: 'method', depends: ['first'], sourceIds: ['source'], required: true },
    ]
    const { repository, project, source } = await prepared('draft-propagation', seeds)
    const directory = await repository.files.workingDirectory(project.id)
    await writeFile(join(directory, 'entries', 'first.md'), renderEntry(entry(source.snapshotId)))
    await repository.adopt(project.id, 'first')
    const report = await repository.check(project.id)
    expect(report.entries.find(item => item.id === 'second')?.issues).toContain('prerequisite_not_passed')
    const draft = await repository.exportDraft(project.id, 'partial')
    expect(await readFile(join(draft.path, 'map.md'), 'utf8')).toContain('本版本未收录')
    expect(await readFile(join(draft.path, 'README.md'), 'utf8')).toContain('second：entry_missing、prerequisite_not_passed')
  })

  it('检查观察到工作文件缺失，发布拒绝 artifact 哈希不一致', async () => {
    const { repository, project, source, root } = await prepared('artifact-check')
    await generate(repository, project.id, source.snapshotId)
    await unlink(join(root, 'content', 'projects', project.id, 'entries', 'first.md'))
    expect((await repository.check(project.id)).entries[0]?.issues).toContain('working_copy_changed')
    await writeFile(join(root, 'content', 'projects', project.id, 'entries', 'first.md'), renderEntry(entry(source.snapshotId)))
    const reviewed = await review(repository, project.id)
    await expect(repository.completedStage(project.id, reviewed.stage.id, reviewed.workId)).resolves.toMatchObject({ candidate: null })
    const saved = repository.get(project.id).entries.first!
    const readArtifact = repository.files.readArtifact.bind(repository.files)
    vi.spyOn(repository.files, 'readArtifact').mockImplementation((id, hash) =>
      hash === saved.artifactHash ? Promise.resolve('损坏的 artifact') : readArtifact(id, hash))
    await expect(repository.publish(project.id, 'v1')).rejects.toThrow(/publication artifact mismatch/)
  })

  it('恢复路径拒绝 candidate 的错误 owner，并读取完成 candidate artifact', async () => {
    const { repository, project, source } = await prepared('recovery-owner')
    const stage = await repository.prepareStage(project.id, 'first', 'generate')
    await repository.bindStage(project.id, stage.id, 'recovery-work')
    vi.spyOn(repository.files, 'writeEntry').mockRejectedValueOnce(new Error('中断'))
    await expect(repository.acceptResult(project.id, stage.id, JSON.stringify(entry(source.snapshotId)), {
      workId: 'recovery-work', attemptId: 'attempt',
    })).rejects.toThrow('中断')
    const record = repository.get(project.id)
    expect(record.stages[stage.id]?.state).toBe('publishing')
    await expect(repository.recoverStage(project.id, stage.id, 'recovery-work')).resolves.toMatchObject({ state: 'completed' })
    const completed = await repository.completedStage(project.id, stage.id, 'recovery-work')
    expect(completed?.candidate).not.toBeNull()
  })

  it('恢复拒绝持久 publishing candidate 与绑定 work 不一致', async () => {
    const { root, repository, project, source, close } = await prepared('recovery-candidate-owner')
    const stage = await repository.prepareStage(project.id, 'first', 'generate')
    await repository.bindStage(project.id, stage.id, 'recovery-work')
    vi.spyOn(repository.files, 'writeEntry').mockRejectedValueOnce(new Error('中断'))
    await expect(repository.acceptResult(project.id, stage.id, JSON.stringify(entry(source.snapshotId)), {
      workId: 'recovery-work', attemptId: 'attempt',
    })).rejects.toThrow('中断')
    await close()
    const path = join(root, 'domain', 'knowledge_base.json')
    const document = JSON.parse(await readFile(path, 'utf8')) as {
      tables: { projects: Record<string, { stages: Record<string, { owner: { workId: string } | null }> }> }
    }
    document.tables.projects[project.id]!.stages[stage.id]!.owner!.workId = 'foreign-work'
    await writeFile(path, JSON.stringify(document, null, 2) + '\n')
    const reopened = await open(root)
    await expect(reopened.repository.recoverStage(project.id, stage.id, 'recovery-work')).rejects.toThrow(/candidate owner mismatch/)
  })

  it('捕获、成功和非法响应都固定调用开始时的 owner 参数', async () => {
    const captured = await prepared('fixed-capture-owner')
    const capturedStage = await captured.repository.prepareStage(captured.project.id, 'first', 'generate')
    await captured.repository.bindStage(captured.project.id, capturedStage.id, 'capture-work')
    const captureOwner = { workId: 'capture-work', attemptId: 'capture-attempt' }
    const capture = captured.repository.captureResponse(captured.project.id, capturedStage.id, '{}', captureOwner)
    captureOwner.workId = 'mutated-capture-work'
    await capture
    expect(captured.repository.get(captured.project.id).stages[capturedStage.id]?.owner).toEqual({ workId: 'capture-work', attemptId: 'capture-attempt' })

    const accepted = await prepared('fixed-success-owner')
    const acceptedStage = await accepted.repository.prepareStage(accepted.project.id, 'first', 'generate')
    await accepted.repository.bindStage(accepted.project.id, acceptedStage.id, 'accept-work')
    const acceptOwner = { workId: 'accept-work', attemptId: 'accept-attempt' }
    const acceptance = accepted.repository.acceptResult(
      accepted.project.id, acceptedStage.id, JSON.stringify(entry(accepted.source.snapshotId)), acceptOwner,
    )
    acceptOwner.workId = 'mutated-accept-work'
    await acceptance
    expect(accepted.repository.get(accepted.project.id).stages[acceptedStage.id]?.owner).toEqual({ workId: 'accept-work', attemptId: 'accept-attempt' })

    const rejected = await prepared('fixed-invalid-owner')
    const rejectedStage = await rejected.repository.prepareStage(rejected.project.id, 'first', 'generate')
    await rejected.repository.bindStage(rejected.project.id, rejectedStage.id, 'reject-work')
    const rejectOwner = { workId: 'reject-work', attemptId: 'reject-attempt' }
    const rejection = rejected.repository.acceptResult(rejected.project.id, rejectedStage.id, '{}', rejectOwner)
    rejectOwner.workId = 'mutated-reject-work'
    await expect(rejection).rejects.toMatchObject({ name: 'KnowledgeResultValidationError' })
    expect(rejected.repository.get(rejected.project.id).stages[rejectedStage.id]?.owner).toEqual({ workId: 'reject-work', attemptId: 'reject-attempt' })
  })

  it('已拒绝响应的同一修正输入保持幂等，并使旧条目随新地图失效', async () => {
    const { repository, project, source } = await prepared('correction-and-plan')
    await generate(repository, project.id, source.snapshotId)
    await repository.setPlan(project.id, [])
    const plan = await repository.prepareStage(project.id, 'plan', 'plan')
    await repository.bindStage(project.id, plan.id, 'new-plan')
    await repository.acceptResult(project.id, plan.id, JSON.stringify({ seeds: project.seeds }), { workId: 'new-plan', attemptId: 'plan-attempt' })
    expect(repository.get(project.id).entries.first?.stale).toBe(true)
    const revisedSeeds = [{ ...project.seeds[0]!, goal: '重新完成第一步' }]
    const revised = { ...project, seeds: revisedSeeds }
    await repository.setPlan(project.id, revisedSeeds)
    await repository.confirmPlan(project.id, canonicalHash(revised))
    const stage = await repository.prepareStage(project.id, 'first', 'generate')
    await repository.bindStage(project.id, stage.id, 'bad-response')
    await expect(repository.acceptResult(project.id, stage.id, '{}', { workId: 'bad-response', attemptId: 'bad-attempt' }))
      .rejects.toMatchObject({ name: 'KnowledgeResultValidationError' })
    const first = await repository.prepareCorrection(project.id, stage.id, '字段缺失')
    const repeated = await repository.prepareCorrection(project.id, stage.id, '字段缺失')
    expect(repeated).toEqual(first)
  })

  it('重开时拒绝当前发布版本缺少已提交记录，并关闭失败打开的 domain', async () => {
    const { root, repository, project, source, close } = await prepared('missing-release-record')
    await generate(repository, project.id, source.snapshotId)
    await review(repository, project.id)
    await repository.publish(project.id, 'v1')
    await close()
    const path = join(root, 'domain', 'knowledge_base.json')
    const document = JSON.parse(await readFile(path, 'utf8')) as { tables: { projects: Record<string, { releases: Record<string, unknown> }> } }
    document.tables.projects[project.id]!.releases = {}
    await writeFile(path, JSON.stringify(document, null, 2) + '\n')
    const ctx = new Context()
    await ctx.plugin(Storage)
    const backend = new JsonStorageBackend(join(root, 'domain'))
    ctx.storage.backend.register('json', backend)
    try {
      await expect(KnowledgeRepository.open(new DomainFacility(ctx, { backend: 'json' }), join(root, 'content')))
        .rejects.toThrow(/missing committed record: v1/)
    } finally {
      await backend.close()
      await ctx.fiber.dispose()
    }
  })

  it('损坏的持久来源或依赖记录经公开检查路径被拒绝', async () => {
    const sourceEnvironment = await prepared('missing-source-record')
    const { root, repository, project, source, close } = sourceEnvironment
    await generate(repository, project.id, source.snapshotId)
    await close()
    const sourcePath = join(root, 'domain', 'knowledge_base.json')
    const sourceDocument = JSON.parse(await readFile(sourcePath, 'utf8')) as {
      tables: { projects: Record<string, { sources: Record<string, unknown> }> }
    }
    delete sourceDocument.tables.projects[project.id]!.sources[`source:${source.snapshotId}`]
    await writeFile(sourcePath, JSON.stringify(sourceDocument, null, 2) + '\n')
    const sourceReopened = await open(root)
    await expect(sourceReopened.repository.check(project.id)).rejects.toThrow(/source missing/)
    await sourceReopened.close()

    const seeds: KnowledgeSeed[] = [
      { id: 'first', title: '第一步', goal: '完成第一步', type: 'method', depends: [], sourceIds: ['source'], required: true },
      { id: 'second', title: '第二步', goal: '完成第二步', type: 'method', depends: ['first'], sourceIds: ['source'], required: true },
    ]
    const dependencyEnvironment = await prepared('missing-dependency-record', seeds)
    await generate(dependencyEnvironment.repository, dependencyEnvironment.project.id, dependencyEnvironment.source.snapshotId)
    await generate(dependencyEnvironment.repository, dependencyEnvironment.project.id, dependencyEnvironment.source.snapshotId, 'second', ['first'])
    await dependencyEnvironment.close()
    const dependencyPath = join(dependencyEnvironment.root, 'domain', 'knowledge_base.json')
    const dependencyDocument = JSON.parse(await readFile(dependencyPath, 'utf8')) as {
      tables: { projects: Record<string, { entries: Record<string, unknown> }> }
    }
    delete dependencyDocument.tables.projects[dependencyEnvironment.project.id]!.entries.first
    await writeFile(dependencyPath, JSON.stringify(dependencyDocument, null, 2) + '\n')
    const dependencyReopened = await open(dependencyEnvironment.root)
    await expect(dependencyReopened.repository.check(dependencyEnvironment.project.id)).resolves.toMatchObject({ required: 2 })
  })
})

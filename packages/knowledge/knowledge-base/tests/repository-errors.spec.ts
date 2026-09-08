import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { KnowledgeRepository, renderEntry } from '../src/repository.ts'
import { canonicalHash } from '../src/model.ts'
import type { KnowledgeSeed } from '../src/model.ts'

const roots: string[] = []
const disposers: (() => Promise<void>)[] = []

function spec(id: string, seeds: KnowledgeSeed[] = [{
  id: 'prototype', title: '玩法原型', goal: '验证核心玩法', type: 'method' as const,
  depends: [], sourceIds: ['engine'], required: true,
}]) {
  return { id, title: '知识库错误契约', readerTask: '写出可验证的原型任务', language: 'zh-CN', seeds }
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-repository-errors-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(join(root, 'domain'))
  ctx.storage.backend.register('json', backend)
  const repository = await KnowledgeRepository.open(new DomainFacility(ctx, { backend: 'json' }), join(root, 'content'))
  disposers.push(async () => { await repository.close(); await backend.close(); await ctx.fiber.dispose() })
  return { root, repository }
}

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function prepared(projectId = 'game-vibe') {
  const { root, repository } = await harness()
  const project = spec(projectId)
  await repository.create(project)
  const source = await repository.ingest(projectId, {
    sourceId: 'engine', title: '资料', text: '先验证核心玩法。', fetchedAt: '2026-09-08T00:00:00.000Z',
  })
  await repository.confirmPlan(projectId, canonicalHash(project))
  return { root, repository, project, source }
}

function entry(snapshotId: string, id = 'prototype') {
  return {
    id, title: '玩法原型', type: 'method' as const, seedIds: [id], depends: [], related: [],
    conditions: '个人小型原型', body: '先制作可试玩的核心循环。',
    citations: [{ sourceId: 'engine', snapshotId, quote: '先验证核心玩法。' }],
  }
}

async function acceptGeneration(repository: KnowledgeRepository, projectId: string, snapshotId: string, workId = 'work-ok') {
  const stage = await repository.prepareStage(projectId, 'prototype', 'generate')
  await repository.bindStage(projectId, stage.id, workId)
  await repository.acceptResult(projectId, stage.id, JSON.stringify(entry(snapshotId)), { workId, attemptId: workId + '-attempt' })
  return stage
}

describe('KnowledgeRepository 错误路径公开契约', () => {
  it('拒绝未知项目、未知阶段和未绑定阶段的结果', async () => {
    const { repository, project, source } = await prepared('known-project')
    await expect(repository.prepareStage('missing', 'prototype', 'generate')).rejects.toThrow(/unknown project/)
    await expect(repository.bindStage(project.id, 'f'.repeat(64), 'work')).rejects.toThrow(/unknown stage/)
    const stage = await repository.prepareStage(project.id, 'prototype', 'generate')
    await expect(repository.acceptResult(project.id, stage.id, JSON.stringify(entry(source.snapshotId)), {
      workId: 'unbound-work', attemptId: 'unbound-attempt',
    })).rejects.toThrow(/owner mismatch/)
  })

  it('手改自身工作文件后拒绝生成准备', async () => {
    const { repository, project, source } = await prepared('own-edit')
    await acceptGeneration(repository, project.id, source.snapshotId)
    const directory = await repository.files.workingDirectory(project.id)
    await writeFile(join(directory, 'entries', 'prototype.md'), renderEntry({ ...entry(source.snapshotId), body: '人工修改。' }))
    await expect(repository.prepareStage(project.id, 'prototype', 'generate')).rejects.toThrow(/working entry changed/)
  })

  it('前置条目工作文件缺失或变化时拒绝生成准备', async () => {
    const { repository, root } = await harness()
    const project = spec('prerequisite-files', [
      { id: 'parent', title: '前置', goal: '前置知识', type: 'method' as const, depends: [], sourceIds: ['engine'], required: true },
      { id: 'child', title: '后续', goal: '后续知识', type: 'method' as const, depends: ['parent'], sourceIds: ['engine'], required: true },
    ])
    await repository.create(project)
    const source = await repository.ingest(project.id, {
      sourceId: 'engine', title: '资料', text: '先验证核心玩法。', fetchedAt: '2026-09-08T00:00:00.000Z',
    })
    await repository.confirmPlan(project.id, canonicalHash(project))
    const parent = await repository.prepareStage(project.id, 'parent', 'generate')
    await repository.bindStage(project.id, parent.id, 'parent-work')
    await repository.acceptResult(project.id, parent.id, JSON.stringify(entry(source.snapshotId, 'parent')), {
      workId: 'parent-work', attemptId: 'parent-attempt',
    })
    const path = join(root, 'content', 'projects', project.id, 'entries', 'parent.md')
    await unlink(path)
    await expect(repository.prepareStage(project.id, 'child', 'generate')).rejects.toThrow(/prerequisite.*working|prerequisite.*changed/i)
    await writeFile(path, renderEntry({ ...entry(source.snapshotId, 'parent'), body: '人工改写的前置。' }))
    await expect(repository.prepareStage(project.id, 'child', 'generate')).rejects.toThrow(/prerequisite.*working|prerequisite.*changed/i)
  })

  it('拒绝错误所有者，并对同一完成结果保持幂等', async () => {
    const { repository, project, source } = await prepared('owners')
    const stage = await repository.prepareStage(project.id, 'prototype', 'generate')
    await repository.bindStage(project.id, stage.id, 'right-work')
    const raw = JSON.stringify(entry(source.snapshotId))
    await expect(repository.acceptResult(project.id, stage.id, raw, { workId: 'wrong-work', attemptId: 'wrong-attempt' })).rejects.toThrow(/owner mismatch/)
    const first = await repository.acceptResult(project.id, stage.id, raw, { workId: 'right-work', attemptId: 'first-attempt' })
    const repeated = await repository.acceptResult(project.id, stage.id, raw, { workId: 'right-work', attemptId: 'second-attempt' })
    expect(repeated).toEqual(first)
  })

  it('计划输入变化和非法计划结果均拒绝且保留原响应', async () => {
    const invalid = ['null', '[]', '{}', '{"seeds":[],"extra":true}', '{"seeds":[{"id":"x","title":"x","goal":"x","type":"method","depends":[],"sourceIds":["missing"],"required":true}]}', '{"seeds":[]}']
    for (const [index, raw] of invalid.entries()) {
      const { repository } = await harness()
      const suffix = String(index)
      const project = spec('plan-invalid-' + suffix, [])
      await repository.create(project)
      await repository.ingest(project.id, { sourceId: 'engine', title: '资料', text: '资料。', fetchedAt: '2026-09-08T00:00:00.000Z' })
      const stage = await repository.prepareStage(project.id, 'plan', 'plan')
      await repository.bindStage(project.id, stage.id, 'plan-work-' + suffix)
      await expect(repository.acceptResult(project.id, stage.id, raw, { workId: 'plan-work-' + suffix, attemptId: 'attempt-' + suffix }))
        .rejects.toMatchObject({ name: 'KnowledgeResultValidationError' })
      const saved = repository.get(project.id).stages[stage.id]!
      expect(await repository.files.readArtifact(project.id, saved.responseHash!)).toBe(raw)
      expect(repository.get(project.id).spec.seeds).toEqual([])
    }
    const { repository, project } = await prepared('plan-stale')
    await repository.setPlan(project.id, [])
    const stage = await repository.prepareStage(project.id, 'plan', 'plan')
    await repository.bindStage(project.id, stage.id, 'plan-stale-work')
    await repository.ingest(project.id, { sourceId: 'engine', title: '新资料', text: '新资料。', fetchedAt: '2026-09-09T00:00:00.000Z' })
    await expect(repository.acceptResult(project.id, stage.id, '{"seeds":[]}', { workId: 'plan-stale-work', attemptId: 'plan-stale-attempt' }))
      .rejects.toThrow(/plan inputs became stale/)
  })

  it('生成结果的错误身份、伪造引文和错误来源版本均不写入条目', async () => {
    const cases = [
      (snapshotId: string) => ({ ...entry(snapshotId), id: 'other' }),
      (snapshotId: string) => ({ ...entry(snapshotId), citations: [{ sourceId: 'engine', snapshotId, quote: '资料中不存在的句子。' }] }),
      (_snapshotId: string) => ({ ...entry('a'.repeat(64)) }),
    ]
    for (const [index, create] of cases.entries()) {
      const suffix = String(index)
      const { repository, project, source } = await prepared('generate-invalid-' + suffix)
      const stage = await repository.prepareStage(project.id, 'prototype', 'generate')
      await repository.bindStage(project.id, stage.id, 'generate-work-' + suffix)
      await expect(repository.acceptResult(project.id, stage.id, JSON.stringify(create(source.snapshotId)), {
        workId: 'generate-work-' + suffix, attemptId: 'generate-attempt-' + suffix,
      })).rejects.toMatchObject({ name: 'KnowledgeResultValidationError' })
      expect(repository.get(project.id).entries.prototype).toBeUndefined()
    }
  })

  it('来源更新后拒绝旧生成输入', async () => {
    const { repository, project, source } = await prepared('generate-stale')
    const stage = await repository.prepareStage(project.id, 'prototype', 'generate')
    await repository.bindStage(project.id, stage.id, 'stale-work')
    await repository.ingest(project.id, { sourceId: 'engine', title: '新资料', text: '新版资料。', fetchedAt: '2026-09-09T00:00:00.000Z' })
    await expect(repository.acceptResult(project.id, stage.id, JSON.stringify(entry(source.snapshotId)), {
      workId: 'stale-work', attemptId: 'stale-attempt',
    })).rejects.toThrow(/stage input became stale/)
    expect(repository.get(project.id).entries.prototype).toBeUndefined()
  })

  it('adopt 拒绝缺失文件、错误身份和伪造引文', async () => {
    const { repository, project, source } = await prepared('adopt-invalid')
    await expect(repository.adopt(project.id, 'prototype')).rejects.toThrow(/working entry missing/)
    const directory = await repository.files.workingDirectory(project.id)
    const path = join(directory, 'entries', 'prototype.md')
    await writeFile(path, renderEntry({ ...entry(source.snapshotId), id: 'other' }))
    await expect(repository.adopt(project.id, 'prototype')).rejects.toThrow(/identity differs/)
    await writeFile(path, renderEntry({ ...entry(source.snapshotId), citations: [{ sourceId: 'engine', snapshotId: source.snapshotId, quote: '伪造引文。' }] }))
    await expect(repository.adopt(project.id, 'prototype')).rejects.toThrow(/citation_quote_missing/)
  })

  it('同一正式版本不能以新内容覆盖', async () => {
    const { repository, project, source } = await prepared('release-conflict')
    await acceptGeneration(repository, project.id, source.snapshotId, 'release-generate')
    const review = await repository.prepareStage(project.id, 'prototype', 'review')
    await repository.bindStage(project.id, review.id, 'release-review')
    await repository.acceptResult(project.id, review.id, '{"status":"pass","issues":[],"summary":"来源支持。"}', { workId: 'release-review', attemptId: 'release-review-attempt' })
    await repository.publish(project.id, 'v1')
    const directory = await repository.files.workingDirectory(project.id)
    await writeFile(join(directory, 'entries', 'prototype.md'), renderEntry({ ...entry(source.snapshotId), body: '新的人工内容。' }))
    await repository.adopt(project.id, 'prototype')
    const revised = await repository.prepareStage(project.id, 'prototype', 'review')
    await repository.bindStage(project.id, revised.id, 'release-review-2')
    await repository.acceptResult(project.id, revised.id, '{"status":"pass","issues":[],"summary":"来源支持。"}', { workId: 'release-review-2', attemptId: 'release-review-attempt-2' })
    await expect(repository.publish(project.id, 'v1')).rejects.toThrow(/release version already used|release already exists/)
  })

  it('setPlan 使已有条目 stale 并撤销确认', async () => {
    const { repository, project, source } = await prepared('set-plan-stale')
    await acceptGeneration(repository, project.id, source.snapshotId, 'set-plan-generate')
    await repository.setPlan(project.id, [{ ...project.seeds[0]!, goal: '修改后的目标' }])
    const record = repository.get(project.id)
    expect(record.approvedHash).toBeNull()
    expect(record.entries.prototype?.stale).toBe(true)
  })
})

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { KnowledgeRepository } from '../src/repository.ts'
import type { KnowledgeEntry } from '../src/model.ts'
import { canonicalHash } from '../src/model.ts'

const roots: string[] = []
const disposers: (() => Promise<void>)[] = []
const project = {
  id: 'recovery-errors', title: '恢复错误契约', readerTask: '验证恢复过程', language: 'zh-CN',
  seeds: [{ id: 'prototype', title: '原型', goal: '验证原型', type: 'method' as const, depends: [], sourceIds: ['engine'], required: true }],
}

interface DiskCandidate { entry: KnowledgeEntry; artifactHash: string; contentHash: string }
interface DiskStage {
  state: string
  workId: string | null
  owner: { workId: string; attemptId: string } | null
  responseHash: string | null
  candidate: DiskCandidate | null
}
interface DiskDocument { tables: { projects: Record<string, { stages: Record<string, DiskStage> }> } }

async function open(root?: string) {
  root ??= await mkdtemp(join(tmpdir(), 'knowledge-recovery-errors-'))
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
  disposers.push(close)
  return { root, repository, close }
}

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function response(snapshotId: string, body = '建立可试玩的核心循环。'): KnowledgeEntry {
  return {
    id: 'prototype', title: '原型', type: 'method', seedIds: ['prototype'], depends: [], related: [],
    conditions: '个人原型', body,
    citations: [{ sourceId: 'engine', snapshotId, quote: '先验证核心玩法。' }],
  }
}

async function candidate() {
  const environment = await open()
  const { repository } = environment
  await repository.create(project)
  const source = await repository.ingest(project.id, {
    sourceId: 'engine', title: '资料', text: '先验证核心玩法。', fetchedAt: '2026-09-08T00:00:00.000Z',
  })
  await repository.confirmPlan(project.id, canonicalHash(project))
  const stage = await repository.prepareStage(project.id, 'prototype', 'generate')
  await repository.bindStage(project.id, stage.id, 'recovery-work')
  vi.spyOn(repository.files, 'writeEntry').mockRejectedValueOnce(new Error('inject publishing interruption'))
  await expect(repository.acceptResult(project.id, stage.id, JSON.stringify(response(source.snapshotId)), {
    workId: 'recovery-work', attemptId: 'recovery-attempt',
  })).rejects.toThrow('inject publishing interruption')
  return { ...environment, source, stage }
}

function artifactPath(root: string, hash: string): string {
  return join(root, 'content', 'projects', project.id, 'artifacts', `${hash}.txt`)
}

async function mutateStage(root: string, stageId: string, mutate: (stage: DiskStage) => void): Promise<void> {
  const path = join(root, 'domain', 'knowledge_base.json')
  const document = JSON.parse(await readFile(path, 'utf8')) as DiskDocument
  const stage = document.tables.projects[project.id]?.stages[stageId]
  if (!stage) throw new Error('missing persisted test stage')
  mutate(stage)
  await writeFile(path, JSON.stringify(document, null, 2) + '\n')
}

describe('KnowledgeRepository 恢复证据错误契约', () => {
  it('恢复拒绝错误 work；无 receipt 或 candidate 时只返回 null', async () => {
    const environment = await open()
    const { repository } = environment
    await repository.create(project)
    await repository.ingest(project.id, { sourceId: 'engine', title: '资料', text: '先验证核心玩法。', fetchedAt: '2026-09-08T00:00:00.000Z' })
    await repository.confirmPlan(project.id, canonicalHash(project))
    const stage = await repository.prepareStage(project.id, 'prototype', 'generate')
    await repository.bindStage(project.id, stage.id, 'bound-work')
    await expect(repository.recoverStage(project.id, stage.id, 'other-work')).rejects.toThrow(/owner mismatch/)
    await expect(repository.recoverStage(project.id, stage.id, 'bound-work')).resolves.toBeNull()
  })

  it('恢复拒绝被损坏的原始响应或候选 artifact', async () => {
    for (const field of ['responseHash', 'candidate'] as const) {
      const { root, repository, stage, close } = await candidate()
      const saved = repository.get(project.id).stages[stage.id]!
      const hash = field === 'responseHash' ? saved.responseHash! : saved.candidate!.artifactHash
      await close()
      await writeFile(artifactPath(root, hash), '损坏的 artifact')
      const reopened = await open(root)
      await expect(reopened.repository.recoverStage(project.id, stage.id, 'recovery-work')).rejects.toThrow(/artifact hash mismatch/)
    }
  })

  it('恢复拒绝候选条目与其渲染 artifact 不一致', async () => {
    const { root, repository, source, stage, close } = await candidate()
    const changed = response(source.snapshotId, '候选条目已经被篡改。')
    const raw = JSON.stringify(changed)
    const replacement = await repository.files.putArtifact(project.id, raw)
    await close()
    await mutateStage(root, stage.id, (saved) => {
      if (!saved.candidate) throw new Error('missing candidate')
      saved.responseHash = replacement.hash
      saved.candidate.entry = changed
    })
    const reopened = await open(root)
    await expect(reopened.repository.recoverStage(project.id, stage.id, 'recovery-work')).rejects.toThrow(/recovery evidence mismatch/)
  })

  it('完成阶段要求 owner、receipt 与同一 work 的归属', async () => {
    const { root, stage, close } = await candidate()
    await close()
    await mutateStage(root, stage.id, (saved) => { saved.state = 'completed'; saved.owner = null; saved.responseHash = null })
    let reopened = await open(root)
    await expect(reopened.repository.completedStage(project.id, stage.id, 'recovery-work')).rejects.toThrow(/incomplete result provenance/)
    await reopened.close()
    await mutateStage(root, stage.id, (saved) => {
      saved.owner = { workId: 'foreign-work', attemptId: 'foreign-attempt' }
      saved.responseHash = 'a'.repeat(64)
    })
    reopened = await open(root)
    await expect(reopened.repository.completedStage(project.id, stage.id, 'recovery-work')).rejects.toThrow(/incomplete result provenance/)
  })

  it('已完成阶段恢复保持幂等', async () => {
    const environment = await open()
    const { repository } = environment
    await repository.create(project)
    const source = await repository.ingest(project.id, {
      sourceId: 'engine', title: '资料', text: '先验证核心玩法。', fetchedAt: '2026-09-08T00:00:00.000Z',
    })
    await repository.confirmPlan(project.id, canonicalHash(project))
    const stage = await repository.prepareStage(project.id, 'prototype', 'generate')
    await repository.bindStage(project.id, stage.id, 'complete-work')
    const raw = JSON.stringify(response(source.snapshotId))
    const accepted = await repository.acceptResult(project.id, stage.id, raw, { workId: 'complete-work', attemptId: 'complete-attempt' })
    await expect(repository.recoverStage(project.id, stage.id, 'complete-work')).resolves.toEqual(accepted)
    await expect(repository.completedStage(project.id, stage.id, 'complete-work')).resolves.toEqual(accepted)
  })
})

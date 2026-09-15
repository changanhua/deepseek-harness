import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { KnowledgeRepository } from '../src/repository.ts'
import { canonicalHash } from '../src/model.ts'

const roots: string[] = []
const closers: (() => Promise<void>)[] = []
const spec = { id: 'edge', title: '边界', readerTask: '完成任务', language: 'zh-CN', seeds: [{ id: 'entry', title: '条目', goal: '验证', type: 'method', depends: [], sourceIds: ['source'], required: true }] }
async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-edge-')); roots.push(root)
  const ctx = new Context(); await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(join(root, 'domain')); ctx.storage.backend.register('json', backend)
  const repo = await KnowledgeRepository.open(new DomainFacility(ctx, { backend: 'json' }), join(root, 'content'))
  closers.push(async () => { await repo.close(); await backend.close(); await ctx.fiber.dispose() })
  return repo
}
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('repository 边界状态', () => {
  it('记录失败会截断元数据，空必需集合的检查返回 null 覆盖率', async () => {
    const repo = await harness(); await repo.create({ ...spec, seeds: [] })
    await repo.recordSourceFailure('edge', 'source', 'x'.repeat(9000))
    expect(repo.get('edge').sourceAvailability.source?.message).toHaveLength(8000)
    expect((await repo.check('edge')).coverage).toBeNull()
  })
  it('完成的同一阶段重复准备返回固定输入', async () => {
    const repo = await harness(); await repo.create(spec)
    const source = await repo.ingest('edge', { sourceId: 'source', title: '来源', text: '验证。', fetchedAt: '2026-09-08T00:00:00.000Z' })
    await repo.confirmPlan('edge', canonicalHash(spec)); const stage = await repo.prepareStage('edge', 'entry', 'generate'); await repo.bindStage('edge', stage.id, 'work')
    await repo.acceptResult('edge', stage.id, JSON.stringify({ id: 'entry', title: '条目', type: 'method', seedIds: ['entry'], depends: [], related: [], conditions: '条件', body: '验证。', citations: [{ sourceId: 'source', snapshotId: source.snapshotId, quote: '验证。' }] }), { workId: 'work', attemptId: 'a' })
    expect(await repo.prepareStage('edge', 'entry', 'generate')).toEqual(stage)
  })
})

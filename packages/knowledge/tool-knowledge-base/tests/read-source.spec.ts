import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { canonicalHash, KnowledgeRepository } from '@changanhua/dsh-knowledge-base'
import { executeKnowledgeRequest } from '../src/index.ts'

const roots: string[] = []
const closers: (() => Promise<void>)[] = []

async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-read-source-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(join(root, 'domain'))
  ctx.storage.backend.register('json', backend)
  const repo = await KnowledgeRepository.open(new DomainFacility(ctx, { backend: 'json' }), join(root, 'content'))
  closers.push(async () => { await repo.close(); await backend.close(); await ctx.fiber.dispose() })
  await repo.create({ id: 'rules', title: '规则库', readerTask: '读取规则', language: 'zh-CN', seeds: [] })
  return repo
}

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('knowledge_base read-source', () => {
  it('从真实仓库按 Unicode 字符分页读取精确快照，并保留旧版本', async () => {
    const repo = await repository()
    const initialText = '规则😀模板甲乙丙'
    const first = await repo.ingest('rules', {
      sourceId: 'manual', title: '规则模板', text: initialText, fetchedAt: '2026-09-27T00:00:00.000Z',
    })
    expect(first.snapshotId).toBe(canonicalHash(initialText))
    const signal = new AbortController().signal
    const deps = { repository: repo, queue: {} } as never

    const pages = await Promise.all([0, 2, 4, 6].map(offset => executeKnowledgeRequest({
      action: 'read-source', projectId: 'rules', sourceId: 'manual', snapshotId: first.snapshotId, offset, limit: 2,
    }, deps, signal))) as Array<{ text: string; nextOffset?: number; totalCharacters: number }>
    expect(pages.map(page => page.text).join('')).toBe(initialText)
    expect(pages[0]).toMatchObject({ projectId: 'rules', sourceId: 'manual', snapshotId: first.snapshotId, title: '规则模板', offset: 0, totalCharacters: Array.from(initialText).length, nextOffset: 2 })
    expect(pages.at(-1)?.nextOffset).toBeUndefined()

    const second = await repo.ingest('rules', {
      sourceId: 'manual', title: '新版规则模板', text: '新版规则', fetchedAt: '2026-09-27T00:01:00.000Z',
    })
    expect(second.snapshotId).not.toBe(first.snapshotId)
    await expect(executeKnowledgeRequest({ action: 'read-source', projectId: 'rules', sourceId: 'manual' }, deps, signal))
      .resolves.toMatchObject({ snapshotId: second.snapshotId, title: '新版规则模板', text: '新版规则' })
    await expect(executeKnowledgeRequest({ action: 'read-source', projectId: 'rules', sourceId: 'manual', snapshotId: first.snapshotId }, deps, signal))
      .resolves.toMatchObject({ snapshotId: first.snapshotId, text: initialText })

    await expect(executeKnowledgeRequest({ action: 'read-source', projectId: 'absent', sourceId: 'manual' }, deps, signal)).rejects.toThrow('knowledge-base: unknown project: absent')
    await expect(executeKnowledgeRequest({ action: 'read-source', projectId: 'rules', sourceId: 'absent' }, deps, signal)).rejects.toThrow('knowledge-base: source missing: absent')
    await expect(executeKnowledgeRequest({ action: 'read-source', projectId: 'rules', sourceId: 'manual', snapshotId: 'a'.repeat(64) }, deps, signal)).rejects.toThrow('knowledge-base: source snapshot missing: manual:' + 'a'.repeat(64))
    await expect(executeKnowledgeRequest({ action: 'read-source', projectId: 'rules', sourceId: 'manual', offset: -1 }, deps, signal)).rejects.toThrow()
    await expect(executeKnowledgeRequest({ action: 'read-source', projectId: 'rules', sourceId: 'manual', limit: 8193 }, deps, signal)).rejects.toThrow()
  })
})

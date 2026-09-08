import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import KnowledgeBaseService from '../src/index.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('KnowledgeBaseService', () => {
  it('要求绝对受管根，并通过组合的 storageDomain 暴露唯一仓库', async () => {
    const root = await mkdtemp(join(tmpdir(), 'knowledge-base-service-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(Storage)
    const backend = new JsonStorageBackend(join(root, 'domain'))
    ctx.storage.backend.register('json', backend)
    const facility = new DomainFacility(ctx, { backend: 'json' })
    ctx.provide('storageDomain', facility)
    await ctx.plugin(KnowledgeBaseService, { root: join(root, 'content') })
    expect(ctx.knowledgeBase.repository).toBeDefined()
    await ctx.knowledgeBase.repository.create({
      id: 'project', title: '项目', readerTask: '完成任务', language: 'zh-CN', seeds: [],
    })
    expect(ctx.knowledgeBase.repository.list()).toEqual([expect.objectContaining({ id: 'project' })])
    await ctx.fiber.dispose()
    await backend.close()
  })
})

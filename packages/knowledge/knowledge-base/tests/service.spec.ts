import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import KnowledgeBaseService from '../src/index.ts'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('KnowledgeBaseService', () => {
  it('思源配置不会绕过缺少工具或 MCP 注册的错误', async () => {
    const root = await mkdtemp(join(tmpdir(), 'knowledge-service-siyuan-')); roots.push(root)
    const ctx = new Context()
    await ctx.plugin(Storage)
    const backend = new JsonStorageBackend(join(root, 'domain'))
    ctx.storage.backend.register('json', backend)
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json' }))
    await ctx.plugin(KnowledgeBaseService, { root: join(root, 'content'), siyuan: { serverName: 'absent', notebook: 'test', rootPath: '/知识' } })
    const project = { projectId: 'remote', title: '远端', readerTask: '阅读', version: 'v1', entries: [], sources: [] }
    try {
      await expect(ctx.knowledgeBase.siyuan!.sync(project, new AbortController().signal)).rejects.toThrow('requires the configured MCP tools')
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(Tools)
      await expect(ctx.knowledgeBase.siyuan!.sync(project, new AbortController().signal)).rejects.toThrow('unknown tool')
    } finally {
      await ctx.fiber.dispose()
      await backend.close()
    }
  })
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

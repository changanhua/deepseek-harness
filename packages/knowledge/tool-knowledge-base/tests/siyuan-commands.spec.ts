import { describe, expect, it } from 'vitest'
import type { KnowledgeEntry, KnowledgeSiyuanProjection, SiyuanProjectInput } from '@changanhua/dsh-knowledge-base'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createKnowledgeTool, executeKnowledgeRequest } from '../src/index.ts'

const hash = (letter: string): string => letter.repeat(64)
const signal = new AbortController().signal
const entry: KnowledgeEntry = {
  id: 'scope', title: '玩法范围', type: 'method', seedIds: ['scope'], depends: [], related: [],
  conditions: '适用于单人原型。', body: '先实现一个可试玩循环。',
  citations: [{ sourceId: 'manual', snapshotId: 'source-v1', quote: '先验证核心循环。' }],
}
const release: SiyuanProjectInput = {
  projectId: 'game', title: '游戏原型', readerTask: '完成首次试玩', version: 'v1', entries: [entry],
  sources: [{ sourceId: 'manual', snapshotId: 'source-v1', title: '手册' }],
}

function executionContext(): ToolRunContext {
  return {
    callId: 'siyuan-test', rootCallId: 'siyuan-test', token: 'token', name: 'knowledge_base', arguments: {}, signal,
    agent: {} as ToolRunContext['agent'], deferContext: () => {}, concludeTurn: () => {},
  } as unknown as ToolRunContext
}

describe('知识工具的思源请求', () => {
  it('将正式发布版传给同步，并把状态压缩为映射和候选文档 ID', async () => {
    let published: [string, string] | undefined
    let synchronized: SiyuanProjectInput | undefined
    const projection = {
      sync: async (input: SiyuanProjectInput, receivedSignal: AbortSignal) => {
        synchronized = input
        expect(receivedSignal).toBe(signal)
        return { createdEntries: ['scope'], candidates: [], conflicts: [], complete: true, rootDocumentId: 'root-doc' }
      },
      status: (projectId: string) => {
        expect(projectId).toBe('game')
        return {
          currentVersion: 'v1', targetVersion: 'v2', root: { documentId: 'root-doc' },
          entries: { scope: { documentId: 'scope-doc', candidates: { [hash('c')]: { documentId: 'candidate-doc' } } } },
          intents: { 'entry:scope': { markdown: 'must not be returned' } },
        }
      },
    }
    const deps = {
      repository: { publication: async (projectId: string, version: string) => {
        published = [projectId, version]
        return release
      } },
      queue: {}, siyuan: projection,
    }

    await expect(executeKnowledgeRequest({ action: 'siyuan-sync', projectId: 'game', version: 'v1' }, deps as never, signal))
      .resolves.toMatchObject({ createdEntries: ['scope'], rootDocumentId: 'root-doc' })
    expect(published).toEqual(['game', 'v1'])
    expect(synchronized).toBe(release)
    await expect(executeKnowledgeRequest({ action: 'siyuan-status', projectId: 'game' }, deps as never, signal))
      .resolves.toEqual({ projectId: 'game', currentVersion: 'v1', targetVersion: 'v2', rootDocumentId: 'root-doc',
        entries: [{ id: 'scope', documentId: 'scope-doc', candidates: ['candidate-doc'] }] })
  })

  it('返回实时核验和检查结果，并以检查时的快照接纳远端编辑', async () => {
    let accepted: [string, string, string] | undefined
    let adopted: [string, string, KnowledgeEntry, string] | undefined
    const remote = { ...entry, title: '人工改写的玩法范围', body: '先让玩家完成一次循环。' }
    const projection = {
      verify: async (projectId: string, receivedSignal: AbortSignal) => {
        expect(projectId).toBe('game')
        expect(receivedSignal).toBe(signal)
        return { documents: 1, searchable: true, conflicts: [], complete: true }
      },
      inspect: async (projectId: string, entryId: string, receivedSignal: AbortSignal) => {
        expect([projectId, entryId, receivedSignal]).toEqual(['game', 'scope', signal])
        return { entry: remote, snapshotHash: hash('b'), documentId: 'scope-doc' }
      },
      accept: async (
        projectId: string, entryId: string, snapshotHash: string,
        callback: (value: KnowledgeEntry) => Promise<void>, receivedSignal: AbortSignal,
      ): Promise<void> => {
        accepted = [projectId, entryId, snapshotHash]
        expect(receivedSignal).toBe(signal)
        await callback(remote)
      },
    }
    const deps = {
      repository: {
        get: (projectId: string) => {
          expect(projectId).toBe('game')
          return { entries: { scope: { contentHash: hash('d') } } }
        },
        adoptRemote: async (projectId: string, entryId: string, value: KnowledgeEntry, priorHash: string): Promise<void> => {
          adopted = [projectId, entryId, value, priorHash]
        },
      },
      queue: {}, siyuan: projection,
    }

    await expect(executeKnowledgeRequest({ action: 'siyuan-verify', projectId: 'game' }, deps as never, signal))
      .resolves.toEqual({ documents: 1, searchable: true, conflicts: [], complete: true })
    await expect(executeKnowledgeRequest({ action: 'siyuan-inspect', projectId: 'game', entryId: 'scope' }, deps as never, signal))
      .resolves.toEqual({ entry: remote, snapshotHash: hash('b'), documentId: 'scope-doc' })
    await expect(executeKnowledgeRequest({ action: 'siyuan-adopt', projectId: 'game', entryId: 'scope', snapshotHash: hash('b') }, deps as never, signal))
      .resolves.toEqual({ projectId: 'game', entryId: 'scope', reviewRequired: true })
    expect(accepted).toEqual(['game', 'scope', hash('b')])
    expect(adopted).toEqual(['game', 'scope', remote, hash('d')])
  })

  it('在未配置思源或本地没有条目时拒绝各请求，并阻止模型写入', async () => {
    const withoutSiyuan = { repository: { get: () => ({ entries: {} }) }, queue: {} }
    for (const request of [
      { action: 'siyuan-sync', projectId: 'game', version: 'v1' },
      { action: 'siyuan-status', projectId: 'game' },
      { action: 'siyuan-verify', projectId: 'game' },
      { action: 'siyuan-inspect', projectId: 'game', entryId: 'scope' },
      { action: 'siyuan-adopt', projectId: 'game', entryId: 'scope', snapshotHash: hash('b') },
    ]) await expect(executeKnowledgeRequest(request, withoutSiyuan as never, signal)).rejects.toThrow('未配置思源')

    const missing = { repository: { get: () => ({ entries: {} }) }, queue: {}, siyuan: {} }
    await expect(executeKnowledgeRequest({ action: 'siyuan-adopt', projectId: 'game', entryId: 'scope', snapshotHash: hash('b') }, missing as never, signal))
      .rejects.toThrow('条目不存在')

    const tool = createKnowledgeTool({ repository: {}, queue: {}, siyuan: {} as KnowledgeSiyuanProjection } as never)
    for (const request of [
      { action: 'siyuan-sync', projectId: 'game', version: 'v1' },
      { action: 'siyuan-adopt', projectId: 'game', entryId: 'scope', snapshotHash: hash('b') },
    ]) await expect(tool.execute({ request: JSON.stringify(request) }, executionContext())).rejects.toThrow('人类命令')
  })
})

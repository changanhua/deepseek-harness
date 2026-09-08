import { writeFile } from 'node:fs/promises'
import { executeKnowledgeRequest } from '../../lib/index.js'

export const name = 'knowledge-siyuan-acceptance'
export const inject = ['knowledgeBase', 'knowledgeQueue', 'tools']
export function apply(ctx, config) {
  void (async () => {
    await ctx.loader.await()
    const repo = ctx.knowledgeBase.repository
    const deps = { repository: repo, queue: ctx.knowledgeQueue, siyuan: ctx.knowledgeBase.siyuan }
    const signal = new AbortController().signal
    let result
    if (config.action === 'inspect') {
      const input = await repo.publication(config.projectId, config.version)
      result = { projectId: input.projectId, title: input.title, entries: input.entries.length, sources: input.sources.length }
    } else if (config.action === 'sync') {
      result = await executeKnowledgeRequest({ action: 'siyuan-sync', projectId: config.projectId, version: config.version }, deps, signal)
    } else if (config.action === 'verify') {
      result = await executeKnowledgeRequest({ action: 'siyuan-verify', projectId: config.projectId }, deps, signal)
    } else throw new Error('unknown acceptance action')
    if (config.action !== 'inspect') {
      await writeFile(config.stateOutput, JSON.stringify(deps.siyuan.status(config.projectId), null, 2))
    }
    await writeFile(config.output, JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
    ctx.get('appExit')(result.complete === false ? 1 : 0)
  })().catch(async error => {
    await writeFile(config.output, JSON.stringify({ error: String(error), stack: error.stack }, null, 2))
    console.error(error)
    ctx.get('appExit')(1)
  })
}

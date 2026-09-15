import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as KnowledgeInvariant from '../src/invariant.ts'
import { projectRecordSchema } from '../src/state.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(KnowledgeInvariant)
  return ctx
}

const project = projectRecordSchema.parse({
  spec: { id: 'project', title: '项目', readerTask: '完成任务', language: 'zh-CN', seeds: [] },
  approvedHash: null, sources: {}, latestSources: {}, sourceAvailability: {}, entries: {}, stages: {}, releases: {}, currentRelease: null,
})

function change(table: string, key: string, value: unknown, domain = 'knowledge_base') {
  return { domain, table, key, operation: 'put', value }
}

describe('knowledge-base 持久不变量', () => {
  it('接受有效控制和项目写入，忽略外域及删除事件', async () => {
    const ctx = await setup()
    expect(() =>{  ctx.emit('domain/changed', change('control', 'codex', { stopped: null }) as never) }).not.toThrow()
    expect(() =>{  ctx.emit('domain/changed', change('projects', 'project', project) as never) }).not.toThrow()
    expect(() =>{  ctx.emit('domain/changed', change('projects', 'other', project, 'other') as never) }).not.toThrow()
    expect(() =>{  ctx.emit('domain/changed', { ...change('projects', 'project', project), operation: 'deleted' } as never) }).not.toThrow()
  })

  it('拒绝无效控制、无效项目与项目键身份不一致', async () => {
    const ctx = await setup()
    expect(() =>{  ctx.emit('domain/changed', change('control', 'not-codex', { stopped: null }) as never) }).toThrow(/control/)
    expect(() =>{  ctx.emit('domain/changed', change('projects', 'project', {}) as never) }).toThrow(/schema/)
    expect(() =>{  ctx.emit('domain/changed', change('projects', 'another', project) as never) }).toThrow(/identity/)
  })

  it('完成阶段必须携带同一 Queue 工作的响应归属', async () => {
    const ctx = await setup()
    const digest = 'a'.repeat(64)
    const completed = projectRecordSchema.parse({
      ...project,
      stages: { [digest]: {
        prepared: { id: digest, projectId: 'project', entryId: 'entry', action: 'generate', inputHash: digest, expectedHash: null, prompt: 'p' },
        workId: 'work', owner: { workId: 'work', attemptId: 'attempt' }, responseHash: digest,
        candidate: null, decision: null, execution: null, state: 'completed',
      } },
    })
    expect(() =>{  ctx.emit('domain/changed', change('projects', 'project', completed) as never) }).not.toThrow()
    expect(() =>{  ctx.emit('domain/changed', change('projects', 'project', {
      ...completed, stages: { [digest]: { ...completed.stages[digest]!, owner: null } },
    }) as never) }).toThrow(/completed stage/)
    expect(() =>{  ctx.emit('domain/changed', change('projects', 'project', {
      ...completed, stages: { [digest]: { ...completed.stages[digest]!, prepared: {
        ...completed.stages[digest]!.prepared, id: 'b'.repeat(64), projectId: 'another',
      } } },
    }) as never) }).toThrow(/stage is bound/)
  })
})

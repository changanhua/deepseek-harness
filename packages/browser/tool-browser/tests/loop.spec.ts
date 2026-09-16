import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import BrowserTaskService from '@changanhua/dsh-browser-task'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { BrowserActionResult, BrowserOperation } from '@changanhua/dsh-browser'
import { executeObserved } from '../src/index.ts'
import { BrowserTaskLoop, MAX_ACTIONS, MAX_STEPS } from '../src/loop.ts'

const page = { tabId: 4, frameId: 0, documentId: 'first', url: 'https://example.test/first' }
type PresentationObservation = { mountId:string;text:string;present:boolean }
const instance = { installationId: 'extension', extensionId: 'test', online: true, grantEpoch: 1, origins: ['https://example.test'], scopes: ['browser:read'], capabilities: { protocolVersion: 1 as const, actionKinds: ['snapshot', 'click'] as const, requestRecovery: true as const } }
async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(BrowserTaskService)
  const session = ctx.sessions.create(SessionId(`loop-${Math.random()}`)); session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '完成页面任务' }] }), { surfaceOp: 'append' })
  const agent = { id: session.id, options: {}, session, ctx, status: 'idle', inbox: { append() {}, remove() { return false }, nextStep: [] }, send() {}, followup() {}, steer() {}, inject: vi.fn(), cancel() {}, runMaintenance(fn: (signal: AbortSignal) => unknown) { return fn(new AbortController().signal) }, whenIdle() { return Promise.resolve() } } as unknown as Agent
  ctx.agents.register(agent)
  const browser = { instances: vi.fn(async () => [instance]), execute: vi.fn(async (operation: BrowserOperation): Promise<BrowserActionResult> => ({ requestId: operation.requestId, sessionId: operation.sessionId, installationId: operation.installationId, outcome: 'observed', delivery: 'sent', value: { page, text: 'Done', elements: [] } })) }
  return { ctx, agent, browser, loop: new BrowserTaskLoop(browser, ctx.browserTasks) }
}

describe('BrowserTaskLoop durable bridge', () => {
  it('starts a task with an explicit region presentation condition', async () => {
    const h = await harness()
    await h.loop.start(h.agent, { installationId: 'extension', page, goal: '展示分析',
      success: { region: { mountId: 'analysis-panel', text: '证据分歧' } } }, new AbortController().signal)
    expect(h.ctx.browserTasks.get(h.agent)?.acceptance).toEqual([
      { id: 'region', kind: 'region-content', resourceId: 'analysis-panel', text: '证据分歧' },
    ])
    await h.ctx.fiber.dispose()
  })
  it('verifies rendered region content before cleanup and retains that proof through restore', async () => {
    const h = await harness(); let visibleText='原页面'; let presentations:PresentationObservation[]=[]
    h.browser.execute.mockImplementation(async(operation:BrowserOperation)=>({ requestId:operation.requestId,sessionId:h.agent.session.id,
      installationId:'extension',outcome:'observed' as const,delivery:'sent' as const,value:{ page,text:visibleText,elements:[],presentations } }))
    await h.loop.start(h.agent,{ installationId:'extension',page,goal:'展示分析',
      success:{ region:{ mountId:'analysis-panel',text:'证据分歧' } } },new AbortController().signal)
    const render={ kind:'region_render' as const,page,mountId:'analysis-panel',selector:'#sidebar',blocks:[{ type:'text' as const,text:'证据分歧' }] }
    h.loop.planned(h.agent,{ sessionId:h.agent.session.id,installationId:'extension',requestId:'render',action:render });h.loop.reserveResource(h.agent,'analysis-panel');h.loop.dispatched(h.agent,'render')
    const rendered={ requestId:'render',sessionId:h.agent.session.id,installationId:'extension',outcome:'observed' as const,delivery:'sent' as const,value:{ rendered:1,containers:1 } }
    const renderSettlement=h.loop.settle(h.agent,rendered,render)!
    h.loop.settleResource(h.agent,'analysis-panel',rendered,render,renderSettlement.receipt)
    expect(h.ctx.browserTasks.get(h.agent)?.resources[0]).toMatchObject({ state:'active',presentation:{ excerpt:'证据分歧',renderReceipt:renderSettlement.receipt } })
    visibleText='证据分歧';presentations=[{ mountId:'analysis-panel',text:'证据分歧',present:true }]
    await h.loop.verify(h.agent,new AbortController().signal)
    const presentation = h.ctx.browserTasks.get(h.agent)?.resources[0]?.presentation
    expect(presentation?.evidenceId).toMatch(/^evidence-/u)
    const clear={ kind:'region_clear' as const,page,mountId:'analysis-panel' }
    h.loop.releasePending(h.agent,'analysis-panel');h.loop.planned(h.agent,{ sessionId:h.agent.session.id,installationId:'extension',requestId:'clear',action:clear });h.loop.dispatched(h.agent,'clear')
    const cleared={ requestId:'clear',sessionId:h.agent.session.id,installationId:'extension',outcome:'observed' as const,delivery:'sent' as const,value:{ cleared:true } }
    const clearSettlement=h.loop.settle(h.agent,cleared,clear)!
    h.loop.settleResource(h.agent,'analysis-panel',cleared,clear,clearSettlement.receipt)
    visibleText='原页面';presentations=[]
    const verified=await h.loop.verify(h.agent,new AbortController().signal)
    expect({ verified,task:h.ctx.browserTasks.get(h.agent) }).toMatchObject({ verified:{ status:'verified' } })
    await h.ctx.fiber.dispose()
  })
  it('signs the bounded requested region text even when it appears after the old preview boundary', async () => {
    const h = await harness(); const prefix = '前'.repeat(160); const expected = '后部证据'; let visibleText = '原页面'; let presentations:PresentationObservation[]=[]
    h.browser.execute.mockImplementation(async (operation: BrowserOperation) => ({ requestId: operation.requestId,
      sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed' as const, delivery: 'sent' as const,
      value: { page, text: visibleText, elements: [], presentations } }))
    await h.loop.start(h.agent, { installationId: 'extension', page, goal: '展示分析',
      success: { region: { mountId: 'analysis-panel', text: expected } } }, new AbortController().signal)
    const render = { kind: 'region_render' as const, page, mountId: 'analysis-panel', selector: '#sidebar',
      blocks: [{ type: 'text' as const, text: prefix + expected }] }
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'late-render', action: render })
    h.loop.reserveResource(h.agent, 'analysis-panel'); h.loop.dispatched(h.agent, 'late-render')
    const rendered = { requestId: 'late-render', sessionId: h.agent.session.id, installationId: 'extension',
      outcome: 'observed' as const, delivery: 'sent' as const, value: { rendered: 1 } }
    const settled = h.loop.settle(h.agent, rendered, render)!
    h.loop.settleResource(h.agent, 'analysis-panel', rendered, render, settled.receipt)
    expect(h.ctx.browserTasks.get(h.agent)?.resources[0]?.presentation?.excerpt).toBe(expected)
    visibleText = prefix + expected; presentations=[{ mountId:'analysis-panel',text:expected,present:true }]
    await h.loop.verify(h.agent, new AbortController().signal)
    expect(h.ctx.browserTasks.get(h.agent)?.evaluations).toMatchObject([{ clauseId: 'region', satisfied: true }])
    await h.ctx.fiber.dispose()
  })
  it('does not sign a render acknowledgement whose blocks omit the requested region content', async () => {
    const h = await harness()
    await h.loop.start(h.agent, { installationId: 'extension', page, goal: '展示分析',
      success: { region: { mountId: 'analysis-panel', text: '必须出现' } } }, new AbortController().signal)
    const render = { kind: 'region_render' as const, page, mountId: 'analysis-panel', selector: '#sidebar',
      blocks: [{ type: 'text' as const, text: '别的内容' }] }
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'wrong-render', action: render })
    h.loop.reserveResource(h.agent, 'analysis-panel'); h.loop.dispatched(h.agent, 'wrong-render')
    const rendered = { requestId: 'wrong-render', sessionId: h.agent.session.id, installationId: 'extension',
      outcome: 'observed' as const, delivery: 'sent' as const, value: { rendered: 1 } }
    const settled = h.loop.settle(h.agent, rendered, render)!
    h.loop.settleResource(h.agent, 'analysis-panel', rendered, render, settled.receipt)
    expect(h.ctx.browserTasks.get(h.agent)?.resources[0]?.presentation).toBeUndefined()
    await h.ctx.fiber.dispose()
  })
  it('recovers an unknown region render from request status without repeating it, then verifies and clears its proof', async () => {
    const h = await harness(); let visibleText = '原页面'; let presentations:PresentationObservation[]=[]
    h.browser.execute.mockImplementation(async (operation: BrowserOperation) => ({ requestId: operation.requestId,
      sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed' as const, delivery: 'sent' as const,
      value: { page, text: visibleText, elements: [], presentations } }))
    await h.loop.start(h.agent, { installationId: 'extension', page, goal: '展示分析',
      success: { region: { mountId: 'analysis-panel', text: '恢复后的证据' } } }, new AbortController().signal)
    const render = { kind: 'region_render' as const, page, mountId: 'analysis-panel', selector: '#sidebar',
      blocks: [{ type: 'text' as const, text: '恢复后的证据' }] }
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'unknown-render', action: render })
    h.loop.reserveResource(h.agent, 'analysis-panel'); h.loop.dispatched(h.agent, 'unknown-render')
    const unknown = { requestId: 'unknown-render', sessionId: h.agent.session.id, installationId: 'extension',
      outcome: 'unknown' as const, delivery: 'sent' as const }
    const settlement = h.loop.settle(h.agent, unknown, render)!
    h.loop.settleResource(h.agent, 'analysis-panel', unknown, render, settlement.receipt)
    h.loop.reconcile(h.agent, 'unknown-render', { ...unknown, quiescent: true, outcome: 'observed', value: { rendered: 1 } })
    expect(h.ctx.browserTasks.get(h.agent)?.resources[0]).toMatchObject({ state: 'active', presentation: { excerpt: '恢复后的证据' } })
    visibleText = '恢复后的证据';presentations=[{ mountId:'analysis-panel',text:'恢复后的证据',present:true }]
    await h.loop.verify(h.agent, new AbortController().signal)
    const clear = { kind: 'region_clear' as const, page, mountId: 'analysis-panel' }
    h.loop.releasePending(h.agent, 'analysis-panel'); h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'clear-recovered', action: clear }); h.loop.dispatched(h.agent, 'clear-recovered')
    const cleared = { requestId: 'clear-recovered', sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed' as const, delivery: 'sent' as const, value: { cleared: true } }
    const clearSettlement = h.loop.settle(h.agent, cleared, clear)!
    h.loop.settleResource(h.agent, 'analysis-panel', cleared, clear, clearSettlement.receipt)
    visibleText = '原页面';presentations=[]
    expect(await h.loop.verify(h.agent, new AbortController().signal)).toMatchObject({ status: 'verified' })
    expect(h.browser.execute.mock.calls.filter(([operation]) => operation.action.kind === 'region_render')).toHaveLength(0)
    await h.ctx.fiber.dispose()
  })
  it('does not verify region content from identical text outside the mounted DSH panel',async()=>{
    const h=await harness();let presentations:PresentationObservation[]=[]
    h.browser.execute.mockImplementation(async(operation:BrowserOperation)=>({ requestId:operation.requestId,
      sessionId:h.agent.session.id,installationId:'extension',outcome:'observed' as const,delivery:'sent' as const,
      value:{ page,text:'原页面已经包含证据分歧',elements:[],presentations } }))
    await h.loop.start(h.agent,{ installationId:'extension',page,goal:'展示分析',
      success:{ region:{ mountId:'analysis-panel',text:'证据分歧' } } },new AbortController().signal)
    const render={ kind:'region_render' as const,page,mountId:'analysis-panel',selector:'#sidebar',blocks:[{ type:'text' as const,text:'证据分歧' }] }
    h.loop.planned(h.agent,{ sessionId:h.agent.session.id,installationId:'extension',requestId:'same-text',action:render })
    h.loop.reserveResource(h.agent,'analysis-panel');h.loop.dispatched(h.agent,'same-text')
    const rendered={ requestId:'same-text',sessionId:h.agent.session.id,installationId:'extension',outcome:'observed' as const,delivery:'sent' as const,value:{ rendered:1 } }
    const settled=h.loop.settle(h.agent,rendered,render)!
    h.loop.settleResource(h.agent,'analysis-panel',rendered,render,settled.receipt)
    await h.loop.verify(h.agent,new AbortController().signal)
    expect(h.ctx.browserTasks.get(h.agent)?.evaluations).toMatchObject([{ clauseId:'region',satisfied:false }])
    presentations=[{ mountId:'analysis-panel',text:'证据分歧',present:true }]
    await h.loop.verify(h.agent,new AbortController().signal)
    expect(h.ctx.browserTasks.get(h.agent)?.evaluations).toMatchObject([{ clauseId:'region',satisfied:true }])
    await h.ctx.fiber.dispose()
  })
  it('records caller identity and planned attempt in Session before provider dispatch', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Done' } }, new AbortController().signal)
    const before = h.ctx.browserTasks.get(h.agent)!; const requestId = 'caller-minted'; h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId, action: { kind: 'click', element: { page, snapshotId: 's', elementId: 'go' }, intent: 'go' } })
    const after = h.ctx.browserTasks.get(h.agent)!
    expect(after.attempts.find(item => item.requestId === requestId)).toMatchObject({ attemptId: requestId, stage: 'planned' })
    expect(after.budget.actionsUsed).toBe(before.budget.actionsUsed + 1)
    await h.ctx.fiber.dispose()
  })
  it('accepts only an observed exact absent disposition as a vanished region receipt', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId:'extension',page,goal:'cleanup',success:{ text:'Never' } }, new AbortController().signal)
    const render={ kind:'region_render' as const,page,mountId:'panel',selector:'#sidebar',blocks:[{ type:'text' as const,text:'x' }] }
    h.loop.planned(h.agent,{ sessionId:h.agent.session.id,installationId:'extension',requestId:'render-absent',action:render });h.loop.reserveResource(h.agent,'panel');h.loop.dispatched(h.agent,'render-absent')
    const rendered={ requestId:'render-absent',sessionId:h.agent.session.id,installationId:'extension',outcome:'observed' as const,delivery:'sent' as const,value:{ rendered:1 } }
    const renderReceipt=h.loop.settle(h.agent,rendered,render)!
    h.loop.settleResource(h.agent,'panel',rendered,render,renderReceipt.receipt)
    const clear={ kind:'region_clear' as const,page,mountId:'panel' }
    h.loop.releasePending(h.agent,'panel');h.loop.planned(h.agent,{ sessionId:h.agent.session.id,installationId:'extension',requestId:'clear-absent',action:clear });h.loop.dispatched(h.agent,'clear-absent')
    const absent={ requestId:'clear-absent',sessionId:h.agent.session.id,installationId:'extension',outcome:'observed' as const,delivery:'sent' as const,value:{ disposition:'absent',cleared:false } }
    const settlement=h.loop.settle(h.agent,absent,clear)!
    h.loop.settleResource(h.agent,'panel',absent,clear,settlement.receipt)
    expect(h.ctx.browserTasks.get(h.agent)?.resources[0]).toMatchObject({ state:'vanished',disposition:'absent',dispositionSource:settlement.receipt })
    await h.ctx.fiber.dispose()
  })
  it('does not call a not-sent document replacement a vanished resource', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId:'extension',page,goal:'cleanup',success:{ text:'Never' } }, new AbortController().signal)
    const render={ kind:'region_render' as const,page,mountId:'panel',selector:'#sidebar',blocks:[{ type:'text' as const,text:'x' }] }
    h.loop.planned(h.agent,{ sessionId:h.agent.session.id,installationId:'extension',requestId:'render-unsent',action:render });h.loop.reserveResource(h.agent,'panel')
    const unsent={ requestId:'render-unsent',sessionId:h.agent.session.id,installationId:'extension',outcome:'failed' as const,delivery:'not-sent' as const,reason:'document_replaced' }
    const settlement=h.loop.settle(h.agent,unsent,render)!
    h.loop.settleResource(h.agent,'panel',unsent,render,settlement.receipt)
    expect(h.ctx.browserTasks.get(h.agent)?.resources[0]).toMatchObject({ state:'released',disposition:'not-sent' })
    await h.ctx.fiber.dispose()
  })
  it('appends an execution receipt before settling the durable attempt', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const requestId = 'receipt-order'; const action = { kind: 'click' as const, element: { page, snapshotId: 's', elementId: 'go' }, intent: 'go' }
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId, action }); h.loop.dispatched(h.agent, requestId)
    h.loop.settle(h.agent, { requestId, sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent' }, action)
    const receipt = h.agent.session.events.find(event => event.type === 'browser-task/receipt' && event.data.requestId === requestId)!
    const settled = h.agent.session.events.find(event => event.type === 'browser-task/change' && event.data.task.attempts.some((item: { requestId: string; stage: string }) => item.requestId === requestId && item.stage === 'settled'))!
    expect(receipt.seq).toBeLessThan(settled.seq)
    await h.ctx.fiber.dispose()
  })
  it('settles a not-sent provider result without inventing a dispatched transition', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const requestId = 'not-sent'; const action = { kind: 'click' as const, element: { page, snapshotId: 's', elementId: 'go' }, intent: 'go' }
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId, action })
    h.loop.settle(h.agent, { requestId, sessionId: h.agent.session.id, installationId: 'extension', outcome: 'failed', delivery: 'not-sent', reason: 'offline' }, action)
    expect(h.ctx.browserTasks.get(h.agent)!.attempts.find(item => item.requestId === requestId)).toMatchObject({ stage: 'settled', outcome: 'failed' })
    expect(h.agent.session.events.some(event => event.type === 'browser-task/change' && event.data.task.attempts.some((item: { requestId: string; stage: string }) => item.requestId === requestId && item.stage === 'dispatched'))).toBe(false)
    await h.ctx.fiber.dispose()
  })
  it('accounts a direct browser_snapshot through the active task before settling it', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const before = h.ctx.browserTasks.get(h.agent)!; const requestId = 'direct-snapshot'
    await executeObserved({ browser: h.browser, loop: h.loop, agent: h.agent, signal: new AbortController().signal,
      operation: { sessionId: h.agent.session.id, installationId: 'extension', requestId, action: { kind: 'snapshot', tabId: page.tabId, frameId: page.frameId, documentId: page.documentId, limit: 64, textLimit: 8000 } } })
    const after = h.ctx.browserTasks.get(h.agent)!; const receipt = h.agent.session.events.find(event => event.type === 'browser-task/receipt' && event.data.requestId === requestId)!
    const settled = h.agent.session.events.find(event => event.type === 'browser-task/change' && event.data.task.attempts.some((item: { requestId: string; stage: string }) => item.requestId === requestId && item.stage === 'settled'))!
    expect(after.budget.actionsUsed).toBe(before.budget.actionsUsed + 1)
    expect(receipt.seq).toBeLessThan(settled.seq)
    await h.ctx.fiber.dispose()
  })
  it('does not silently replace the target after a non-navigation page mismatch', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Done' } }, new AbortController().signal)
    const requestId = 'click'; h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId, action: { kind: 'click', element: { page, snapshotId: 's', elementId: 'go' }, intent: 'go' } }); h.loop.dispatched(h.agent, requestId)
    h.loop.settle(h.agent, { requestId, sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: { feedback: { status: 'observed', snapshot: { page: { ...page, url: 'https://example.test/other' } } } } }, { kind: 'click', element: { page, snapshotId: 's', elementId: 'go' }, intent: 'go' })
    expect(h.ctx.browserTasks.get(h.agent)!.target?.page).toEqual(page)
    expect(h.ctx.browserTasks.get(h.agent)!.blockers).toContain('target-lost')
    await h.ctx.fiber.dispose()
  })
  it('keeps a target binding when an equivalent page has a different field order', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Done' } }, new AbortController().signal)
    const requestId = 'same-page'; const action = { kind: 'click' as const, element: { page, snapshotId: 's', elementId: 'go' }, intent: 'go' }
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId, action })
    const reordered = { url: page.url, documentId: page.documentId, frameId: page.frameId, tabId: page.tabId }
    h.loop.settle(h.agent, { requestId, sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: { feedback: { status: 'observed', snapshot: { page: reordered } } } }, action)
    expect(h.ctx.browserTasks.get(h.agent)!.blockers).not.toContain('target-lost')
    await h.ctx.fiber.dispose()
  })
  it('explicit navigation rebinds only after the durable target-loss transition', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Done' } }, new AbortController().signal)
    const requestId = 'navigate'; const action = { kind: 'navigate' as const, page, url: 'https://example.test/next' }; h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId, action }); h.loop.dispatched(h.agent, requestId)
    h.loop.settle(h.agent, { requestId, sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent', value: { feedback: { status: 'observed', snapshot: { page: { ...page, documentId: 'second', url: action.url } } } } }, action)
    expect(h.ctx.browserTasks.get(h.agent)!.target?.page).toMatchObject({ documentId: 'second', url: action.url })
    expect(h.ctx.browserTasks.get(h.agent)!.blockers).not.toContain('target-lost')
    await h.ctx.fiber.dispose()
  })
  it('unknown action remains a durable blocker and prevents another action', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const requestId = 'lost'; const action = { kind: 'click' as const, element: { page, snapshotId: 's', elementId: 'go' }, intent: 'go' }; h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId, action }); h.loop.dispatched(h.agent, requestId); h.loop.settle(h.agent, { requestId, sessionId: h.agent.session.id, installationId: 'extension', outcome: 'unknown', delivery: 'sent' }, action)
    expect(h.ctx.browserTasks.get(h.agent)!.blockers).toContain('unknown-attempt')
    expect(h.loop.allowsAction(h.agent, action)).toBe(false)
    await h.ctx.fiber.dispose()
  })
  it('reconciles an unknown request only from a quiescent recovery receipt', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const requestId = 'recover'; const action = { kind: 'click' as const, element: { page, snapshotId: 's', elementId: 'go' }, intent: 'go' }
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId, action }); h.loop.dispatched(h.agent, requestId)
    h.loop.settle(h.agent, { requestId, sessionId: h.agent.session.id, installationId: 'extension', outcome: 'unknown', delivery: 'sent' }, action)
    h.loop.reconcile(h.agent, requestId, { requestId, sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent', quiescent: false })
    expect(h.ctx.browserTasks.get(h.agent)!.blockers).toContain('unknown-attempt')
    h.loop.reconcile(h.agent, requestId, { requestId, sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed', delivery: 'sent', quiescent: true })
    expect(h.ctx.browserTasks.get(h.agent)!.blockers).not.toContain('unknown-attempt')
    expect(h.agent.session.events.some(event => event.type === 'browser-task/receipt' && event.data.requestId === requestId &&  event.data.quiescent)).toBe(true)
    await h.ctx.fiber.dispose()
  })
  it('reconciles an uncertain clear lease only from its quiescent observed request status', async () => {
    const h = await harness()
    await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const requestId = 'recover-clear'
    const action = { kind: 'region_clear' as const, page, mountId: 'result-panel' }
    h.loop.reserveResource(h.agent, 'result-panel')
    h.loop.releasePending(h.agent, 'result-panel')
    h.loop.reserveResource(h.agent, 'other-panel')
    h.loop.releasePending(h.agent, 'other-panel')
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId, action })
    h.loop.dispatched(h.agent, requestId)
    h.loop.settle(h.agent, { requestId, sessionId: h.agent.session.id, installationId: 'extension',
      outcome: 'unknown', delivery: 'sent' }, action)
    h.loop.reconcile(h.agent, requestId, { requestId, sessionId: h.agent.session.id,
      installationId: 'extension', outcome: 'observed', delivery: 'sent', quiescent: true,
      value: { cleared: true } })
    expect(h.ctx.browserTasks.get(h.agent)!.resources.find(item => item.id === 'result-panel')).toMatchObject({
      state: 'released',
      disposition: 'reconcile-observed',
    })
    expect(h.ctx.browserTasks.get(h.agent)!.resources.find(item => item.id === 'other-panel')).toMatchObject({
      state: 'release-pending',
    })
    await h.ctx.fiber.dispose()
  })
  it.each(['refused', 'cancelled', 'failed', 'budget-exhausted'] as const)(
    'permits direct reads but blocks writes after a %s task',
    async (outcome) => {
      const h = await harness()
      await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
      const task = h.ctx.browserTasks.get(h.agent)!
      h.ctx.browserTasks.terminate(h.agent, { id: task.id, revision: task.revision }, outcome)
      expect(h.loop.allowsAction(h.agent, { kind: 'snapshot', tabId: page.tabId, frameId: page.frameId,
        documentId: page.documentId, limit: 1, textLimit: 0 })).toBe(true)
      expect(h.loop.allowsAction(h.agent, { kind: 'click', element: { page, snapshotId: 's', elementId: 'go' },
        intent: 'go' })).toBe(false)
      await executeObserved({ browser: h.browser, loop: h.loop, agent: h.agent,
        operation: { sessionId: h.agent.session.id, installationId: 'extension', requestId: `read-${outcome}`,
          action: { kind: 'tabs' } }, signal: new AbortController().signal })
      expect(h.browser.execute).toHaveBeenCalled()
      await h.ctx.fiber.dispose()
    },
  )
  it('cites the exact clear receipt when releasing a page resource', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const requestId = 'clear'; const action = { kind: 'region_clear' as const, page, mountId: 'result-panel' }
    h.loop.reserveResource(h.agent, 'result-panel'); h.loop.releasePending(h.agent, 'result-panel')
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId, action }); h.loop.dispatched(h.agent, requestId)
    const result = { requestId, sessionId: h.agent.session.id, installationId: 'extension',
      outcome: 'observed' as const, delivery: 'sent' as const, value: { cleared: true } }
    const settled = h.loop.settle(h.agent, result, action)!
    h.loop.settleResource(h.agent, 'result-panel', result, action, settled.receipt)
    expect(h.ctx.browserTasks.get(h.agent)!.resources.find(item => item.id === 'result-panel')).toMatchObject({ state: 'released', disposition: 'clear-observed', dispositionSource: settled.receipt })
    await h.ctx.fiber.dispose()
  })
  it.each([
    { action: { kind: 'region_clear' as const, page, mountId: 'panel' }, value: { cleared: false } },
    { action: { kind: 'entry_unmount' as const, page, mountId: 'panel' }, value: { unmounted: true, remaining: 1 } },
  ])('keeps cleanup pending when $action.kind lacks a confirmed release result', async ({ action, value }) => {
    const h = await harness()
    await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    h.loop.reserveResource(h.agent, 'panel')
    h.loop.releasePending(h.agent, 'panel')
    const requestId = `unconfirmed-${action.kind}`
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId, action })
    h.loop.dispatched(h.agent, requestId)
    const result = { requestId, sessionId: h.agent.session.id, installationId: 'extension',
      outcome: 'observed' as const, delivery: 'sent' as const, value }
    const settled = h.loop.settle(h.agent, result, action)!
    h.loop.settleResource(h.agent, 'panel', result, action, settled.receipt)
    expect(h.ctx.browserTasks.get(h.agent)!.resources.find(item => item.id === 'panel')).toMatchObject({
      state: 'release-pending',
    })
    expect(h.ctx.browserTasks.get(h.agent)!.blockers).toContain('cleanup')
    await h.ctx.fiber.dispose()
  })
  it('releases an entry mount only after its final entry is confirmed unmounted', async () => {
    const h = await harness()
    await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const action = { kind: 'entry_unmount' as const, page, mountId: 'panel' }
    h.loop.reserveResource(h.agent, 'panel')
    h.loop.releasePending(h.agent, 'panel')
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'entry-clear', action })
    h.loop.dispatched(h.agent, 'entry-clear')
    const result = { requestId: 'entry-clear', sessionId: h.agent.session.id, installationId: 'extension',
      outcome: 'observed' as const, delivery: 'sent' as const, value: { unmounted: true, remaining: 0 } }
    const settled = h.loop.settle(h.agent, result, action)!
    h.loop.settleResource(h.agent, 'panel', result, action, settled.receipt)
    expect(h.ctx.browserTasks.get(h.agent)!.resources.find(item => item.id === 'panel')).toMatchObject({ state: 'released' })
    await h.ctx.fiber.dispose()
  })
  it('records document replacement as a final vanished lease rather than a successful clear', async () => {
    const h = await harness()
    await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const action = { kind: 'region_clear' as const, page, mountId: 'panel' }
    h.loop.reserveResource(h.agent, 'panel')
    h.loop.releasePending(h.agent, 'panel')
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'replaced', action })
    h.loop.dispatched(h.agent, 'replaced')
    const result = { requestId: 'replaced', sessionId: h.agent.session.id, installationId: 'extension',
      outcome: 'failed' as const, delivery: 'sent' as const, reason: 'document_replaced' }
    const settled = h.loop.settle(h.agent, result, action)!
    h.loop.settleResource(h.agent, 'panel', result, action, settled.receipt)
    expect(h.ctx.browserTasks.get(h.agent)!.resources.find(item => item.id === 'panel')).toMatchObject({
      state: 'vanished',
      disposition: 'document-replaced',
      dispositionSource: settled.receipt,
    })
    await h.ctx.fiber.dispose()
  })
  it('does not reset an active region lease when an idempotent re-render is not sent', async () => {
    const h = await harness()
    await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const initial = { kind: 'region_render' as const, page, mountId: 'panel', selector: '#sidebar',
      blocks: [{ type: 'text' as const, text: '初始' }] }
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'first-render', action: initial })
    h.loop.reserveResource(h.agent, 'panel')
    const first = { requestId: 'first-render', sessionId: h.agent.session.id, installationId: 'extension',
      outcome: 'observed' as const, delivery: 'sent' as const }
    const firstReceipt = h.loop.settle(h.agent, first, initial)!
    h.loop.settleResource(h.agent, 'panel', first, initial, firstReceipt.receipt)
    const update = { ...initial, blocks: [{ type: 'text' as const, text: '更新' }] }
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'second-render', action: update })
    h.loop.reserveResource(h.agent, 'panel')
    const failed = { requestId: 'second-render', sessionId: h.agent.session.id, installationId: 'extension',
      outcome: 'failed' as const, delivery: 'not-sent' as const, reason: 'offline' }
    const failedReceipt = h.loop.settle(h.agent, failed, update)!
    h.loop.settleResource(h.agent, 'panel', failed, update, failedReceipt.receipt)
    expect(h.ctx.browserTasks.get(h.agent)!.resources.find(item => item.id === 'panel')).toMatchObject({ state: 'active' })
    await h.ctx.fiber.dispose()
  })
  it('reconciles an unknown render to active, then permits its exact clear from unresolved', async () => {
    const h = await harness()
    await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const render = { kind: 'region_render' as const, page, mountId: 'panel', selector: '#sidebar',
      blocks: [{ type: 'text' as const, text: '结果' }] }
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'unknown-render', action: render })
    h.loop.reserveResource(h.agent, 'panel')
    h.loop.dispatched(h.agent, 'unknown-render')
    const unknown = { requestId: 'unknown-render', sessionId: h.agent.session.id, installationId: 'extension',
      outcome: 'unknown' as const, delivery: 'sent' as const }
    const unknownReceipt = h.loop.settle(h.agent, unknown, render)!
    h.loop.settleResource(h.agent, 'panel', unknown, render, unknownReceipt.receipt)
    expect(h.ctx.browserTasks.get(h.agent)!.resources.find(item => item.id === 'panel')).toMatchObject({ state: 'unresolved' })
    expect(h.loop.allowsAction(h.agent, { kind: 'region_clear', page, mountId: 'panel' })).toBe(true)
    h.loop.reconcile(h.agent, 'unknown-render', { ...unknown, outcome: 'observed', quiescent: true })
    expect(h.ctx.browserTasks.get(h.agent)!.resources.find(item => item.id === 'panel')).toMatchObject({
      state: 'active',
      disposition: 'reconcile-active',
    })

    const clear = { kind: 'region_clear' as const, page, mountId: 'panel' }
    h.loop.releasePending(h.agent, 'panel')
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'clear-active', action: clear })
    h.loop.dispatched(h.agent, 'clear-active')
    const cleared = { requestId: 'clear-active', sessionId: h.agent.session.id, installationId: 'extension',
      outcome: 'observed' as const, delivery: 'sent' as const, value: { cleared: true } }
    const clearReceipt = h.loop.settle(h.agent, cleared, clear)!
    h.loop.settleResource(h.agent, 'panel', cleared, clear, clearReceipt.receipt)
    expect(h.ctx.browserTasks.get(h.agent)!.resources.find(item => item.id === 'panel')).toMatchObject({ state: 'released' })
    await h.ctx.fiber.dispose()
  })
  it('settles a render document replacement as vanished and can do so from a quiescent unknown status', async () => {
    const h = await harness()
    await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const render = { kind: 'entry_mount' as const, page, mountId: 'panel', selector: '.card', label: '保存' }
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'unknown-mount', action: render })
    h.loop.reserveResource(h.agent, 'panel')
    h.loop.dispatched(h.agent, 'unknown-mount')
    const unknown = { requestId: 'unknown-mount', sessionId: h.agent.session.id, installationId: 'extension',
      outcome: 'unknown' as const, delivery: 'sent' as const }
    const unknownReceipt = h.loop.settle(h.agent, unknown, render)!
    h.loop.settleResource(h.agent, 'panel', unknown, render, unknownReceipt.receipt)
    h.loop.reconcile(h.agent, 'unknown-mount', { ...unknown, quiescent: true, reason: 'document_replaced' })
    const task = h.ctx.browserTasks.get(h.agent)!
    expect(task.attempts.find(item => item.requestId === 'unknown-mount')).toMatchObject({ outcome: 'unknown' })
    expect(task.resources.find(item => item.id === 'panel')).toMatchObject({
      state: 'vanished',
      disposition: 'document-replaced',
    })
    await h.ctx.fiber.dispose()
  })
  it('settles a directly failed render document replacement as vanished, but not an ordinary stale target', async () => {
    const h = await harness()
    await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const render = { kind: 'region_render' as const, page, mountId: 'panel', selector: '#sidebar',
      blocks: [{ type: 'text' as const, text: '结果' }] }
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'render-replaced', action: render })
    h.loop.reserveResource(h.agent, 'panel')
    h.loop.dispatched(h.agent, 'render-replaced')
    const replaced = { requestId: 'render-replaced', sessionId: h.agent.session.id, installationId: 'extension',
      outcome: 'failed' as const, delivery: 'sent' as const, reason: 'document_replaced' }
    const replacedReceipt = h.loop.settle(h.agent, replaced, render)!
    h.loop.settleResource(h.agent, 'panel', replaced, render, replacedReceipt.receipt)
    expect(h.ctx.browserTasks.get(h.agent)!.resources.find(item => item.id === 'panel')).toMatchObject({ state: 'vanished' })
    await h.ctx.fiber.dispose()

    const stale = await harness()
    await stale.loop.start(stale.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    stale.loop.planned(stale.agent, { sessionId: stale.agent.session.id, installationId: 'extension', requestId: 'render-stale', action: render })
    stale.loop.reserveResource(stale.agent, 'panel')
    stale.loop.dispatched(stale.agent, 'render-stale')
    const staleResult = { requestId: 'render-stale', sessionId: stale.agent.session.id, installationId: 'extension',
      outcome: 'failed' as const, delivery: 'sent' as const, reason: 'target_url_stale' }
    const staleReceipt = stale.loop.settle(stale.agent, staleResult, render)!
    stale.loop.settleResource(stale.agent, 'panel', staleResult, render, staleReceipt.receipt)
    expect(stale.ctx.browserTasks.get(stale.agent)!.resources.find(item => item.id === 'panel')).toMatchObject({ state: 'unresolved' })
    await stale.ctx.fiber.dispose()
  })
  it('keeps a pending cleanup after its clear was not sent but releases an unmounted initial reservation', async () => {
    const h = await harness()
    await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const clear = { kind: 'region_clear' as const, page, mountId: 'active-panel' }
    h.loop.reserveResource(h.agent, 'active-panel')
    h.loop.releasePending(h.agent, 'active-panel')
    const clearResult = { requestId: 'clear-not-sent', sessionId: h.agent.session.id, installationId: 'extension',
      outcome: 'failed' as const, delivery: 'not-sent' as const, reason: 'offline' }
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: clearResult.requestId, action: clear })
    const clearReceipt = h.loop.settle(h.agent, clearResult, clear)!
    h.loop.settleResource(h.agent, 'active-panel', clearResult, clear, clearReceipt.receipt)
    expect(h.ctx.browserTasks.get(h.agent)!.resources.find(item => item.id === 'active-panel')).toMatchObject({ state: 'release-pending' })

    await h.ctx.fiber.dispose()

    const fresh = await harness()
    await fresh.loop.start(fresh.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const render = { kind: 'region_render' as const, page, mountId: 'new-panel', selector: '#sidebar',
      blocks: [{ type: 'text' as const, text: '结果' }] }
    fresh.loop.planned(fresh.agent, { sessionId: fresh.agent.session.id, installationId: 'extension', requestId: 'render-not-sent', action: render })
    fresh.loop.reserveResource(fresh.agent, 'new-panel')
    const renderResult = { requestId: 'render-not-sent', sessionId: fresh.agent.session.id, installationId: 'extension',
      outcome: 'failed' as const, delivery: 'not-sent' as const, reason: 'offline' }
    const renderReceipt = fresh.loop.settle(fresh.agent, renderResult, render)!
    fresh.loop.settleResource(fresh.agent, 'new-panel', renderResult, render, renderReceipt.receipt)
    expect(fresh.ctx.browserTasks.get(fresh.agent)!.resources.find(item => item.id === 'new-panel')).toMatchObject({
      state: 'released',
      disposition: 'not-sent',
    })
    await fresh.ctx.fiber.dispose()
  })
  it('plans an active region_render before reserving its cleanup obligation', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const requestId = 'render'; const action = { kind: 'region_render' as const, page, mountId: 'result-panel', selector: '#sidebar', blocks: [{ type: 'text' as const, text: '结果' }] }
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId, action }); h.loop.reserveResource(h.agent, 'result-panel'); h.loop.dispatched(h.agent, requestId)
    const result = { requestId, sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed' as const, delivery: 'sent' as const }
    const settled = h.loop.settle(h.agent, result, action)!
    h.loop.settleResource(h.agent, 'result-panel', result, action, settled.receipt)
    expect(h.ctx.browserTasks.get(h.agent)!.resources.find(item => item.id === 'result-panel')).toMatchObject({ state: 'active' })
    await h.ctx.fiber.dispose()
  })
  it('allows only an exact pending clear after the action budget is exhausted', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    for (let index = 0; index < MAX_ACTIONS - 1; index += 1) h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: `read-${index}`, action: { kind: 'snapshot', tabId: page.tabId, frameId: page.frameId, documentId: page.documentId, limit: 1, textLimit: 0 } }, false)
    h.loop.reserveResource(h.agent, 'result-panel'); h.loop.releasePending(h.agent, 'result-panel')
    const clear = { kind: 'region_clear' as const, page, mountId: 'result-panel' }
    expect(h.loop.allowsAction(h.agent, clear)).toBe(true)
    expect(h.loop.allowsAction(h.agent, { kind: 'click', element: { page, snapshotId: 's', elementId: 'go' }, intent: 'go' })).toBe(false)
    const before = h.ctx.browserTasks.get(h.agent)!.budget.actionsUsed
    h.loop.planned(h.agent, { sessionId: h.agent.session.id, installationId: 'extension', requestId: 'cleanup-after-budget', action: clear })
    expect(h.ctx.browserTasks.get(h.agent)!.budget.actionsUsed).toBe(before)
    await h.ctx.fiber.dispose()
  })
  it('uses the requested bounded budgets and completes only through current evidence', async () => {
    const h = await harness(); const started = await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Done' } }, new AbortController().signal)
    expect(started).toMatchObject({ budget: { maxSteps: MAX_STEPS, maxActions: MAX_ACTIONS } })
    expect(await h.loop.verify(h.agent, new AbortController().signal)).toMatchObject({ status: 'verified' })
    expect(h.ctx.browserTasks.get(h.agent)!.outcome).toBe('completed')
    await h.ctx.fiber.dispose()
  })
  it('omits a missing start observation instead of returning an undefined tool field', async () => {
    const h = await harness(); h.browser.execute.mockImplementationOnce(async (operation: BrowserOperation) => ({ requestId: operation.requestId, sessionId: h.agent.session.id, installationId: 'extension', outcome: 'observed' as const, delivery: 'sent' as const, value: { text: 'Done' } }))
    const started = await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Done' } }, new AbortController().signal)
    expect(started).not.toHaveProperty('observation')
    await h.ctx.fiber.dispose()
  })
  it('bypasses a completed task for a later one-off browser observation', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Done' } }, new AbortController().signal)
    await h.loop.verify(h.agent, new AbortController().signal)
    const before = h.ctx.browserTasks.get(h.agent)!; const requestId = 'after-complete'
    await executeObserved({ browser: h.browser, loop: h.loop, agent: h.agent, signal: new AbortController().signal,
      operation: { sessionId: h.agent.session.id, installationId: 'extension', requestId, action: { kind: 'tabs' } } })
    expect(h.loop.allowsAction(h.agent, { kind: 'tabs' })).toBe(true)
    expect(h.ctx.browserTasks.get(h.agent)!.attempts).toEqual(before.attempts)
    await h.ctx.fiber.dispose()
  })
  it('does not mutate or throw when one-off preparation follows task completion', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Done' } }, new AbortController().signal)
    await h.loop.verify(h.agent, new AbortController().signal)
    const before = h.ctx.browserTasks.get(h.agent)!
    expect(() => { h.loop.prepared(h.agent, 'one-off'); h.loop.dispatched(h.agent, 'one-off') }).not.toThrow()
    expect(h.ctx.browserTasks.get(h.agent)).toEqual(before)
    await h.ctx.fiber.dispose()
  })
  it('records unavailable capability rather than performing a snapshot', async () => {
    const h = await harness(); h.browser.instances.mockResolvedValueOnce([])
    await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Done' } }, new AbortController().signal)
    expect(h.ctx.browserTasks.get(h.agent)!.blockers).toContain('capability-drift')
    expect(h.browser.execute).not.toHaveBeenCalled()
    await h.ctx.fiber.dispose()
  })
  it('recreates the facade after a restart without losing the projected task', async () => {
    const h = await harness(); await h.loop.start(h.agent, { installationId: 'extension', page, goal: '完成', success: { text: 'Never' } }, new AbortController().signal)
    const resumed = new BrowserTaskLoop(h.browser, h.ctx.browserTasks)
    expect(resumed.status(h.agent)).toMatchObject({ status: 'running' })
    await h.ctx.fiber.dispose()
  })
})

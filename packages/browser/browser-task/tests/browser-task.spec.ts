import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import BrowserTaskService, {
  BROWSER_TASK_LIMITS,
  BrowserTaskError,
  browserPageMapEvidence,
  browserTaskProjectionDefinition,
  foldBrowserTask,
} from '../src/index.ts'
const target={ installationId:'chrome-a',page:{ tabId:1,frameId:0,documentId:'doc-a',url:'https://example.test/a' } } as const
async function h(){const ctx=new Context();await ctx.plugin(SessionStore);await ctx.plugin(SessionProjectionRegistry);await ctx.plugin(AgentRegistry);await ctx.plugin(SystemPrompt);await ctx.plugin(ToolRuntime);await ctx.plugin(BrowserTaskService);const session=ctx.sessions.create(SessionId(`bt-${Math.random()}`));session.append('user/message',createUserMessage({ content:[{ type:'text',text:'prove task' }],source:{ kind:'user' } }),{ surfaceOp:'append' });const agent={ id:session.id,options:{},session,ctx,status:'idle',inbox:{ append(){},remove(){return false},nextStep:[] },send(){},followup(){},steer(){},inject(){},cancel(){},runMaintenance(fn:(s:AbortSignal)=>unknown){return fn(new AbortController().signal)},whenIdle(){return Promise.resolve()} } as unknown as Agent;ctx.agents.register(agent);return{ ctx,agent,session }}
const create=(ctx:Context,a:Agent,seq=0)=>ctx.browserTasks.create(a,{ objective:'prove task',sourceSeq:seq,target,acceptance:[{ id:'url',kind:'url-equals',url:target.page.url }],maxSteps:3,maxActions:2 })
const cap={ installationId:'chrome-a',state:'observed' as const,grantEpoch:1,scopes:['browser:read'],actions:['snapshot'],protocol:'v1' }
const evidence={ id:'e1',state:'current' as const,source:{ kind:'user' as const,sessionSeq:0 },digest:'sha256:e1',target,grantEpoch:1 }
const attempt=(value:Record<string,unknown>)=>({ actionKind:'resourceId'in value?'region_render':'click',grantEpoch:1,...value })
describe('browser task kernel',()=>{
  it('persists only opaque regionRef page-map recovery facts',()=>{
    expect(browserPageMapEvidence({ regions:[{ regionRef:'11111111-1111-4111-8111-111111111111',disposable:true,protected:false }] })).toEqual({ regions:[{ regionRef:'11111111-1111-4111-8111-111111111111',disposable:true,protected:false }] })
    expect(browserPageMapEvidence({ regions:[{ selector:'#private',disposable:true,protected:false }] })).toBeUndefined()
    expect(browserPageMapEvidence({ regions:[{ regionRef:'11111111-1111-1111-1111-111111111111',disposable:true,protected:false }] })).toBeUndefined()
  })
  it('replays strict complete snapshots and wire state is detached',async()=>{const{ ctx,agent,session }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordCapability(agent,t,cap);expect(t.blockers).not.toContain('capability-drift');t=ctx.browserTasks.recordEvidence(agent,t,evidence);const check=ctx.browserTasks.recordCheck(agent,t,{ checkerId:'check-1',target,grantEpoch:1,evaluations:[{ clauseId:'url',satisfied:true,evidenceIds:['e1'] }] });t=ctx.browserTasks.evaluate(agent,t,[{ clauseId:'url',satisfied:true,evidenceIds:['e1'],checkerRef:check }]);const view=ctx.sessionProjections.stateOf(session,'browserTask')!.current!;const wire=browserTaskProjectionDefinition.wire.view({ current:view,recentTaskIds:[view.id],lastSourceSeq:1,lastTaskSourceSeq:0,sourceFacts:[{ kind:'user',sessionSeq:0 }],failure:null });if(wire!==null)Reflect.set(wire,'objective','mutated');expect(ctx.browserTasks.get(agent)!.objective).toBe('prove task');expect(foldBrowserTask(session.snapshotEvents())?.revision).toBe(t.revision)})
  it('rejects CAS, duplicate source sequence, and invalid command before append',async()=>{const{ ctx,agent,session }=await h();const t=create(ctx,agent);const before=session.snapshotEvents().length;expect(()=>ctx.browserTasks.recordEvidence(agent,t,{ ...evidence,grantEpoch:9 })).toThrow(BrowserTaskError);expect(session.snapshotEvents()).toHaveLength(before);ctx.browserTasks.terminate(agent,t,'failed');expect(()=>create(ctx,agent,1)).toThrow(BrowserTaskError);expect(()=>ctx.browserTasks.transition(agent,t,'waiting')).toThrow(BrowserTaskError)})
  it('contains delegation observer reads after the projection has failed', async()=>{
    const { ctx, agent, session } = await h()
    session.append('browser-task/change', { kind:'browser-task/change', version:3, operation:'create', task:{} } as never)
    expect(ctx.sessionProjections.stateOf(session, 'browserTask')?.failure).not.toBeNull()
    ctx.tools.register(defineTool({ name:'subagent_observer_failure',description:'delegate',parameters:{},output:{ schema:{ type:'json' },render:()=>[{ type:'text',text:'done' }] },execute:async()=>({ kind:'foreground',runId:'run',output:[] }) }))
    const callId=ToolCallId('observer-failure')
    const result=await ctx.tools.execute({ signal:new AbortController().signal,callId,name:'subagent_observer_failure',arguments:{},agent })
    session.append('tool/result',{ turn:1,step:1,message:createToolResultMessage({ callId,content:result.content,isError:result.isError }) },{ surfaceOp:'append' })
    await Promise.resolve()
  })
  it('cancels an unknown task only from a newer direct user fact after cleanup',async()=>{
    const { ctx, agent, session } = await h(); let t=create(ctx,agent)
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'unknown',requestId:'unknown',stage:'planned',write:true,target }) as never)
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'unknown',requestId:'unknown',stage:'dispatched',write:true,target }) as never)
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'unknown',actionKind:'click',target,outcome:'unknown',delivery:'sent',quiescent:false,grantEpoch:1 })
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'unknown',requestId:'unknown',stage:'settled',outcome:'unknown',quiescent:false,settledBy:receipt,write:true,target }) as never)
    const source=session.append('user/message',createUserMessage({ content:[{ type:'text',text:'接受未知 [browser-task:accept-unknown]' }],source:{ kind:'user' } }),{ surfaceOp:'append' })
    const cancelled=ctx.browserTasks.cancelByOwner(agent,t,source.seq)
    expect(cancelled).toMatchObject({ phase:'terminal',outcome:'cancelled',terminationSource:{ kind:'user',sessionSeq:source.seq } })
    expect(cancelled.attempts[0]).toMatchObject({ outcome:'unknown',settledBy:receipt })
  })
  it('refuses owner cancellation while a page resource still needs cleanup',async()=>{
    const { ctx, agent, session } = await h(); let t=create(ctx,agent)
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'reserved',target })
    const source=session.append('user/message',createUserMessage({ content:[{ type:'text',text:'取消' }],source:{ kind:'user' } }),{ surfaceOp:'append' })
    expect(()=>ctx.browserTasks.cancelByOwner(agent,t,source.seq)).toThrow(BrowserTaskError)
  })
  it('rejects an otherwise latest direct user message without an explicit cancellation marker',async()=>{
    const { ctx,agent,session }=await h();const t=create(ctx,agent)
    const source=session.append('user/message',createUserMessage({ content:[{ type:'text',text:'请取消' }],source:{ kind:'user' } }),{ surfaceOp:'append' })
    expect(()=>ctx.browserTasks.cancelByOwner(agent,t,source.seq)).toThrow(BrowserTaskError)
  })
  it('does not let owner cancellation reuse an earlier direct user message',async()=>{
    const { ctx, agent, session } = await h(); const t=create(ctx,agent)
    const oldSource=session.append('user/message',createUserMessage({ content:[{ type:'text',text:'取消' }],source:{ kind:'user' } }),{ surfaceOp:'append' })
    session.append('user/message',createUserMessage({ content:[{ type:'text',text:'继续' }],source:{ kind:'user' } }),{ surfaceOp:'append' })
    expect(()=>ctx.browserTasks.cancelByOwner(agent,t,oldSource.seq)).toThrow(BrowserTaskError)
  })
  it('rejects a replayed owner cancellation that cites a non-latest direct user fact',async()=>{
    const{ ctx,agent,session }=await h();const t=create(ctx,agent)
    const old=session.append('user/message',createUserMessage({ content:[{ type:'text',text:'旧取消 [browser-task:cancel]' }],source:{ kind:'user' } }),{ surfaceOp:'append' })
    session.append('user/message',createUserMessage({ content:[{ type:'text',text:'新输入' }],source:{ kind:'user' } }),{ surfaceOp:'append' })
    session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'owner-cancel',task:{ ...t,revision:t.revision+1,updatedAt:t.updatedAt+1,phase:'terminal',outcome:'cancelled',terminationSource:{ kind:'user',sessionSeq:old.seq } } } as never)
    expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')
  })
  it('retains a terminal owner-cancel source through bounded source-fact compaction',async()=>{
    const{ ctx,agent,session }=await h();let t=create(ctx,agent)
    const cancellation=session.append('user/message',createUserMessage({ content:[{ type:'text',text:'取消 [browser-task:cancel]' }],source:{ kind:'user' } }),{ surfaceOp:'append' })
    t=ctx.browserTasks.cancelByOwner(agent,t,cancellation.seq)
    for(let index=0;index<270;index+=1) session.append('assistant/message',{ content:[{ type:'text',text:String(index) }],source:{ kind:'agent' } } as never,{ surfaceOp:'append' })
    expect(ctx.browserTasks.get(agent)).toMatchObject({ outcome:'cancelled',terminationSource:{ kind:'user',sessionSeq:cancellation.seq } })
    expect(foldBrowserTask(session.snapshotEvents())).toMatchObject({ outcome:'cancelled',terminationSource:{ kind:'user',sessionSeq:cancellation.seq } })
  })
  it('accepts an explicit page-region presentation clause',async()=>{
    const{ ctx,agent }=await h()
    const task=ctx.browserTasks.create(agent,{ objective:'show the analysis',sourceSeq:0,target,
      acceptance:[{ id:'panel',kind:'region-content',resourceId:'analysis-panel',text:'证据分歧' }] as never })
    expect(task.acceptance).toEqual([{ id:'panel',kind:'region-content',resourceId:'analysis-panel',text:'证据分歧' }])
  })
  it('rejects region acceptance text that cannot fit a bounded presentation excerpt',async()=>{
    const{ ctx,agent }=await h()
    expect(()=>ctx.browserTasks.create(agent,{ objective:'show the analysis',sourceSeq:0,target,
      acceptance:[{ id:'panel',kind:'region-content',resourceId:'analysis-panel',text:'字'.repeat(171) }] as never })).toThrow(BrowserTaskError)
  })
  it('rejects an evidence identity reused with different content',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.recordCapability(agent,t,cap);t=ctx.browserTasks.recordEvidence(agent,t,evidence)
    expect(()=>ctx.browserTasks.recordEvidence(agent,t,{ ...evidence,digest:'changed' })).toThrow()
  })
  it('pauses after an attempt bypasses its required delivery receipt',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'a',requestId:'r',stage:'planned',write:true,target }) as never)
    expect(()=>ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'r',stage:'settled',outcome:'unknown',write:true,target }) as never))
      .toThrow(expect.objectContaining({ code:'BROWSER_TASK_INTERNAL_INVARIANT' }))
    expect(ctx.browserTasks.get(agent)).toMatchObject({ phase:'waiting',blockers:['internal-invariant'] })
  })
  it('pauses instead of overwriting an unknown attempt without reconciliation',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'a',requestId:'r',stage:'planned',write:true,target }) as never)
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'r',stage:'dispatched',write:true,target }) as never)
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'r',actionKind:'click',target,outcome:'unknown',delivery:'sent',quiescent:false,grantEpoch:1 })
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'r',stage:'settled',outcome:'unknown',quiescent:false,settledBy:receipt,write:true,target }) as never)
    expect(()=>ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'r',stage:'settled',outcome:'observed',quiescent:true,settledBy:receipt,write:true,target }) as never))
      .toThrow(expect.objectContaining({ code:'BROWSER_TASK_INTERNAL_INVARIANT' }))
    expect(ctx.browserTasks.get(agent)?.blockers).toEqual(expect.arrayContaining(['unknown-attempt','internal-invariant']))
  })
  it.each(['clear-observed','not-sent'] as const)('pauses when a reserved resource bypasses its %s receipt',async(disposition)=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'p',state:'reserved',target })
    expect(()=>ctx.browserTasks.upsertResource(agent,t,{ id:'p',state:'released',target,disposition,
      dispositionSource:{ kind:'user',sessionSeq:0 } })).toThrow(expect.objectContaining({ code:'BROWSER_TASK_INTERNAL_INVARIANT' }))
    expect(ctx.browserTasks.get(agent)?.phase).toBe('waiting')
    expect(ctx.browserTasks.get(agent)?.blockers).toEqual(expect.arrayContaining(['cleanup','internal-invariant']))
  })
  it('marks authority drift stale and requires explicit target rebind acknowledgement',async()=>{const{ ctx,agent }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordCapability(agent,t,cap);t=ctx.browserTasks.recordEvidence(agent,t,evidence);t=ctx.browserTasks.recordCapability(agent,t,{ ...cap,actions:['snapshot','click'] });expect(t.evidence[0]?.state).toBe('stale');t=ctx.browserTasks.transition(agent,t,'waiting',[...t.blockers,'target-lost']);const next={ ...target,page:{ ...target.page,documentId:'doc-b',url:'https://example.test/b' } };t=ctx.browserTasks.rebind(agent,t,next);expect(t.target).toEqual(next);t=ctx.browserTasks.acknowledgeTargetLoss(agent,t);expect(t.blockers).not.toContain('target-lost')})
  it('enforces resource/step budgets and preserves sequential task history',async()=>{const{ ctx,agent,session }=await h();let t=create(ctx,agent);t=ctx.browserTasks.consumeContinuation(agent,t,2);expect(()=>ctx.browserTasks.consumeContinuation(agent,t,2)).toThrow(expect.objectContaining({ code:'BROWSER_TASK_BUDGET' }));t=ctx.browserTasks.terminate(agent,t,'failed');const source=session.append('user/message',createUserMessage({ content:[{ type:'text',text:'next' }],source:{ kind:'user' } }),{ surfaceOp:'append' });const second=create(ctx,agent,source.seq);expect(second.id).not.toBe(t.id);expect(session.snapshotEvents().filter(x=>x.type==='browser-task/change')).toHaveLength(4)})
  it('fails closed on corrupt projection state and malformed replay',async()=>{expect(()=>browserTaskProjectionDefinition.stateSchema.parse({ current:{},recentTaskIds:[],lastSourceSeq:-1,sourceFacts:[],failure:null })).toThrow();const{ ctx,agent,session }=await h();const t=create(ctx,agent);session.append('browser-task/change',{ kind:'browser-task/change',version:2,operation:'terminate',task:{ ...t,revision:99,phase:'terminal',outcome:'completed' } } as never);expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')})
  it('rejects a direct raw resource operation that removes an existing resource',async()=>{const{ ctx,agent,session }=await h();let t=create(ctx,agent);t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'reserved',target });session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'resource',task:{ ...t,revision:t.revision+1,updatedAt:t.updatedAt+1,resources:[] } } as never);expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')})
  it('fails closed on direct raw create, collection deletion, invalid receipts, and budget rewrites',async()=>{const cases=[
    async()=>{const{ ctx,agent,session }=await h();const t=create(ctx,agent);session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'create',task:{ ...t,id:'forged',revision:1,phase:'terminal',outcome:'completed' } } as never);expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')},
    async()=>{const{ ctx,agent,session }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordCapability(agent,t,cap);t=ctx.browserTasks.recordEvidence(agent,t,evidence);session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'evidence',task:{ ...t,revision:t.revision+1,updatedAt:t.updatedAt+1,evidence:[] } } as never);expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')},
    async()=>{const{ ctx,agent,session }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'a',requestId:'r',stage:'planned',write:true,target }) as never);t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'r',stage:'dispatched',write:true,target }) as never);const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'r',actionKind:'click',target,outcome:'unknown',delivery:'sent',quiescent:false,grantEpoch:1 });t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'r',stage:'settled',outcome:'unknown',quiescent:false,settledBy:receipt,write:true,target }) as never);session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'attempt',task:{ ...t,revision:t.revision+1,updatedAt:t.updatedAt+1,attempts:[] } } as never);expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')},
    async()=>{const{ ctx,agent,session }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'a',requestId:'r',stage:'planned',write:true,target }) as never);t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'r',stage:'dispatched',write:true,target }) as never);session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'attempt',task:{ ...t,revision:t.revision+1,updatedAt:t.updatedAt+1,attempts:[{ ...t.attempts[0],stage:'settled',outcome:'observed',quiescent:false }] } } as never);expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')},
    async()=>{const{ ctx,agent,session }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordCapability(agent,t,{ ...cap,state:'degraded' });session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'transition',task:{ ...t,revision:t.revision+1,updatedAt:t.updatedAt+1,blockers:[] } } as never);expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')},
    async()=>{const{ ctx,agent,session }=await h();let t=create(ctx,agent);t=ctx.browserTasks.consumeContinuation(agent,t);session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'consume-budget',task:{ ...t,revision:t.revision+1,updatedAt:t.updatedAt+1,budget:{ ...t.budget,maxSteps:t.budget.maxSteps+1,stepsUsed:0 } } } as never);expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')},
    async()=>{const{ ctx,agent,session }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordCapability(agent,t,cap);session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'evidence',task:{ ...t,revision:t.revision+1,updatedAt:t.updatedAt+1,evidence:[{ ...evidence,source:{ kind:'user',sessionSeq:999 },injected:'raw-page-payload' }] } } as never);expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')},
  ] as const;for(const run of cases)await run()})
  it('adopts a canonical foreground delegation completed earlier in the same direct-user turn',async()=>{
    const{ ctx,agent,session }=await h()
    ctx.tools.register(defineTool({ name:'subagent_before_task',description:'delegate',parameters:{},output:{ schema:{ type:'json' },render:()=>[{ type:'text',text:'done' }] },
      execute:async()=>({ kind:'foreground',runId:'pre-task-run',output:[{ type:'text',text:'analysis' }] }) }))
    const callId=ToolCallId('pre-task-call')
    const call=session.append('tool/call',{ turn:1,step:1,callId,name:'subagent_before_task',arguments:'{}' })
    const result=await ctx.tools.execute({ signal:new AbortController().signal,callId,name:'subagent_before_task',arguments:{},agent })
    session.append('tool/result',{ turn:1,step:1,message:createToolResultMessage({ callId,content:result.content,isError:result.isError }),...(result.meta===undefined?{}:{ meta:result.meta }) },{ surfaceOp:'append',sourceEventSeqs:[call.seq] })
    await Promise.resolve();await Promise.resolve()
    const task=create(ctx,agent)
    expect(task.delegated).toMatchObject([{ callId:'pre-task-call',kind:'subagent',status:'completed',identity:{ mode:'foreground',runId:'pre-task-run' },source:{ kind:'browser-task-delegation' } }])
    expect(foldBrowserTask(session.snapshotEvents())?.delegated).toEqual(task.delegated)
  })
  it('does not adopt a delegation from an older direct-user turn',async()=>{
    const{ ctx,agent,session }=await h()
    ctx.tools.register(defineTool({ name:'old_subagent',description:'delegate',parameters:{},output:{ schema:{ type:'json' },render:()=>[{ type:'text',text:'done' }] },
      execute:async()=>({ kind:'foreground',runId:'old-run',output:[{ type:'text',text:'old' }] }) }))
    const callId=ToolCallId('old-call')
    const call=session.append('tool/call',{ turn:1,step:1,callId,name:'old_subagent',arguments:'{}' })
    const result=await ctx.tools.execute({ signal:new AbortController().signal,callId,name:'old_subagent',arguments:{},agent })
    session.append('tool/result',{ turn:1,step:1,message:createToolResultMessage({ callId,content:result.content,isError:result.isError }),...(result.meta===undefined?{}:{ meta:result.meta }) },{ surfaceOp:'append',sourceEventSeqs:[call.seq] })
    await Promise.resolve();await Promise.resolve()
    const next=session.append('user/message',createUserMessage({ content:[{ type:'text',text:'new browser task' }],source:{ kind:'user' } }),{ surfaceOp:'append' })
    const task=create(ctx,agent,next.seq)
    expect(task.delegated).toEqual([])
    expect(ctx.sessionProjections.stateOf(session,'browserTask')?.pendingDelegations).toEqual([])
  })
  it('adopts the terminal output of a background delegation collected before task creation',async()=>{
    const{ ctx,agent,session }=await h()
    ctx.tools.register(defineTool({ name:'background_before_task',description:'delegate',parameters:{},output:{ schema:{ type:'json' },render:()=>[{ type:'text',text:'started' }] },
      execute:async()=>({ kind:'background',jobId:'job-before-task' }) }))
    ctx.tools.register(defineTool({ name:'job_output',description:'collect',parameters:{},output:{ schema:{ type:'json' },render:()=>[{ type:'text',text:'finished' }] },
      execute:async()=>({ job:{ id:'job-before-task',status:'completed' },text:'bounded result' }) }))
    for(const [callId,name] of [[ToolCallId('background-start'),'background_before_task'],[ToolCallId('background-output'),'job_output']] as const){
      const call=session.append('tool/call',{ turn:1,step:1,callId,name,arguments:'{}' })
      const result=await ctx.tools.execute({ signal:new AbortController().signal,callId,name,arguments:{},agent })
      session.append('tool/result',{ turn:1,step:1,message:createToolResultMessage({ callId,content:result.content,isError:result.isError }),...(result.meta===undefined?{}:{ meta:result.meta }) },{ surfaceOp:'append',sourceEventSeqs:[call.seq] })
      await Promise.resolve();await Promise.resolve()
    }
    const task=create(ctx,agent)
    expect(task.delegated[0]).toMatchObject({ callId:'background-start',kind:'job',status:'completed',
      identity:{ mode:'background',jobId:'job-before-task' } })
    expect(task.delegated[0]?.outputDigest).toMatch(/^sha256:/u)
    expect(task.blockers).not.toContain('delegated-work')
  })
  it('captures the canonical subagent run identity and bounded output digest',async()=>{
    const{ ctx,agent,session }=await h();create(ctx,agent)
    ctx.tools.register(defineTool({
      name:'subagent_codex',description:'delegate',parameters:{},output:{ schema:{ type:'json' },render:()=>[{ type:'text',text:'done' }] },
      execute:async()=>({ kind:'foreground',runId:'real-run-7',output:[{ type:'text',text:'reviewed result' }] }),
    }))
    const call=session.append('tool/call',{ turn:1,step:1,callId:ToolCallId('sub-call'),name:'subagent_codex',arguments:'{}' })
    const result=await ctx.tools.execute({ signal:new AbortController().signal,callId:ToolCallId('sub-call'),name:'subagent_codex',arguments:{},agent })
    session.append('tool/result',{ turn:1,step:1,message:createToolResultMessage({ callId:ToolCallId('sub-call'),content:result.content,isError:result.isError }),...(result.meta===undefined?{}:{ meta:result.meta }) },{ surfaceOp:'append',sourceEventSeqs:[call.seq] })
    await Promise.resolve()
    expect(ctx.browserTasks.get(agent)?.delegated as unknown).toMatchObject([{
      callId:'sub-call',kind:'subagent',status:'completed',identity:{ mode:'foreground',runId:'real-run-7' },
      source:{ kind:'browser-task-delegation' },
    }])
    expect(ctx.browserTasks.get(agent)?.delegated[0]?.outputDigest).toMatch(/^sha256:[a-f0-9]{64}$/u)
  })
  it('does not invent delegated work from a tool name before a canonical result exists',async()=>{
    const{ ctx,agent,session }=await h();create(ctx,agent)
    session.append('tool/call',{ turn:1,step:1,callId:ToolCallId('name-only'),name:'subagent_codex',arguments:'{}' })
    await Promise.resolve()
    expect(ctx.browserTasks.get(agent)?.delegated).toEqual([])
  })
  it('does not treat lookalike ordinary tool output as delegated work',async()=>{
    const{ ctx,agent,session }=await h();create(ctx,agent)
    ctx.tools.register(defineTool({ name:'ordinary_lookup',description:'ordinary',parameters:{},output:{ schema:{ type:'json' },render:()=>[{ type:'text',text:'done' }] },
      execute:async()=>({ kind:'background',jobId:'not-a-job',extra:true }) }))
    const callId=ToolCallId('lookalike-call')
    session.append('tool/call',{ turn:1,step:1,callId,name:'ordinary_lookup',arguments:'{}' })
    const result=await ctx.tools.execute({ signal:new AbortController().signal,callId,name:'ordinary_lookup',arguments:{},agent })
    session.append('tool/result',{ turn:1,step:1,message:createToolResultMessage({ callId,content:result.content,isError:result.isError }) },{ surfaceOp:'append' })
    await Promise.resolve()
    expect(ctx.browserTasks.get(agent)?.delegated).toEqual([])
  })
  it('rejects replay that swaps a pending delegation call identity to clear its blocker',async()=>{
    const { ctx,agent,session }=await h();let t=create(ctx,agent)
    const work={ callId:'pending-call',kind:'job' as const,status:'running',identity:{ mode:'background' as const,jobId:'job-9' },evidenceIds:[] }
    const event=session.append('browser-task/delegation',{ kind:'browser-task/delegation',version:1,taskId:t.id,work })
    t=ctx.browserTasks.linkDelegatedWork(agent,t,{ ...work,source:{ kind:'browser-task-delegation',sessionSeq:event.seq } })
    session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'delegation',task:{ ...t,revision:t.revision+1,updatedAt:t.updatedAt+1,blockers:[],delegated:[{ ...t.delegated[0]!,callId:'forged-call' }] } } as never)
    expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')
  })
  it('rejects a delegation fact owned by another browser task',async()=>{
    const { ctx,agent,session }=await h();const t=create(ctx,agent)
    const work={ callId:'foreign-call',kind:'job' as const,status:'running',identity:{ mode:'background' as const,jobId:'foreign-job' },evidenceIds:[] }
    const fact=session.append('browser-task/delegation',{ kind:'browser-task/delegation',version:1,taskId:'other-task' as never,work })
    session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'delegation',task:{ ...t,
      revision:t.revision+1,updatedAt:t.updatedAt+1,blockers:['delegated-work'],
      delegated:[{ ...work,source:{ kind:'browser-task-delegation',sessionSeq:fact.seq } }],
    } } as never)
    expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')
  })
  it('captures continuation and background identities from result shape, then backfills the matching job terminal result',async()=>{
    const{ ctx,agent,session }=await h();create(ctx,agent)
    ctx.tools.register(defineTool({ name:'opaque_delegate',description:'opaque',parameters:{},output:{ schema:{ type:'json' },render:()=>[{ type:'text',text:'done' }] },
      execute:async()=>({ kind:'continuable',subagentId:'child-7' }) }))
    const continuation=ToolCallId('continuation-call')
    session.append('tool/call',{ turn:1,step:1,callId:continuation,name:'opaque_delegate',arguments:'{}' })
    const continued=await ctx.tools.execute({ signal:new AbortController().signal,callId:continuation,name:'opaque_delegate',arguments:{},agent })
    session.append('tool/result',{ turn:1,step:1,message:createToolResultMessage({ callId:continuation,content:continued.content,isError:continued.isError }) },{ surfaceOp:'append' })
    await Promise.resolve()
    expect(ctx.browserTasks.get(agent)?.delegated).toMatchObject([{ callId:'continuation-call',kind:'subagent',status:'running',identity:{ mode:'continuable',subagentId:'child-7' } }])
    session.append('user/message',createUserMessage({ content:[{ type:'text',text:'child settled' }],source:{ kind:'subagent-settled',form:'notice',summary:'child settled',senderSessionId:'child-7' } } as never),{ surfaceOp:'append' })
    await Promise.resolve()
    expect(ctx.browserTasks.get(agent)?.delegated).toMatchObject([{ callId:'continuation-call',kind:'subagent',status:'settled',identity:{ mode:'continuable',subagentId:'child-7' } }])

    ctx.tools.register(defineTool({ name:'opaque_background',description:'opaque',parameters:{},output:{ schema:{ type:'json' },render:()=>[{ type:'text',text:'done' }] },
      execute:async()=>({ kind:'background',jobId:'job-7' }) }))
    const background=ToolCallId('background-shape-call')
    session.append('tool/call',{ turn:1,step:1,callId:background,name:'opaque_background',arguments:'{}' })
    const started=await ctx.tools.execute({ signal:new AbortController().signal,callId:background,name:'opaque_background',arguments:{},agent })
    session.append('tool/result',{ turn:1,step:1,message:createToolResultMessage({ callId:background,content:started.content,isError:started.isError }) },{ surfaceOp:'append' })
    await Promise.resolve()
    expect(ctx.browserTasks.get(agent)?.delegated).toContainEqual(expect.objectContaining({ callId:'background-shape-call',kind:'job',status:'running',identity:{ mode:'background',jobId:'job-7' } }))

    ctx.tools.register(defineTool({ name:'job_output',description:'opaque',parameters:{},output:{ schema:{ type:'json' },render:()=>[{ type:'text',text:'done' }] },
      execute:async()=>({ text:'done',job:{ id:'job-7',status:'completed' } }) }))
    const collection=ToolCallId('collection-shape-call')
    session.append('tool/call',{ turn:1,step:1,callId:collection,name:'job_output',arguments:'{}' })
    const collected=await ctx.tools.execute({ signal:new AbortController().signal,callId:collection,name:'job_output',arguments:{},agent })
    session.append('tool/result',{ turn:1,step:1,message:createToolResultMessage({ callId:collection,content:collected.content,isError:collected.isError }) },{ surfaceOp:'append' })
    await Promise.resolve()
    const completed = ctx.browserTasks.get(agent)?.delegated.find(item => item.callId==='background-shape-call')
    expect(completed).toMatchObject({ kind:'job',status:'completed',identity:{ mode:'background',jobId:'job-7' } })
    expect(completed?.outputDigest).toMatch(/^sha256:/u)
  })
  it('keeps the real background job id pending until its terminal result is collected',async()=>{
    const{ ctx,agent,session }=await h();create(ctx,agent)
    ctx.tools.register(defineTool({
      name:'subagent_background',description:'delegate in background',parameters:{},output:{ schema:{ type:'json' },render:()=>[{ type:'text',text:'started' }] },
      execute:async()=>({ kind:'background',jobId:'subagent-42' }),
    }))
    const call=session.append('tool/call',{ turn:1,step:1,callId:ToolCallId('background-call'),name:'subagent_background',arguments:'{}' })
    const result=await ctx.tools.execute({ signal:new AbortController().signal,callId:ToolCallId('background-call'),name:'subagent_background',arguments:{},agent })
    session.append('tool/result',{ turn:1,step:1,message:createToolResultMessage({ callId:ToolCallId('background-call'),content:result.content,isError:result.isError }) },{ surfaceOp:'append',sourceEventSeqs:[call.seq] })
    await Promise.resolve()
    expect(ctx.browserTasks.get(agent) as unknown).toMatchObject({
      blockers:['delegated-work'],delegated:[{ callId:'background-call',kind:'job',status:'running',identity:{ mode:'background',jobId:'subagent-42' } }],
    })
    ctx.tools.register(defineTool({
      name:'job_output',description:'collect background output',parameters:{},output:{ schema:{ type:'json' },render:()=>[{ type:'text',text:'collected' }] },
      execute:async()=>({ text:'review complete',job:{ id:'subagent-42',kind:'subagent',label:'review',status:'completed',startedAt:1,finishedAt:2 } }),
    }))
    const collect=session.append('tool/call',{ turn:1,step:1,callId:ToolCallId('job-output-call'),name:'job_output',arguments:'{}' })
    const collected=await ctx.tools.execute({ signal:new AbortController().signal,callId:ToolCallId('job-output-call'),name:'job_output',arguments:{ job_id:'subagent-42' },agent })
    session.append('tool/result',{ turn:1,step:1,message:createToolResultMessage({ callId:ToolCallId('job-output-call'),content:collected.content,isError:collected.isError }) },{ surfaceOp:'append',sourceEventSeqs:[collect.seq] })
    await Promise.resolve()
    const completed = ctx.browserTasks.get(agent)
    expect(completed).toMatchObject({ blockers:[] })
    const background = completed?.delegated.find(item => item.callId==='background-call')
    expect(background).toMatchObject({ status:'completed',identity:{ mode:'background',jobId:'subagent-42' } })
    expect(background?.outputDigest).toMatch(/^sha256:/u)
  })
  it('records exact Cordis package and run identities instead of the tool name',async()=>{
    const{ ctx,agent,session }=await h();create(ctx,agent)
    ctx.tools.register(defineTool({
      name:'cordis_run',description:'run package',parameters:{},output:{ schema:{ type:'json' },render:()=>[{ type:'text',text:'starting' }] },
      execute:async()=>({ status:'starting',pluginId:'plugin-a',packageId:'package-v2',pluginRunId:'run-9' }),
    }))
    const call=session.append('tool/call',{ turn:1,step:1,callId:ToolCallId('cordis-call'),name:'cordis_run',arguments:'{}' })
    const result=await ctx.tools.execute({ signal:new AbortController().signal,callId:ToolCallId('cordis-call'),name:'cordis_run',arguments:{},agent })
    session.append('tool/result',{ turn:1,step:1,message:createToolResultMessage({ callId:ToolCallId('cordis-call'),content:result.content,isError:result.isError }) },{ surfaceOp:'append',sourceEventSeqs:[call.seq] })
    await Promise.resolve()
    expect(ctx.browserTasks.get(agent)).toMatchObject({
      blockers:['delegated-work'],delegated:[{ callId:'cordis-call',kind:'cordis',status:'starting',identity:{ mode:'cordis',pluginId:'plugin-a',packageId:'package-v2',pluginRunId:'run-9' } }],
    })
  })
  it('treats a running Cordis activation as terminal and resolves a pending one from canonical inspection',async()=>{
    const{ ctx,agent,session }=await h();create(ctx,agent)
    ctx.tools.register(defineTool({ name:'cordis_run',description:'run',parameters:{},output:{ schema:{ type:'json' },render:()=>[{ type:'text',text:'done' }] },
      execute:async()=>({ status:'starting',pluginId:'plugin-a',packageId:'package-v2',pluginRunId:'run-9' }) }))
    const run=ToolCallId('cordis-pending')
    session.append('tool/call',{ turn:1,step:1,callId:run,name:'cordis_run',arguments:'{}' })
    const started=await ctx.tools.execute({ signal:new AbortController().signal,callId:run,name:'cordis_run',arguments:{},agent })
    session.append('tool/result',{ turn:1,step:1,message:createToolResultMessage({ callId:run,content:started.content,isError:started.isError }) },{ surfaceOp:'append' })
    await Promise.resolve(); expect(ctx.browserTasks.get(agent)?.blockers).toContain('delegated-work')
    ctx.tools.register(defineTool({ name:'cordis_inspect_self',description:'inspect',parameters:{},output:{ schema:{ type:'json' },render:()=>[{ type:'text',text:'done' }] },
      execute:async()=>({ mode:'plugin',pluginId:'plugin-a',state:'running',activeRun:{ pluginRunId:'run-9',packageId:'package-v2' } }) }))
    const inspect=ToolCallId('cordis-inspect')
    session.append('tool/call',{ turn:1,step:1,callId:inspect,name:'cordis_inspect_self',arguments:'{}' })
    const inspected=await ctx.tools.execute({ signal:new AbortController().signal,callId:inspect,name:'cordis_inspect_self',arguments:{},agent })
    session.append('tool/result',{ turn:1,step:1,message:createToolResultMessage({ callId:inspect,content:inspected.content,isError:inspected.isError }) },{ surfaceOp:'append' })
    await Promise.resolve()
    expect(ctx.browserTasks.get(agent)).toMatchObject({ blockers:[],delegated:[{ callId:'cordis-pending',kind:'cordis',status:'running',identity:{ mode:'cordis',pluginId:'plugin-a',packageId:'package-v2',pluginRunId:'run-9' } }] })
  })
  it('rejects a forged receipt from another browser task before an evidence change cites it',async()=>{const{ ctx,agent,session }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordCapability(agent,t,cap);const receipt=session.append('browser-task/receipt',{ kind:'browser-task/receipt',version:1,taskId:'other-task' as never,requestId:'r',actionKind:'snapshot',target,outcome:'observed',delivery:'sent',quiescent:true,grantEpoch:1 });session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'evidence',task:{ ...t,revision:t.revision+1,updatedAt:t.updatedAt+1,evidence:[{ ...evidence,source:{ kind:'browser-task-receipt',sessionSeq:receipt.seq } }] } } as never);expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')})
  it('rejects presentation proof owned by another browser task',async()=>{
    const { ctx,agent,session }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'reserved',target })
    const presentation={ contentDigest:`sha256:${'a'.repeat(64)}`,excerpt:'证据' }
    const receipt=session.append('browser-task/receipt',{ kind:'browser-task/receipt',version:1,taskId:'other-task' as never,
      requestId:'foreign-render',actionKind:'region_render',target,outcome:'observed',delivery:'sent',quiescent:true,
      grantEpoch:1,resourceId:'panel',presentation })
    session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'resource',task:{ ...t,
      revision:t.revision+1,updatedAt:t.updatedAt+1,resources:[{ id:'panel',state:'active',target,
        presentation:{ ...presentation,renderReceipt:{ kind:'browser-task-receipt',sessionSeq:receipt.seq } } }],
    } } as never)
    expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')
  })
  it('stales evidence for human interaction and rejects a generic acknowledgement',async()=>{const{ ctx,agent }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordCapability(agent,t,cap);t=ctx.browserTasks.recordEvidence(agent,t,evidence);t=ctx.browserTasks.transition(agent,t,'waiting',['human-interaction']);expect(t.evidence[0]?.state).toBe('stale');expect(()=>ctx.browserTasks.transition(agent,t,'running',[])).toThrow(expect.objectContaining({ code:'BROWSER_TASK_INVALID_TRANSITION' }));expect(()=>ctx.browserTasks.acknowledgeHumanInteraction(agent,t)).toThrow(expect.objectContaining({ code:'BROWSER_TASK_INVALID_TRANSITION' }))})
  it('reconciles one unknown attempt while retaining an observed receipt',async()=>{const{ ctx,agent }=await h();let t=create(ctx,agent);for(const id of ['a','b']){t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:id,requestId:id,stage:'planned',write:true,target }) as never);t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:id,requestId:id,stage:'dispatched',write:true,target }) as never)}const observed=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'a',actionKind:'click',target,outcome:'observed',delivery:'sent',quiescent:true,grantEpoch:1 });t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'a',stage:'settled',outcome:'observed',quiescent:true,settledBy:observed,write:true,target }) as never);const unknown=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'b',actionKind:'click',target,outcome:'unknown',delivery:'sent',quiescent:false,grantEpoch:1 });t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'b',requestId:'b',stage:'settled',outcome:'unknown',quiescent:false,settledBy:unknown,write:true,target }) as never);const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'b',actionKind:'click',target,outcome:'observed',delivery:'sent',quiescent:true,grantEpoch:1 });t=ctx.browserTasks.reconcileAttempt(agent,t,attempt({ attemptId:'b',requestId:'b',stage:'settled',outcome:'observed',quiescent:true,settledBy:receipt,write:true,target,reconciledBy:receipt }) as never);expect(t.attempts.map(item=>item.outcome)).toEqual(['observed','observed'])})
  it('rejects malformed receipt and check before they change the Session log',async()=>{const{ ctx,agent,session }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'a',requestId:'a',stage:'planned',write:true,target }) as never);t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'a',stage:'dispatched',write:true,target }) as never);const count=session.snapshotEvents().length;expect(()=>ctx.browserTasks.recordReceipt(agent,t,{ requestId:'a',actionKind:'click',target,outcome:'observed',delivery:'sent',quiescent:false,grantEpoch:1 })).toThrow();expect(session.snapshotEvents()).toHaveLength(count);expect(()=>ctx.browserTasks.recordCheck(agent,t,{ checkerId:'',target,grantEpoch:1,evaluations:[] })).toThrow();expect(session.snapshotEvents()).toHaveLength(count)})
  it('persists a deterministic failure fingerprint through projection replay',async()=>{
    const{ ctx,agent,session }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'failure',requestId:'failure',actionKind:'region_render',stage:'planned',write:true,target,resourceId:'panel' }) as never)
    const failureFingerprint=`sha256:${'a'.repeat(64)}`
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'failure',actionKind:'region_render',target,
      outcome:'failed',delivery:'not-sent',quiescent:true,grantEpoch:1,resourceId:'panel',
      reason:'region_ref_not_current',failureFingerprint })
    t=ctx.browserTasks.advanceAttempt(agent,t,{ ...t.attempts[0]!,stage:'settled',outcome:'failed',quiescent:true,settledBy:receipt })
    expect(ctx.sessionProjections.stateOf(session,'browserTask')?.sourceFacts).toContainEqual(expect.objectContaining({
      kind:'browser-task-receipt',sessionSeq:receipt.sessionSeq,failureFingerprint,
    }))
    expect(foldBrowserTask(session.snapshotEvents())?.attempts[0]?.settledBy).toEqual(receipt)
  })
  it('rejects a malformed deterministic failure fingerprint before append',async()=>{
    const{ ctx,agent,session }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'failure',requestId:'failure',actionKind:'region_render',stage:'planned',write:true,target,resourceId:'panel' }) as never)
    const before=session.snapshotEvents().length
    expect(()=>ctx.browserTasks.recordReceipt(agent,t,{ requestId:'failure',actionKind:'region_render',target,
      outcome:'failed',delivery:'not-sent',quiescent:true,grantEpoch:1,resourceId:'panel',
      reason:'region_ref_not_current',failureFingerprint:'sha256:not-a-digest' })).toThrow()
    expect(session.snapshotEvents()).toHaveLength(before)
  })
  it('accepts a checkpoint carrying a bounded browser task check fact',()=>{expect(browserTaskProjectionDefinition.stateSchema.parse({ current:null,recentTaskIds:[],lastSourceSeq:1,lastTaskSourceSeq:-1,sourceFacts:[{ kind:'browser-task-check',sessionSeq:1,taskId:'task',checkerId:'check',target,grantEpoch:1,evaluations:[] }],pendingDelegations:[],failure:null }).sourceFacts[0]?.kind).toBe('browser-task-check')})
  it('rejects raw user references for unknown reconciliation and final resources',async()=>{const{ ctx,agent,session }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'a',requestId:'a',stage:'planned',write:true,target }) as never);t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'a',stage:'dispatched',write:true,target }) as never);const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'a',actionKind:'click',target,outcome:'unknown',delivery:'sent',quiescent:false,grantEpoch:1 });t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'a',stage:'settled',outcome:'unknown',quiescent:false,settledBy:receipt,write:true,target }) as never);session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'reconcile-attempt',task:{ ...t,revision:t.revision+1,updatedAt:t.updatedAt+1,attempts:[{ ...t.attempts[0],outcome:'observed',quiescent:true,settledBy:{ kind:'user',sessionSeq:0 },reconciledBy:{ kind:'user',sessionSeq:0 } }] } } as never);expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')})
  it('rejects a raw observed settlement without a matching receipt',async()=>{
    const{ ctx,agent,session }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'a',requestId:'a',stage:'planned',write:true,target }) as never)
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'a',stage:'dispatched',write:true,target }) as never)
    session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'attempt',task:{ ...t,revision:t.revision+1,updatedAt:t.updatedAt+1,attempts:[{ ...t.attempts[0],stage:'settled',outcome:'observed',quiescent:true }] } } as never)
    expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')
  })
  it('settles a prepared action that was conclusively not sent',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'a',requestId:'a',stage:'planned',write:true,target }) as never)
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'a',stage:'prepared',write:true,target }) as never)
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'a',actionKind:'click',target,outcome:'failed',delivery:'not-sent',quiescent:true,grantEpoch:1,reason:'approval-denied' })
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'a',stage:'settled',outcome:'failed',quiescent:true,settledBy:receipt,write:true,target }) as never)
    expect(t.attempts[0]).toMatchObject({ stage:'settled',outcome:'failed',settledBy:receipt })
  })
  it('replays a flushed dispatch intent as an unresolved write until a receipt settles it',async()=>{
    const{ ctx,agent,session }=await h();let t=create(ctx,agent)
    const planned=attempt({ attemptId:'intent',requestId:'intent',stage:'planned',write:true,target })
    t=ctx.browserTasks.recordAttempt(agent,t,planned as never)
    t=ctx.browserTasks.advanceAttempt(agent,t,{ ...planned,stage:'dispatch-intent' } as never)
    expect(t.blockers).toContain('unknown-attempt')
    const replayed=foldBrowserTask(session.snapshotEvents())
    expect(replayed?.revision).toBe(t.revision)
    expect(replayed?.blockers).toEqual(expect.arrayContaining(['unknown-attempt']))
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'intent',actionKind:'click',target,
      outcome:'failed',delivery:'not-sent',quiescent:true,grantEpoch:1,reason:'durability_unavailable' })
    t=ctx.browserTasks.advanceAttempt(agent,t,{ ...planned,stage:'settled',outcome:'failed',quiescent:true,settledBy:receipt } as never)
    expect(t.blockers).not.toContain('unknown-attempt')
  })
  it('governs a provider operation from admission through flushed dispatch and settlement',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordCapability(agent,t,cap)
    let flushes=0;ctx.on('session/flush',()=>{flushes+=1})
    const operation={ requestId:'provider-operation',sessionId:agent.session.id,installationId:target.installationId,
      action:{ kind:'click' as const,element:{ page:target.page,snapshotId:'snapshot',elementId:'go' },intent:'open' } }
    const operationContext={ operation,phase:'execute' as const,logicalMutates:true }
    const admitted=await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',operationContext,
      ()=>({ kind:'allow' as const })))
    expect(admitted).toEqual({ kind:'allow' })
    expect(ctx.browserTasks.get(agent)).toMatchObject({ budget:{ actionsUsed:1 },
      attempts:[{ requestId:'provider-operation',stage:'planned',write:true }] })
    const dispatched=await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/dispatch-intent',{
      ...operationContext,transportRequestId:operation.requestId,transportMutates:true,grantEpoch:1 },
    ()=>({ kind:'allow' as const })))
    expect(dispatched).toEqual({ kind:'allow' });expect(flushes).toBe(1)
    const afterDispatch=ctx.browserTasks.get(agent)
    expect(afterDispatch?.blockers).toEqual(expect.arrayContaining(['unknown-attempt']))
    expect(afterDispatch?.attempts).toMatchObject([{ requestId:'provider-operation',stage:'dispatch-intent',recoveryLocator:{ kind:'extension-journal-v1',
      protocolVersion:1,transportRequestId:'provider-operation',installationId:target.installationId,grantEpoch:1 } }])
    await ctx.agents.withInitiator(agent,()=>ctx.parallel('browser/operation-settled',operationContext,{ kind:'result',result:{
      requestId:operation.requestId,sessionId:agent.session.id,installationId:target.installationId,outcome:'observed',delivery:'sent',value:{ clicked:true },
    } }))
    expect(ctx.browserTasks.get(agent)).toMatchObject({ blockers:[],
      attempts:[{ requestId:'provider-operation',stage:'settled',outcome:'observed' }] })
  })
  it('dispatches a stronger forget-collected finalizer after the entry lease was released',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordCapability(agent,t,{ ...cap,
      actions:['entry_mount','entry_unmount'] });ctx.on('session/flush',()=>{})
    const run=async(requestId:string,action:{ kind:'entry_mount';page:typeof target.page;mountId:string;regionSelector:string;selector:string;label:string }
      |{ kind:'entry_unmount';page:typeof target.page;mountId:string;forgetCollected?:boolean },value:object)=>{
      const operation={ requestId,sessionId:agent.session.id,installationId:target.installationId,action }
      const context={ operation,phase:'execute' as const,logicalMutates:true }
      const admitted=await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',context,
        ()=>({ kind:'allow' as const })))
      if(admitted.kind==='deny')return admitted
      expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/dispatch-intent',{
        ...context,transportRequestId:requestId,transportMutates:true,grantEpoch:1,
      },()=>({ kind:'allow' as const })))).toEqual({ kind:'allow' })
      await ctx.agents.withInitiator(agent,()=>ctx.parallel('browser/operation-settled',context,{ kind:'result' as const,result:{
        requestId,sessionId:agent.session.id,installationId:target.installationId,
        outcome:'observed' as const,delivery:'sent' as const,value,
      } }))
      return admitted
    }
    const mountId='retained-collection'
    await run('mount-entry',{ kind:'entry_mount',page:target.page,mountId,regionSelector:'main',selector:'article',label:'Collect' },{ mounted:1 })
    await run('ordinary-unmount',{ kind:'entry_unmount',page:target.page,mountId },{ unmounted:true,remaining:0 })
    const released=ctx.browserTasks.get(agent)!
    expect(released.resources).toMatchObject([{ id:mountId,state:'released' }])
    const ordinary={ requestId:'repeat-unmount',sessionId:agent.session.id,installationId:target.installationId,
      action:{ kind:'entry_unmount' as const,page:target.page,mountId } }
    expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',{
      operation:ordinary,phase:'execute' as const,logicalMutates:true },()=>({ kind:'allow' as const }))))
      .toMatchObject({ kind:'deny',result:{ reason:'already_released' } })

    expect(await run('forget-collection',{ kind:'entry_unmount',page:target.page,mountId,forgetCollected:true },
      { unmounted:true,remaining:0 })).toEqual({ kind:'allow' })
    expect(ctx.browserTasks.get(agent)).toMatchObject({ budget:released.budget,blockers:[],
      resources:[{ id:mountId,state:'released' }],attempts:[
        { requestId:'mount-entry',stage:'settled' },{ requestId:'ordinary-unmount',stage:'settled' },
        { requestId:'forget-collection',stage:'settled',outcome:'observed' },
      ] })
  })
  it('admits an owner-fenced collection finalizer without a current-task mount lease as a budgeted write',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordCapability(agent,t,{ ...cap,
      actions:['entry_unmount'] })
    const operation={ requestId:'late-forget',sessionId:agent.session.id,installationId:target.installationId,
      action:{ kind:'entry_unmount' as const,page:target.page,mountId:'prior-task-mount',forgetCollected:true } }
    expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',{
      operation,phase:'execute' as const,logicalMutates:true },()=>({ kind:'allow' as const })))).toEqual({ kind:'allow' })
    expect(ctx.browserTasks.get(agent)).toMatchObject({ budget:{ actionsUsed:1 },resources:[],
      attempts:[{ requestId:'late-forget',stage:'planned',resourceId:'prior-task-mount' }] })
  })
  it('governs a direct prepared operation once across prepare and commit',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordCapability(agent,t,cap)
    let flushes=0;ctx.on('session/flush',()=>{flushes+=1})
    const operation={ requestId:'direct-prepared',sessionId:agent.session.id,installationId:target.installationId,
      action:{ kind:'click' as const,element:{ page:target.page,snapshotId:'snapshot',elementId:'go' },intent:'open' } }
    const prepareContext={ operation,phase:'prepare' as const,logicalMutates:true }
    expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',prepareContext,
      ()=>({ kind:'allow' as const })))).toEqual({ kind:'allow' })
    await ctx.agents.withInitiator(agent,()=>ctx.parallel('browser/operation-settled',prepareContext,{ kind:'prepared' as const }))
    expect(ctx.browserTasks.get(agent)).toMatchObject({ budget:{ actionsUsed:0 }, attempts:[] })
    const commitContext={ operation,phase:'prepared-commit' as const,logicalMutates:true }
    expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',commitContext,
      ()=>({ kind:'allow' as const })))).toEqual({ kind:'allow' })
    expect(ctx.browserTasks.get(agent)).toMatchObject({ budget:{ actionsUsed:1 },
      attempts:[{ requestId:'direct-prepared',stage:'planned' }] })
    expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/dispatch-intent',{
      ...commitContext,transportRequestId:operation.requestId,transportMutates:true,grantEpoch:1 },
    ()=>({ kind:'allow' as const })))).toEqual({ kind:'allow' })
    expect(flushes).toBe(1)
    await ctx.agents.withInitiator(agent,()=>ctx.parallel('browser/operation-settled',commitContext,{ kind:'result' as const,result:{
      requestId:operation.requestId,sessionId:agent.session.id,installationId:target.installationId,
      outcome:'observed' as const,delivery:'sent' as const,value:{ clicked:true },
    } }))
    expect(ctx.browserTasks.get(agent)).toMatchObject({ budget:{ actionsUsed:1 },blockers:[],
      attempts:[{ requestId:'direct-prepared',stage:'settled',outcome:'observed' }] })
  })
  it('blocks exhausted and replayed writes while keeping exact cleanup free',async()=>{
    const{ ctx,agent }=await h();let t=ctx.browserTasks.create(agent,{ objective:'bounded direct task',sourceSeq:0,target,
      acceptance:[{ id:'url',kind:'url-equals',url:target.page.url }],maxSteps:2,maxActions:1 })
    t=ctx.browserTasks.recordCapability(agent,t,cap);ctx.on('session/flush',()=>{})
    const renderOperation={ requestId:'bounded-render',sessionId:agent.session.id,installationId:target.installationId,
      action:{ kind:'region_render' as const,page:target.page,mountId:'bounded-panel',
        regionRef:'11111111-1111-4111-8111-111111111111',presentation:{ summary:'bounded' } } }
    const renderContext={ operation:renderOperation,phase:'execute' as const,logicalMutates:true }
    expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',renderContext,
      ()=>({ kind:'allow' as const })))).toEqual({ kind:'allow' })
    expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/dispatch-intent',{
      ...renderContext,transportRequestId:renderOperation.requestId,transportMutates:true,grantEpoch:1 },
    ()=>({ kind:'allow' as const })))).toEqual({ kind:'allow' })
    await ctx.agents.withInitiator(agent,()=>ctx.parallel('browser/operation-settled',renderContext,{ kind:'result',result:{
      requestId:renderOperation.requestId,sessionId:agent.session.id,installationId:target.installationId,
      outcome:'observed',delivery:'sent',value:{ rendered:1 },
    } }))
    expect(ctx.browserTasks.get(agent)).toMatchObject({ budget:{ actionsUsed:1 },resources:[{ id:'bounded-panel',state:'active' }] })
    expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',renderContext,
      ()=>({ kind:'allow' as const })))).toMatchObject({ kind:'deny',result:{ delivery:'not-sent',reason:'browser_task_reconcile_required' } })
    const click={ requestId:'over-budget',sessionId:agent.session.id,installationId:target.installationId,
      action:{ kind:'click' as const,element:{ page:target.page,snapshotId:'snapshot',elementId:'go' },intent:'open' } }
    const prepare={ operation:click,phase:'prepare' as const,logicalMutates:true }
    expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',prepare,
      ()=>({ kind:'allow' as const })))).toEqual({ kind:'allow' })
    expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',{
      ...prepare,phase:'prepared-commit' as const },()=>({ kind:'allow' as const })))).toMatchObject({
      kind:'deny',result:{ outcome:'failed',delivery:'not-sent',reason:'browser_task_budget_exhausted' } })
    expect(ctx.browserTasks.get(agent)).toMatchObject({ budget:{ actionsUsed:1 },attempts:[{ requestId:'bounded-render' }] })
    const clearOperation={ requestId:'bounded-clear',sessionId:agent.session.id,installationId:target.installationId,
      action:{ kind:'region_clear' as const,page:target.page,mountId:'bounded-panel' } }
    const clearContext={ operation:clearOperation,phase:'execute' as const,logicalMutates:true }
    expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',clearContext,
      ()=>({ kind:'allow' as const })))).toEqual({ kind:'allow' })
    expect(ctx.browserTasks.get(agent)).toMatchObject({ budget:{ actionsUsed:1 },resources:[{ id:'bounded-panel',state:'release-pending' }] })
  })
  it('drops process-local provider ownership when its Agent is disposed',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordCapability(agent,t,cap)
    const operation={ requestId:'dispose-owned',sessionId:agent.session.id,installationId:target.installationId,
      action:{ kind:'click' as const,element:{ page:target.page,snapshotId:'snapshot',elementId:'go' },intent:'open' } }
    expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',{
      operation,phase:'execute' as const,logicalMutates:true },()=>({ kind:'allow' as const })))).toEqual({ kind:'allow' })
    const owned=(ctx.browserTasks as unknown as { providerOwned:Set<string> }).providerOwned
    expect(owned.size).toBe(1)
    await ctx.parallel('agent/disposed',{ agent })
    expect(owned.size).toBe(0)
  })
  it('applies deterministic recovery and page-map evidence to direct provider calls',async()=>{
    const{ ctx,agent }=await h();let t=ctx.browserTasks.create(agent,{ objective:'prove task',sourceSeq:0,target,
      acceptance:[{ id:'url',kind:'url-equals',url:target.page.url }],maxSteps:3,maxActions:4 })
    t=ctx.browserTasks.recordCapability(agent,t,cap)
    const invoke=async(requestId:string,action:{ kind:'region_render';page:typeof target.page;mountId:string;regionRef:string;presentation:{ summary:string } }|{ kind:'page_map';page:typeof target.page },result:{ outcome:'observed'|'failed';delivery:'sent'|'not-sent';reason?:string;value?:object })=>{
      const operation={ requestId,sessionId:agent.session.id,installationId:target.installationId,action }
      const context={ operation,phase:'execute' as const,logicalMutates:action.kind==='region_render' }
      const decision=await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',context,()=>({ kind:'allow' as const })))
      if(decision.kind==='deny')return decision
      await ctx.agents.withInitiator(agent,()=>ctx.parallel('browser/operation-settled',context,{ kind:'result' as const,result:{
        requestId,sessionId:agent.session.id,installationId:target.installationId,...result,
      } }))
      return decision
    }
    const render={ kind:'region_render' as const,page:target.page,mountId:'panel',regionRef:'11111111-1111-4111-8111-111111111111',presentation:{ summary:'result' } }
    await invoke('direct-failure',render,{ outcome:'failed',delivery:'not-sent',reason:'region_ref_not_current' })
    expect(ctx.browserTasks.get(agent)).toMatchObject({ phase:'waiting',blockers:['repeated-error'] })
    expect(await invoke('same-target',{ ...render,mountId:'renamed' },{ outcome:'observed',delivery:'sent',value:{ rendered:1 } }))
      .toMatchObject({ kind:'deny' })
    await invoke('direct-page-map',{ kind:'page_map',page:target.page },{ outcome:'observed',delivery:'sent',
      value:{ page:target.page,regions:[{ regionRef:'22222222-2222-4222-8222-222222222222',disposable:true,protected:false }] } })
    expect(ctx.browserTasks.get(agent)?.evidence.at(-1)).toMatchObject({ pageMap:{ regions:[{ regionRef:'22222222-2222-4222-8222-222222222222',disposable:true,protected:false }] } })
    expect(await invoke('recovered-target',{ ...render,mountId:'renamed',regionRef:'22222222-2222-4222-8222-222222222222' },{ outcome:'observed',delivery:'sent',value:{ rendered:1 } }))
      .toEqual({ kind:'allow' })
    expect(ctx.browserTasks.get(agent)).toMatchObject({ phase:'running',blockers:[] })
  })
  it('denies a write when no durability listener can persist its dispatch intent',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordCapability(agent,t,cap)
    const operation={ requestId:'unpersisted-operation',sessionId:agent.session.id,installationId:target.installationId,
      action:{ kind:'click' as const,element:{ page:target.page,snapshotId:'snapshot',elementId:'go' },intent:'open' } }
    const operationContext={ operation,phase:'execute' as const,logicalMutates:true }
    expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',operationContext,
      ()=>({ kind:'allow' as const })))).toEqual({ kind:'allow' })
    const decision=await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/dispatch-intent',{
      ...operationContext,transportRequestId:operation.requestId,transportMutates:true,grantEpoch:1 },
    ()=>({ kind:'allow' as const })))
    expect(decision).toMatchObject({ kind:'deny',result:{ outcome:'failed',delivery:'not-sent',reason:'durability_unavailable' } })
    if(decision.kind!=='deny')throw new Error('expected dispatch denial')
    await ctx.agents.withInitiator(agent,()=>ctx.parallel('browser/operation-settled',operationContext,
      { kind:'result',result:decision.result }))
    expect(ctx.browserTasks.get(agent)).toMatchObject({ blockers:[],
      attempts:[{ requestId:'unpersisted-operation',stage:'settled',outcome:'failed' }] })
  })
  it('rejects a changed grant epoch as not-sent capability drift before dispatch intent',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordCapability(agent,t,cap)
    const operation={ requestId:'stale-epoch-operation',sessionId:agent.session.id,installationId:target.installationId,
      action:{ kind:'click' as const,element:{ page:target.page,snapshotId:'snapshot',elementId:'go' },intent:'open' } }
    const operationContext={ operation,phase:'execute' as const,logicalMutates:true }
    expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',operationContext,
      ()=>({ kind:'allow' as const })))).toEqual({ kind:'allow' })
    const decision=await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/dispatch-intent',{
      ...operationContext,transportRequestId:operation.requestId,transportMutates:true,grantEpoch:2 },
    ()=>({ kind:'allow' as const })))
    expect(decision).toMatchObject({ kind:'deny',result:{ outcome:'failed',delivery:'not-sent',reason:'browser_task_capability_drift' } })
    expect(ctx.browserTasks.get(agent)).toMatchObject({ phase:'waiting',blockers:['capability-drift'],
      attempts:[{ requestId:'stale-epoch-operation',stage:'planned',grantEpoch:1 }] })
    if(decision.kind!=='deny')throw new Error('expected epoch denial')
    await ctx.agents.withInitiator(agent,()=>ctx.parallel('browser/operation-settled',operationContext,
      { kind:'result',result:decision.result }))
    expect(ctx.browserTasks.get(agent)).toMatchObject({ phase:'waiting',blockers:['capability-drift'],
      attempts:[{ requestId:'stale-epoch-operation',stage:'settled',outcome:'failed' }] })
  })
  it('owns and releases a page resource created through the provider execution policy',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent);t=ctx.browserTasks.recordCapability(agent,t,cap)
    ctx.on('session/flush',()=>{})
    const run=async(requestId:string,action:{ kind:'region_render';page:typeof target.page;mountId:string;regionRef:string;presentation:{ summary:string } }|{ kind:'region_clear';page:typeof target.page;mountId:string },value:object)=>{
      const operation={ requestId,sessionId:agent.session.id,installationId:target.installationId,action }
      const context={ operation,phase:'execute' as const,logicalMutates:true }
      expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',context,()=>({ kind:'allow' as const })))).toEqual({ kind:'allow' })
      expect(await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/dispatch-intent',{ ...context,transportRequestId:requestId,transportMutates:true,grantEpoch:1 },()=>({ kind:'allow' as const })))).toEqual({ kind:'allow' })
      await ctx.agents.withInitiator(agent,()=>ctx.parallel('browser/operation-settled',context,{ kind:'result',result:{
        requestId,sessionId:agent.session.id,installationId:target.installationId,outcome:'observed',delivery:'sent',value,
      } }))
    }
    await run('render',{ kind:'region_render',page:target.page,mountId:'panel',regionRef:'11111111-1111-4111-8111-111111111111',presentation:{ summary:'result' } },{ rendered:1 })
    expect(ctx.browserTasks.get(agent)?.resources).toMatchObject([{ id:'panel',state:'active' }])
    await run('clear',{ kind:'region_clear',page:target.page,mountId:'panel' },{ cleared:true })
    expect(ctx.browserTasks.get(agent)?.resources).toMatchObject([{ id:'panel',state:'released',disposition:'clear-observed' }])
  })
  it('binds provider-rendered presentation intent to its exact receipt',async()=>{
    const{ ctx,agent }=await h()
    let t=ctx.browserTasks.create(agent,{ objective:'show result',sourceSeq:0,target,
      acceptance:[{ id:'region',kind:'region-content',resourceId:'panel',text:'result' }],maxSteps:3,maxActions:2 })
    t=ctx.browserTasks.recordCapability(agent,t,cap);ctx.on('session/flush',()=>{})
    const operation={ requestId:'presentation-render',sessionId:agent.session.id,installationId:target.installationId,
      action:{ kind:'region_render' as const,page:target.page,mountId:'panel',regionRef:'11111111-1111-4111-8111-111111111111',presentation:{ summary:'result' } } }
    const context={ operation,phase:'execute' as const,logicalMutates:true }
    await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/operation-intent',context,()=>({ kind:'allow' as const })))
    await ctx.agents.withInitiator(agent,()=>ctx.waterfall('browser/dispatch-intent',{ ...context,transportRequestId:operation.requestId,
      transportMutates:true,grantEpoch:1 },()=>({ kind:'allow' as const })))
    await ctx.agents.withInitiator(agent,()=>ctx.parallel('browser/operation-settled',context,{ kind:'result',result:{
      requestId:operation.requestId,sessionId:agent.session.id,installationId:target.installationId,
      outcome:'observed',delivery:'sent',value:{ rendered:1 },
    } }))
    const panel=ctx.browserTasks.get(agent)?.resources[0]
    expect(panel).toMatchObject({ id:'panel',state:'active',presentation:{
      excerpt:'result',renderReceipt:{ kind:'browser-task-receipt' },
    } })
    expect(panel?.presentation?.contentDigest).toMatch(/^sha256:/u)
  })
  it('settles a planned action that was conclusively not sent',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'planned',requestId:'planned',stage:'planned',write:true,target }) as never)
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'planned',actionKind:'click',target,outcome:'cancelled',delivery:'not-sent',quiescent:true,grantEpoch:1,reason:'approval-denied' })
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'planned',requestId:'planned',stage:'settled',outcome:'cancelled',quiescent:true,settledBy:receipt,write:true,target }) as never)
    expect(t.attempts[0]).toMatchObject({ stage:'settled',outcome:'cancelled',settledBy:receipt })
  })
  it.each([
    { label:'releases an observed panel', states:['reserved','active','release-pending','released'], disposition:'clear-observed', delivery:'sent', outcome:'observed', stage:'dispatched' },
    { label:'records a vanished panel after document replacement', states:['reserved','active','release-pending','vanished'], disposition:'document-replaced', delivery:'sent', outcome:'failed', reason:'document_replaced', stage:'dispatched' },
    { label:'releases an unsent reservation', states:['reserved','released'], disposition:'not-sent', delivery:'not-sent', outcome:'failed', stage:'planned' },
  ] as const)('$label only with its matching receipt',async (scenario)=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    const actionKind=scenario.disposition==='clear-observed'?'region_clear':'region_render'
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:scenario.label,requestId:scenario.label,actionKind,stage:'planned',write:true,target,resourceId:'panel' }) as never)
    if(scenario.stage==='dispatched')t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:scenario.label,requestId:scenario.label,actionKind,stage:'dispatched',write:true,target,resourceId:'panel' }) as never)
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:scenario.label,actionKind,target,outcome:scenario.outcome,delivery:scenario.delivery,quiescent:true,grantEpoch:1,resourceId:'panel',...scenario.reason===undefined?{}:{ reason:scenario.reason } })
    for(const [index,state] of scenario.states.entries())t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:state,target,...index===scenario.states.length-1?{ disposition:scenario.disposition,dispositionSource:receipt }:{} })
    expect(t.resources[0]).toMatchObject({ state:scenario.states.at(-1),disposition:scenario.disposition,dispositionSource:receipt })
  })
  it('keeps a released not-sent resource valid across later mutations and replay',async()=>{
    const{ ctx,agent,session }=await h();let t=create(ctx,agent)
    const first=attempt({ attemptId:'first',requestId:'first',actionKind:'region_render',resourceId:'panel',stage:'planned',write:true,target })
    t=ctx.browserTasks.recordAttempt(agent,t,first as never)
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'reserved',target })
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'first',actionKind:'region_render',target,outcome:'failed',delivery:'not-sent',quiescent:true,grantEpoch:1,resourceId:'panel',reason:'region_ref_not_current' })
    t=ctx.browserTasks.advanceAttempt(agent,t,{ ...first,stage:'settled',outcome:'failed',quiescent:true,settledBy:receipt } as never)
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'released',target,disposition:'not-sent',dispositionSource:receipt })
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'second',requestId:'second',stage:'planned',write:true,target }) as never)
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'second-panel',state:'reserved',target })
    expect(t.resources[0]).toMatchObject({ id:'panel',state:'released',disposition:'not-sent',dispositionSource:receipt })
    expect(ctx.browserTasks.get(agent)).toMatchObject({ revision:t.revision,resources:t.resources })
    expect(foldBrowserTask(session.snapshotEvents())).toMatchObject({ revision:t.revision,resources:t.resources })
  })
  it('pauses the task when an internal fold invariant rejects a mutation',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'reserved',target })
    expect(()=>ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'released',target,
      disposition:'clear-observed',dispositionSource:{ kind:'browser-task-receipt',sessionSeq:999 } })).toThrow(
      expect.objectContaining({ code:'BROWSER_TASK_INTERNAL_INVARIANT' }),
    )
    expect(ctx.browserTasks.get(agent)?.phase).toBe('waiting')
    expect(ctx.browserTasks.get(agent)?.blockers).toEqual(expect.arrayContaining(['cleanup','internal-invariant']))
  })
  it('keeps active resources usable while cleanup-pending states still block completion',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'reserved',target })
    expect(t.blockers).toContain('cleanup')
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'active',target })
    expect(t.blockers).not.toContain('cleanup')
    expect(()=>ctx.browserTasks.terminate(agent,t,'completed')).toThrow()
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'release-pending',target })
    expect(t.blockers).toContain('cleanup')
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'unresolved',target })
    expect(t.blockers).toContain('cleanup')
  })
  it.each([
    { state:'release-pending', terminal:'released', setup:['reserved','active','release-pending'] },
    { state:'unresolved', terminal:'released', setup:['reserved','unresolved'] },
  ] as const)('reconciles a $state resource only to a receipt-backed final state',async ({ setup,terminal })=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'cleanup',requestId:'cleanup',actionKind:'region_clear',stage:'planned',write:true,target,resourceId:'panel' }) as never)
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'cleanup',requestId:'cleanup',actionKind:'region_clear',stage:'dispatched',write:true,target,resourceId:'panel' }) as never)
    for(const state of setup)t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state,target })
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'cleanup',actionKind:'region_clear',target,outcome:'observed',delivery:'sent',quiescent:true,grantEpoch:1,resourceId:'panel' })
    t=ctx.browserTasks.reconcileResource(agent,t,{ id:'panel',state:terminal,target,disposition:'reconcile-observed',dispositionSource:receipt })
    expect(t.resources[0]).toMatchObject({ state:terminal,disposition:'reconcile-observed',dispositionSource:receipt })
    expect(t.blockers).not.toContain('cleanup')
  })
  it('does not let reconcileResource bypass the uncertain-release contract',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'reserved',target })
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'active',target })
    expect(()=>ctx.browserTasks.reconcileResource(agent,t,{ id:'panel',state:'released',target,disposition:'reconcile-observed',dispositionSource:{ kind:'browser-task-receipt',sessionSeq:1 } })).toThrow(BrowserTaskError)
  })
  it('restores an unresolved render to active only from its observed resource receipt',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'render',requestId:'render',stage:'planned',write:true,target,resourceId:'panel' }) as never)
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'render',requestId:'render',stage:'dispatched',write:true,target,resourceId:'panel' }) as never)
    const unknown=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'render',actionKind:'region_render',target,outcome:'unknown',delivery:'sent',quiescent:false,grantEpoch:1,resourceId:'panel',reason:'effect_unverified' })
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'render',requestId:'render',stage:'settled',outcome:'unknown',quiescent:false,settledBy:unknown,write:true,target,resourceId:'panel' }) as never)
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'reserved',target })
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'unresolved',target })
    const observed=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'render',actionKind:'region_render',target,outcome:'observed',delivery:'sent',quiescent:true,grantEpoch:1,resourceId:'panel' })
    t=ctx.browserTasks.reconcileResource(agent,t,{ id:'panel',state:'active',target,disposition:'reconcile-active',dispositionSource:observed })
    expect(t.resources[0]).toMatchObject({ state:'active',disposition:'reconcile-active',dispositionSource:observed })
    expect(t.blockers).not.toContain('cleanup')
  })
  it('clears an unresolved resource only from a new matching clear receipt',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'reserved',target })
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'unresolved',target })
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'clear',requestId:'clear',actionKind:'region_clear',stage:'planned',write:true,target,resourceId:'panel' }) as never)
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'clear',requestId:'clear',actionKind:'region_clear',stage:'dispatched',write:true,target,resourceId:'panel' }) as never)
    const clear=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'clear',actionKind:'region_clear',target,outcome:'observed',delivery:'sent',quiescent:true,grantEpoch:1,resourceId:'panel' })
    t=ctx.browserTasks.reconcileResource(agent,t,{ id:'panel',state:'released',target,disposition:'clear-observed',dispositionSource:clear })
    expect(t.resources[0]).toMatchObject({ state:'released',disposition:'clear-observed',dispositionSource:clear })
  })
  it('rejects a document-replaced disposition without the exact terminal reason',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'panel',requestId:'panel',actionKind:'region_render',stage:'planned',write:true,target,resourceId:'panel' }) as never)
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'panel',requestId:'panel',actionKind:'region_render',stage:'dispatched',write:true,target,resourceId:'panel' }) as never)
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'reserved',target })
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'active',target })
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'release-pending',target })
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'panel',actionKind:'region_render',target,outcome:'failed',delivery:'sent',quiescent:true,grantEpoch:1,resourceId:'panel',reason:'target_url_stale' })
    expect(()=>ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'vanished',target,disposition:'document-replaced',dispositionSource:receipt })).toThrow(BrowserTaskError)
  })
  it.each([
    { label:'entry creation', states:['reserved'] },
    { label:'region update', states:['reserved','active'] },
    { label:'region clear', states:['reserved','active','release-pending'] },
  ] as const)('records $label as vanished on an explicit document replacement',async ({ states })=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'panel',requestId:'panel',actionKind:'region_render',stage:'planned',write:true,target,resourceId:'panel' }) as never)
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'panel',requestId:'panel',actionKind:'region_render',stage:'dispatched',write:true,target,resourceId:'panel' }) as never)
    for(const state of states)t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state,target })
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'panel',actionKind:'region_render',target,outcome:'failed',delivery:'sent',quiescent:true,grantEpoch:1,resourceId:'panel',reason:'document_replaced' })
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'vanished',target,disposition:'document-replaced',dispositionSource:receipt })
    expect(t.resources[0]).toMatchObject({ state:'vanished',disposition:'document-replaced',dispositionSource:receipt })
  })
  it.each([
    { label:'entry creation', states:['reserved'] },
    { label:'region update', states:['reserved','active'] },
    { label:'region clear', states:['reserved','active','release-pending'] },
  ] as const)('does not treat $label target_url_stale as document replacement',async ({ states })=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'panel',requestId:'panel',actionKind:'region_render',stage:'planned',write:true,target,resourceId:'panel' }) as never)
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'panel',requestId:'panel',actionKind:'region_render',stage:'dispatched',write:true,target,resourceId:'panel' }) as never)
    for(const state of states)t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state,target })
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'panel',actionKind:'region_render',target,outcome:'failed',delivery:'sent',quiescent:true,grantEpoch:1,resourceId:'panel',reason:'target_url_stale' })
    expect(()=>ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'vanished',target,disposition:'document-replaced',dispositionSource:receipt })).toThrow(BrowserTaskError)
  })
  it('reconciles an unknown document-replaced resource to vanished while retaining attempt uncertainty',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'render',requestId:'render',actionKind:'region_render',stage:'planned',write:true,target,resourceId:'panel' }) as never)
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'render',requestId:'render',actionKind:'region_render',stage:'dispatched',write:true,target,resourceId:'panel' }) as never)
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'render',actionKind:'region_render',target,outcome:'unknown',delivery:'sent',quiescent:true,grantEpoch:1,resourceId:'panel',reason:'document_replaced' })
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'render',requestId:'render',actionKind:'region_render',stage:'settled',outcome:'unknown',quiescent:true,settledBy:receipt,write:true,target,resourceId:'panel' }) as never)
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'reserved',target })
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'panel',state:'unresolved',target })
    t=ctx.browserTasks.reconcileResource(agent,t,{ id:'panel',state:'vanished',target,disposition:'document-replaced',dispositionSource:receipt })
    expect(t.resources[0]?.state).toBe('vanished')
    expect(t.blockers).toContain('unknown-attempt')
  })
  it('binds resource reconciliation to its own attempt and receipt',async()=>{
    const bad=await h();let badTask=create(bad.ctx,bad.agent)
    badTask=bad.ctx.browserTasks.recordAttempt(bad.agent,badTask,attempt({ attemptId:'a',requestId:'a',actionKind:'region_clear',stage:'planned',write:true,target,resourceId:'a' }) as never)
    expect(()=>bad.ctx.browserTasks.advanceAttempt(bad.agent,badTask,attempt({ attemptId:'a',requestId:'a',actionKind:'region_clear',stage:'dispatched',write:true,target,resourceId:'b' }) as never)).toThrow(BrowserTaskError)
    expect(bad.ctx.browserTasks.get(bad.agent)?.blockers).toContain('internal-invariant')
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'a',state:'reserved',target })
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'b',state:'reserved',target })
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'b',state:'active',target })
    t=ctx.browserTasks.upsertResource(agent,t,{ id:'b',state:'release-pending',target })
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'a',requestId:'a',actionKind:'region_clear',stage:'planned',write:true,target,resourceId:'a' }) as never)
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'a',actionKind:'region_clear',stage:'dispatched',write:true,target,resourceId:'a' }) as never)
    expect(()=>ctx.browserTasks.recordReceipt(agent,t,{ requestId:'a',actionKind:'region_clear',target,outcome:'observed',delivery:'sent',quiescent:true,grantEpoch:1,resourceId:'b' })).toThrow(BrowserTaskError)
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'a',actionKind:'region_clear',target,outcome:'observed',delivery:'sent',quiescent:true,grantEpoch:1,resourceId:'a' })
    expect(()=>ctx.browserTasks.reconcileResource(agent,t,{ id:'b',state:'released',target,disposition:'reconcile-observed',dispositionSource:receipt })).toThrow(BrowserTaskError)
  })
  it('reconciles one uncertain resource while preserving other pending leases',async()=>{
    const{ ctx,agent }=await h();let t=create(ctx,agent)
    for(const id of ['a','b']){
      t=ctx.browserTasks.upsertResource(agent,t,{ id,state:'reserved',target })
      t=ctx.browserTasks.upsertResource(agent,t,{ id,state:'active',target })
      t=ctx.browserTasks.upsertResource(agent,t,{ id,state:'release-pending',target })
    }
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'a',requestId:'a',actionKind:'region_clear',stage:'planned',write:true,target,resourceId:'a' }) as never)
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'a',requestId:'a',actionKind:'region_clear',stage:'dispatched',write:true,target,resourceId:'a' }) as never)
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'a',actionKind:'region_clear',target,outcome:'observed',delivery:'sent',quiescent:true,grantEpoch:1,resourceId:'a' })
    t=ctx.browserTasks.reconcileResource(agent,t,{ id:'a',state:'released',target,disposition:'reconcile-observed',dispositionSource:receipt })
    expect(t.resources).toMatchObject([{ id:'a',state:'released' },{ id:'b',state:'release-pending' }])
    expect(t.blockers).toContain('cleanup')
  })
  it('retains settled receipt facts when the bounded source-fact window evicts older noise',async()=>{
    const{ ctx,agent,session }=await h();let t=create(ctx,agent)
    t=ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'settled',requestId:'settled',stage:'planned',write:true,target }) as never)
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'settled',requestId:'settled',stage:'dispatched',write:true,target }) as never)
    const receipt=ctx.browserTasks.recordReceipt(agent,t,{ requestId:'settled',actionKind:'click',target,outcome:'observed',delivery:'sent',quiescent:true,grantEpoch:1 })
    t=ctx.browserTasks.advanceAttempt(agent,t,attempt({ attemptId:'settled',requestId:'settled',stage:'settled',outcome:'observed',quiescent:true,settledBy:receipt,write:true,target }) as never)
    for(let index=0;index<=BROWSER_TASK_LIMITS.sourceFacts;index++){
      session.append('user/message',createUserMessage({ content:[{ type:'text',text:`noise-${index}` }],source:{ kind:'user' } }),{ surfaceOp:'append' })
    }
    const projection=ctx.sessionProjections.stateOf(session,'browserTask')!
    expect(projection.sourceFacts).toHaveLength(BROWSER_TASK_LIMITS.sourceFacts)
    expect(projection.sourceFacts.some(fact => fact.kind==='browser-task-receipt'&&fact.sessionSeq===receipt.sessionSeq)).toBe(true)
    expect(ctx.browserTasks.get(agent)?.attempts[0]?.settledBy).toEqual(receipt)
  })
  it('rejects forged resource identity on ordinary actions through API and replay',async()=>{
    const{ ctx,agent,session }=await h();const t=create(ctx,agent)
    expect(()=>ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'click',requestId:'click',actionKind:'click',stage:'planned',write:true,target,resourceId:'panel' }) as never)).toThrow(BrowserTaskError)
    expect(()=>ctx.browserTasks.recordAttempt(agent,t,attempt({ attemptId:'render',requestId:'render',actionKind:'region_render',stage:'planned',write:true,target }) as never)).toThrow(BrowserTaskError)
    session.append('browser-task/change',{ kind:'browser-task/change',version:3,operation:'attempt',task:{ ...t,revision:t.revision+1,updatedAt:t.updatedAt+1,attempts:[{ attemptId:'forged',requestId:'forged',actionKind:'click',grantEpoch:1,stage:'planned',write:true,target,resourceId:'panel' }] } } as never)
    expect(()=>ctx.browserTasks.get(agent)).toThrow('browser task replay failed')
  })
})

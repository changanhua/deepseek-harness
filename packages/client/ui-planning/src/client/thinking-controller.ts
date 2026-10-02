import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  AdvanceThinkingInput, ApplyThinkingInput, PlanningContextInput, PrepareThinkingInput, SubmitThinkingProposalInput,
  ThinkingCaseView, ThinkingRunRecord,
} from '@changanhua/dsh-planning-remote/types'
import type { PlanningCommand } from '@changanhua/dsh-planning/types'
import type { RemoteResult } from './runtime-controller.ts'
import { nextPlanningRequestId } from './request-id.ts'

/** Authenticated case-owner operations and the existing Planning binding transport. */
export interface ThinkingRemote {
  thinkingCase(input: PlanningContextInput, signal?: AbortSignal): Promise<RemoteResult<ThinkingCaseView>>
  prepareThinking(input: PrepareThinkingInput, signal?: AbortSignal): Promise<RemoteResult<ThinkingCaseView>>
  advanceThinking(input: AdvanceThinkingInput, signal?: AbortSignal): Promise<RemoteResult<ThinkingCaseView>>
  applyThinking(input: ApplyThinkingInput, signal?: AbortSignal): Promise<RemoteResult<ThinkingCaseView>>
  submitThinkingProposal(input: SubmitThinkingProposalInput, signal?: AbortSignal): Promise<RemoteResult<ThinkingCaseView>>
  execute(input: { workspaceId: string; command: PlanningCommand }, signal?: AbortSignal): Promise<RemoteResult<unknown>>
}
/** Native Session creation, idempotent prompting and user navigation callbacks. */
export interface ThinkingNativeSessions {
  create(input: { workspaceId: string; sessionId: string; agentPreset: string }): Promise<string>
  prompt(sessionId: string, content: string, requestId: string, signal: AbortSignal): Promise<void>
  open(sessionId: string): void
}
/** Durable owner records drive recovery; this controller owns only one visible request lifetime.
 * @param remote - Case owner and canonical Planning binding transport.
 * @param native - Native Session lifecycle and navigation callbacks.
 * @returns Disposable controller; failed operations retain owner state for explicit recovery.
 */
export function createThinkingController(remote: ThinkingRemote, native: ThinkingNativeSessions): {
  source: ReturnType<typeof createSnapshotStore<{ view: ThinkingCaseView | null; pending: boolean; error: string | null }>>
  close(): void
  open(input: PlanningContextInput): Promise<boolean>
  refresh(): Promise<boolean>
  resume(runId: string): Promise<boolean>
  prepare(question: string): Promise<boolean>
  apply(runId: string, resultId: string, resultVersion: number, kind: 'notes' | 'context', acknowledgeStale?: boolean): Promise<boolean>
  submitProposal(runId: string, resultId: string, resultVersion: number): Promise<boolean>
  openSession(sessionId: string): void
  dispose(): void
} {
  const source = createSnapshotStore<{ view: ThinkingCaseView | null; pending: boolean; error: string | null }>({
    view: null, pending: false, error: null,
  })
  let input: PlanningContextInput | null = null
  let active: AbortController | null = null
  let disposed = false
  let pendingPrepare: PrepareThinkingInput | null = null
  const unwrap = <T>(result: RemoteResult<T>): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }
  const current = () => {
    if (!input) throw new Error('Thinking Case is not open')
    return input
  }
  const accept = (view: ThinkingCaseView) => { source.update((state) => { state.view = view }); return view }
  const read = async (signal: AbortSignal) => accept(unwrap(await remote.thinkingCase(current(), signal)))
  const operate = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (disposed || active) return false
    const controller = new AbortController(); active = controller
    source.update((state) => { state.pending = true; state.error = null })
    try {
      await action(controller.signal)
      controller.signal.throwIfAborted()
      return true
    } catch (error) {
      if (!controller.signal.aborted) source.update((state) => { state.error = error instanceof Error ? error.message : String(error) })
      return false
    } finally {
      if (active === controller) {
        active = null
        source.update((state) => { state.pending = false })
      }
    }
  }
  const advance = async (run: ThinkingRunRecord, phase: AdvanceThinkingInput['phase'], signal: AbortSignal, blockedReason?: string) => {
    const view = accept(unwrap(await remote.advanceThinking({ ...current(), runId: run.id, expectedRunVersion: run.version,
      requestId: `${run.id}:${phase}:${run.version}`, phase, ...(blockedReason === undefined ? {} : { blockedReason }) }, signal)))
    const advanced = view.runs.find(value => value.id === run.id)
    if (advanced === undefined) throw new Error('Thinking Run disappeared while advancing')
    return advanced
  }
  const resumeRun = async (runId: string, signal: AbortSignal) => {
    let run = (await read(signal)).runs.find(value => value.id === runId)
    if (!run) throw new Error('Thinking Run is unavailable')
    if (run.startup.phase === 'blocked') throw new Error(run.startup.blockedReason ?? 'Thinking startup is blocked')
    if (run.startup.phase === 'prepared') {
      const actualId = await native.create({ workspaceId: current().workspaceId, sessionId: run.sessionId, agentPreset: 'thinking-desk' })
      if (actualId !== run.sessionId) throw new Error('Native Session identity changed')
      run = await advance(run, 'session-created', signal)
    }
    if (run.startup.phase === 'session-created') {
      const result = await remote.execute({ workspaceId: current().workspaceId, command: run.startup.bindCommand }, signal)
      if (!result.ok) {
        // An exact successful binding can survive a lost progress response. Never rebind or silently replace its base.
        const observed = (await read(signal)).runs.find(value => value.id === runId)
        if (observed === undefined) throw new Error('Thinking Run is unavailable')
        if (result.error.code === 'conflict' && observed.startup.phase === 'session-created')
          await advance(observed, 'blocked', signal, 'Planning changed before binding. Start a new Thinking Run.')
        throw new Error(`${result.error.code}: ${result.error.message}`)
      }
      run = await advance(run, 'planning-bound', signal)
    }
    if (run.startup.phase === 'planning-bound') {
      await native.create({ workspaceId: current().workspaceId, sessionId: run.sessionId, agentPreset: 'thinking-desk' })
      run = await advance(run, 'planning-bound', signal)
      await native.prompt(run.sessionId, run.startup.promptText, run.startup.promptRequestId, signal)
      // Agent result submission may advance run.version before the startup receipt is recorded.
      const refreshed = (await read(signal)).runs.find(value => value.id === runId)
      if (refreshed === undefined) throw new Error('Thinking Run is unavailable')
      run = refreshed
      if (run.startup.phase === 'planning-bound') await advance(run, 'prompt-accepted', signal)
    }
    native.open(run.sessionId)
  }
  const close = () => {
    active?.abort(); active = null; input = null; pendingPrepare = null
    source.set({ view: null, pending: false, error: null })
  }
  return {
    source, close,
    open: async (next: PlanningContextInput) => { close(); input = next; return operate(async (signal) => { await read(signal) }) },
    refresh: () => operate(async (signal) => { await read(signal) }),
    resume: (runId: string) => operate(signal => resumeRun(runId, signal)),
    prepare: (question: string) => operate(async (signal) => {
      const view = await read(signal)
      pendingPrepare ??= { ...current(), expectedCaseVersion: view.design.case.version, question,
        runId: `thinking-run-${nextPlanningRequestId()}`, sessionId: `session-${nextPlanningRequestId()}`,
        requestId: nextPlanningRequestId(), bindRequestId: nextPlanningRequestId(), promptRequestId: nextPlanningRequestId() }
      const prepared = accept(unwrap(await remote.prepareThinking(pendingPrepare, signal)))
      const runId = pendingPrepare.runId; pendingPrepare = null
      if (!prepared.runs.some(run => run.id === runId)) throw new Error('Prepared Thinking Run is missing')
      await resumeRun(runId, signal)
    }),
    apply: (runId: string, resultId: string, resultVersion: number, kind: 'notes' | 'context', acknowledgeStale?: boolean) =>
      operate(async (signal) => {
        const view = await read(signal)
        accept(unwrap(await remote.applyThinking({ ...current(), runId, resultId, resultVersion, kind,
          expectedCaseVersion: view.design.case.version, requestId: nextPlanningRequestId(),
          ...(acknowledgeStale === undefined ? {} : { acknowledgeStale }) }, signal)))
      }),
    submitProposal: (runId: string, resultId: string, resultVersion: number) => operate(async (signal) => {
      accept(unwrap(await remote.submitThinkingProposal({ ...current(), runId, resultId, resultVersion,
        requestId: nextPlanningRequestId() }, signal)))
    }),
    openSession: (sessionId: string) => { native.open(sessionId) },
    dispose: () => { disposed = true; close() },
  }
}

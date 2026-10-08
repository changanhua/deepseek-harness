/**
 * Schedules one assistant step's tool calls. Exclusive calls form barriers;
 * parallel calls use a bounded rolling pool and are reclassified before start.
 * Dispatch may overlap, while policy, results, and result context remain
 * model-ordered. Abort or an internal scheduler failure stops replenishment
 * and drains started calls.
 *
 * Both abort and scheduler failure close every requested call in model order.
 * Known results survive; unstarted and outcome-unknown calls receive explicit
 * error results, never a replay of the tool. Failed settlement leaves an open
 * tail and blocks the driver rather than claiming a closed, valid transcript.
 * @module dsh-agent-loop/tool-calls
 */

import type { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage, type ToolCallBlock } from '@deepseek-ai/dsh-llm'
import { TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN, type Session, type SessionSeq, type UserMessage } from '@deepseek-ai/dsh-session'
import { TOOL_ABORTED_BEFORE_DISPATCH, TOOL_RUNTIME_SCHEDULER, type ToolExecutionInput, type ToolExecutionMode, type ToolExecutionResult, type ToolRunContext, type ToolRuntimeScheduler } from '@deepseek-ai/dsh-tools'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/** One tool call after argument parsing, ready to schedule. */
interface PlannedCall {
  block: ToolCallBlock
  exec: ToolExecutionInput
  /** The append commit point, not proof that the tool body ran. */
  callSeq?: SessionSeq
  dispatchStarted: boolean
  finalizationStarted: boolean
  resultCommitted: boolean
  slot?: Slot
}

/** Settled dispatch awaiting model-order finalization. */
interface Slot {
  exec: ToolRunContext
  result: ToolExecutionResult
  needsPost: boolean
}

/** One scheduler group outcome, including a drained cancellation. */
interface GroupOutcome {
  consumed: number
  aborted: boolean
  /** Whether any committed result carried {@link ToolExecutionResult.concludesTurn}. */
  concluded: boolean
}

/**
 * Tool settlement was rejected. The driver must not seal this step/turn or
 * accept another execution on the same handle; detach and recover its tail.
 * This error never means that an external operation is safe to repeat.
 */
export class ToolCallSettlementError extends Error {
  readonly code = 'TOOL_SETTLEMENT_INCOMPLETE'

  constructor(cause: unknown) {
    super('Tool results could not be committed. This session handle is blocked until its interrupted tail is recovered.', { cause })
    this.name = 'ToolCallSettlementError'
  }
}

/**
 * Schedule one assistant step's tool calls by their live concurrency mode.
 * Ordinary completion and abort commit started-call results in order. Abort
 * drains them, records synthetic results for unstarted calls, and returns with
 * the signal still aborted after accepting started-call context through the
 * caller-supplied acceptor (the machine stages it in its next-step inbox for the
 * step boundary). An internal scheduler failure stops new dispatches, drains
 * already-started dispatches, settles remaining calls without executing them
 * again, flushes that recovery, and rejects with the original failure. A
 * settlement failure instead blocks the driver with an unclosed tail.
 * The committed step's AgentLoop driver boundary supplies the initiating Agent
 * that becomes each explicit {@link ToolExecutionInput.agent}.
 *
 * @param ctx - loop context that owns the tool registry and carries the initiating Agent.
 * @param turn - current turn number.
 * @param step - current step number.
 * @param toolCalls - assistant calls in model order.
 * @param signal - abort signal shared by the step.
 * @param acceptContext - accepts committed result context for the next step boundary.
 */
export async function executeToolCalls(
  ctx: Context,
  turn: number,
  step: number,
  toolCalls: ToolCallBlock[],
  signal: AbortSignal,
  acceptContext: (context: UserMessage) => void,
): Promise<{ concluded: boolean }> {
  const agent = ctx.agents.requireInitiator()
  const { session } = agent

  // Inputs are distinct because tools/execute wrappers may replace `exec.signal`.
  const planned: PlannedCall[] = toolCalls.map(block => ({
    block,
    dispatchStarted: false,
    finalizationStarted: false,
    resultCommitted: false,
    exec: {
      callId: block.id,
      name: block.name,
      arguments: parseArguments(block.arguments),
      agent,
      signal,
    },
  }))

  let scheduler: ToolRuntimeScheduler | undefined
  try {
    // Availability is a pure check. Do not move prepare (which owns policy)
    // before the call event, and do not make broken module identity look like
    // an ordinary, retryable tool error.
    scheduler = ctx.tools[TOOL_RUNTIME_SCHEDULER]
    if (scheduler === undefined || scheduler === null
      || typeof scheduler.prepare !== 'function'
      || typeof scheduler.dispatch !== 'function'
      || typeof scheduler.finalize !== 'function'
      || typeof scheduler.finish !== 'function') {
      throw new Error('Tool runtime scheduler is unavailable or incompatible; check core package identity before retrying.')
    }

    let next = 0
    let concluded = false
    while (next < planned.length) {
      // Commit before classifying again so registry changes affect unstarted calls.
      // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
      const first = planned[next]!
      const mode = ctx.tools.executionMode(first.exec).kind
      const group = mode === 'parallel' ? planned.slice(next) : [first]
      const outcome = await runGroup(
        ctx, scheduler, turn, step, group, mode, signal, acceptContext,
      )
      next += outcome.consumed
      concluded ||= outcome.concluded
      if (outcome.aborted) {
        for (const call of planned.slice(next)) appendSkippedToolCall(session, turn, step, call)
        return { concluded }
      }
    }
    return { concluded }
  } catch (error: unknown) {
    // Never retry a rejected append, not even with a synthetic replacement.
    // runGroup has already drained every dispatch it started.
    if (error instanceof ToolCallSettlementError) throw error
    try {
      for (const call of planned) {
        if (call.resultCommitted) continue
        // A later sibling may have settled while an earlier call failed.
        // Preserve it through the normal finalizer, but never run a failed
        // finalizer twice or bypass its content/policy validation.
        if (scheduler && call.slot && !call.finalizationStarted) {
          try {
            await commitSlot(scheduler, session, turn, step, call, call.slot, acceptContext)
          } catch (settlementError: unknown) {
            if (settlementError instanceof ToolCallSettlementError) throw settlementError
            // This slot failed finalization. Classify it below; the first
            // scheduler failure remains the turn's initiating error.
          }
        }
        if (call.resultCommitted) continue
        call.callSeq ??= appendToolCall(session, turn, step, call.block)
        appendToolResult(session, turn, step, call.block, failedSchedulingResult(call.dispatchStarted), call.callSeq)
        call.resultCommitted = true
      }
      await ctx.sessions.flush(session)
    } catch (settlementError: unknown) {
      throw new ToolCallSettlementError(new AggregateError(
        [error, settlementError],
        'Tool scheduling failed and its terminal results could not be committed',
        { cause: error },
      ))
    }
    throw error
  }
}

/** Parse model arguments, preserving invalid JSON as text and mapping empty input to `{}`. */
function parseArguments(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    return raw
  }
}

/**
 * Run one exclusive barrier or parallel pool. Later calls are reclassified
 * before start; an exclusive reclassification waits for the current pool to
 * drain and remains for the caller's next barrier. Results and contexts commit
 * in model order. Abort stops starts, drains and commits started calls, accepts
 * their contexts into the owning batch, records results for skipped calls, and
 * returns an aborted outcome. Scheduler failure drains dispatches before the
 * outer batch settles both this group and all later unstarted barriers.
 */
async function runGroup(
  ctx: Context,
  scheduler: ToolRuntimeScheduler,
  turn: number,
  step: number,
  group: PlannedCall[],
  mode: ToolExecutionMode['kind'],
  signal: AbortSignal,
  acceptContext: (context: UserMessage) => void,
): Promise<GroupOutcome> {
  const { session } = ctx.agents.requireInitiator()
  const { maxParallelToolCalls } = ctx.agentLoop.config
  let nextToStart = 0
  let committed = 0
  let started = 0
  let aborted: boolean = signal.aborted
  let concluded = false
  let schedulerFailure: { error: unknown } | undefined
  const throwSchedulerFailure = (): void => {
    if (schedulerFailure !== undefined) throw schedulerFailure.error
  }

  // `committed` advances only across contiguous model-order slots.
  const commitReady = async (): Promise<void> => {
    while (committed < group.length) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
      const call = group[committed]!
      const slot = call.slot
      if (slot === undefined) break
      const terminal = await commitSlot(scheduler, session, turn, step, call, slot, acceptContext)
      concluded ||= terminal
      committed++
    }
  }

  const inFlight = new Map<number, Promise<number>>()

  const startCall = async (index: number): Promise<void> => {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded index
    const call = group[index]!
    call.callSeq = appendToolCall(session, turn, step, call.block)
    started++
    const prepared = await scheduler.prepare(call.exec)
    switch (prepared.kind) {
      case 'dispatch': {
        throwSchedulerFailure()
        // A synchronous throw can occur after an external effect, so once we
        // enter dispatch a missing result is conservatively outcome-unknown.
        call.dispatchStarted = true
        const promise = scheduler.dispatch(prepared.exec).then(
          (outcome) => {
            call.slot = { exec: prepared.exec, result: outcome.result, needsPost: outcome.kind === 'post-result' }
            return index
          },
          (error: unknown) => {
            schedulerFailure ??= { error }
            return index
          },
        )
        inFlight.set(index, promise)
        break
      }
      case 'post-result':
        call.slot = { exec: prepared.exec, result: prepared.result, needsPost: true }
        break
      case 'final-result':
        call.slot = { exec: prepared.exec, result: prepared.result, needsPost: false }
        break
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        assertNever(prepared, 'tool-call scheduler prepare result')
    }
    // Preserve an already returned policy result before surfacing a sibling's
    // failure; only dispatch is suppressed when another call has failed.
    throwSchedulerFailure()
  }

  const fillPool = async (): Promise<void> => {
    while (!aborted && nextToStart < group.length && inFlight.size < maxParallelToolCalls) {
      // Re-read later modes after ordered commits so registry changes can create a barrier.
      // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
      const nextCall = group[nextToStart]!
      if (nextToStart > 0 && mode === 'parallel'
        && ctx.tools.executionMode(nextCall.exec).kind !== 'parallel') break
      await startCall(nextToStart)
      nextToStart++
      throwSchedulerFailure()
      await commitReady()
      throwSchedulerFailure()
      // Abort may arrive while pre-execute awaits.
      if (signal.aborted) aborted = true
    }
  }

  // Ordered pre-execute may await; only dispatch/body overlaps. A scheduler
  // failure stops new dispatches and reaches the turn boundary after every
  // already-started dispatch settles.
  try {
    await fillPool()
    while (inFlight.size > 0) {
      const settledIndex = await Promise.race(inFlight.values())
      inFlight.delete(settledIndex)
      throwSchedulerFailure()
      await commitReady()
      throwSchedulerFailure()
      // Abort may arrive while a tool or ordered commit awaits.

      if (signal.aborted) aborted = true
      await fillPool()
    }
  } catch (error: unknown) {
    schedulerFailure ??= { error }
    await Promise.allSettled(inFlight.values())
    if (error instanceof ToolCallSettlementError) throw error
    throw schedulerFailure.error
  }

  if (aborted) {
    // Started calls and accepted context settle first; every remaining model
    // call then receives an ordered synthetic result before the turn aborts.
    for (const call of group.slice(started)) appendSkippedToolCall(session, turn, step, call)
    return { consumed: group.length, aborted: true, concluded }
  }
  /* v8 ignore next -- unreachable: a non-aborted group commits every started call */
  if (committed !== started) throw new Error('tool-call scheduler: uncommitted settled calls')
  return { consumed: started, aborted: false, concluded }
}

/** Finalize at most once, then mark the append before any context callback. */
async function commitSlot(
  scheduler: ToolRuntimeScheduler,
  session: Session,
  turn: number,
  step: number,
  call: PlannedCall,
  slot: Slot,
  acceptContext: (context: UserMessage) => void,
): Promise<boolean> {
  call.finalizationStarted = true
  const result = slot.needsPost
    ? await scheduler.finalize(slot.exec, slot.result)
    : scheduler.finish(slot.exec, slot.result)
  // oxlint-disable-next-line typescript/no-non-null-assertion -- a slot follows its committed call event
  appendToolResult(session, turn, step, call.block, result, call.callSeq!)
  call.resultCommitted = true
  for (const context of result.additionalContexts ?? []) acceptContext(context)
  return result.concludesTurn === true
}

/** Describe only known execution facts; this is not a tool retry instruction. */
function failedSchedulingResult(dispatched: boolean): ToolExecutionResult {
  const message = dispatched
    ? 'The tool was dispatched, but no validated result could be committed. Its external outcome is unknown. Do not repeat a side-effecting operation: reconcile its original request identity or ask the user first.'
    : 'The tool was not dispatched because scheduling failed. No tool body was started for this call. Resolve the scheduling failure before requesting it again.'
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${message}` }],
    error: {
      message,
      info: dispatched
        ? { name: 'ToolOutcomeUnknownError', code: TOOL_OUTCOME_UNKNOWN }
        : { name: 'ToolNotStartedError', code: TOOL_NOT_STARTED },
    },
  }
}

/** Append the durable call/result pair for a model call skipped after cancellation. */
function appendSkippedToolCall(session: Session, turn: number, step: number, call: PlannedCall): void {
  call.callSeq ??= appendToolCall(session, turn, step, call.block)
  appendToolResult(session, turn, step, call.block, {
    content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
    isError: true,
    error: {
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    },
  }, call.callSeq)
  call.resultCommitted = true
}

/** Append a call intent; an append rejection must keep the turn unsealed. */
function appendToolCall(session: Session, turn: number, step: number, block: ToolCallBlock): SessionSeq {
  try {
    const event = session.append('tool/call', { turn, step, callId: block.id, name: block.name, arguments: block.arguments })
    return event.seq
  } catch (error: unknown) {
    throw new ToolCallSettlementError(error)
  }
}

/** Append a model-ordered result linked to its call event. */
function appendToolResult(
  session: Session,
  turn: number,
  step: number,
  block: ToolCallBlock,
  result: ToolExecutionResult,
  callSeq: SessionSeq,
): void {
  try {
    const message = createToolResultMessage({
      callId: block.id,
      content: result.content,
      isError: result.isError,
    })
    session.append('tool/result', {
      turn, step,
      message,
      ...result.error?.info ? { error: result.error.info } : {},
      // Preserve the tool's result-time presentation payload on replay.
      ...result.meta !== undefined ? { meta: result.meta } : {},
    }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
  } catch (error: unknown) {
    throw new ToolCallSettlementError(error)
  }
}

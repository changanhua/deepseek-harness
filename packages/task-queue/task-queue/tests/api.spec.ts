import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TaskQueue, {
  AttentionId, AttemptId, BatchId, NotificationId, ResultId, WorkId,
  canAutoRetry, isTerminalState,
} from '@changanhua/dsh-task-queue'
import type { AgentWorkQueue, OperatorWorkQueue, WorkHandler, WorkKind, WorkStatus } from '@changanhua/dsh-task-queue'

describe('public runtime API', () => {
  it('brands every durable id without changing its value', () => {
    expect([WorkId('w'), AttemptId('a'), ResultId('r'), BatchId('b'), AttentionId('x'), NotificationId('n')]).toEqual(['w', 'a', 'r', 'b', 'x', 'n'])
  })

  it('classifies terminal states and the complete automatic-retry predicate', () => {
    expect((['succeeded', 'failed', 'canceled'] as const satisfies readonly WorkStatus[]).map(isTerminalState)).toEqual([true, true, true])
    expect((['queued', 'starting', 'running', 'unknown'] as const satisfies readonly WorkStatus[]).map(isTerminalState)).toEqual([false, false, false, false])
    expect(canAutoRetry({ retriable: true, sideEffect: 'not-started' })).toBe(true)
    expect(canAutoRetry({ retriable: false, sideEffect: 'not-started' })).toBe(false)
    expect(canAutoRetry({ retriable: true, sideEffect: 'started' })).toBe(false)
  })

  it('fails loud for direct construction and registers a concrete provider service', () => {
    const ctx = new Context()
    const DirectTaskQueue = TaskQueue as unknown as new (context: Context) => TaskQueue
    expect(() => new DirectTaskQueue(ctx)).toThrow(/abstract/)
    class ConcreteQueue extends TaskQueue {
      forAgent() { return {} as AgentWorkQueue }
      forOperator() { return {} as OperatorWorkQueue }
      registerHandler<K extends WorkKind>(_handler: WorkHandler<K>) {
        const registration = (() => undefined) as ReturnType<TaskQueue['registerHandler']>
        registration.activate = () => undefined
        return registration
      }
      listKinds() { return [] }
    }
    const queue = new ConcreteQueue(ctx)
    expect(queue.listKinds()).toEqual([])
    const dispose = queue.registerHandler({} as never)
    expect(() => { dispose() }).not.toThrow()
  })

})

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TaskQueue, {
  AttentionId, AttemptId, BatchId, NotificationId, ResultId, WorkId,
  canAutoRetry, isTerminalState,
} from '@deepseek-ai/dsh-task-queue'
import type { AgentWorkQueue, OperatorWorkQueue, WorkHandler, WorkKind, WorkStatus } from '@deepseek-ai/dsh-task-queue'
import { apply, inject, name } from '../src/invariant.ts'

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
      registerHandler<K extends WorkKind>(_handler: WorkHandler<K>) { return () => undefined }
      listKinds() { return [] }
    }
    const queue = new ConcreteQueue(ctx)
    expect(queue.listKinds()).toEqual([])
    const dispose = queue.registerHandler({} as never)
    expect(() => { dispose() }).not.toThrow()
  })

  it('registers the package-owned empty invariant companion', async () => {
    let installed = false
    const disposer = () => undefined
    const ctx = {
      invariants: {
        register(packageName: string, installer: () => void) {
          expect(packageName).toBe('@deepseek-ai/dsh-task-queue')
          installer()
          installed = true
          return disposer
        },
      },
    }
    expect(name).toBe('task-queue-invariant')
    expect(inject).toEqual(['invariants'])
    await expect(apply(ctx as unknown as Context)).resolves.toBe(disposer)
    expect(installed).toBe(true)
  })
})

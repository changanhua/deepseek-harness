import { describe, expect, it } from 'vitest'
import { TaskId, RunId } from '../src/brand.ts'
import {
  cancelPending, claimTask, createTask, dismissTask, isTerminalStatus, markRunning, recoverTaskAfterCrash,
  requestStop, retryTask, settleCanceled, settleFailed, settleSucceeded,
} from '../src/transitions.ts'
import type { Task, TaskResult } from '../src/types.ts'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: TaskId('tq-1'),
    title: 't',
    prompt: 'p',
    executor: 'shell',
    status: 'pending',
    priority: 10,
    attempt: 0,
    maxAttempts: 3,
    backoffMs: 1000,
    delayUntil: null,
    timeoutMs: 1000,
    outputDir: '/out',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastError: null,
    result: null,
    ownerSessionId: null,
    source: 'tool',
    receiptId: 'tool:auto:1',
    terminalSeq: null,
    runs: [],
    dismissed: false,
    ...overrides,
  }
}

const NOW = '2026-01-01T00:00:00.000Z'

describe('isTerminalStatus', () => {
  it('classifies the terminal states only', () => {
    expect(isTerminalStatus('succeeded')).toBe(true)
    expect(isTerminalStatus('failed')).toBe(true)
    expect(isTerminalStatus('canceled')).toBe(true)
    expect(isTerminalStatus('pending')).toBe(false)
    expect(isTerminalStatus('starting')).toBe(false)
    expect(isTerminalStatus('running')).toBe(false)
    expect(isTerminalStatus('stopping')).toBe(false)
  })
})

describe('claimTask', () => {
  it('claims a pending task: attempt+1, starting, fresh run record with null pid', () => {
    const out = claimTask(task(), RunId('run-1'), NOW, '/log/run-1.log', 'fp-1')
    expect(out.status).toBe('starting')
    expect(out.attempt).toBe(1)
    expect(out.runs).toHaveLength(1)
    expect(out.runs[0]).toMatchObject({
      runId: 'run-1',
      attempt: 1,
      pid: null,
      plannedStartedAt: NOW,
      actualStartedAt: null,
      logPath: '/log/run-1.log',
      commandFingerprint: 'fp-1',
    })
  })

  it('rejects claiming a non-pending task', () => {
    expect(() => claimTask(task({ status: 'running' }), RunId('r'), NOW, '/l', 'f')).toThrow(/claim/)
  })

  it('rejects claiming when attempt has reached maxAttempts', () => {
    expect(() => claimTask(task({ status: 'pending', attempt: 3, maxAttempts: 3 }), RunId('r'), NOW, '/l', 'f'))
      .toThrow(/maxAttempts/)
  })

  it('appends a new run record without mutating prior ones', () => {
    const claimed = claimTask(task(), RunId('run-1'), NOW, '/l1', 'f1')
    const second = claimTask({ ...claimed, status: 'pending' }, RunId('run-2'), NOW, '/l2', 'f2')
    expect(second.runs).toHaveLength(2)
    expect(second.runs[0]!.runId).toBe('run-1')
    expect(second.runs[1]!.attempt).toBe(2)
    expect(second.attempt).toBe(2)
  })
})

describe('markRunning', () => {
  it('writes pid and actualStartedAt and transitions to running', () => {
    const claimed = claimTask(task(), RunId('run-1'), NOW, '/l', 'fp')
    const out = markRunning(claimed, 42, NOW)
    expect(out.status).toBe('running')
    expect(out.runs[0]).toMatchObject({ pid: 42, actualStartedAt: NOW })
  })

  it('rejects from a non-starting state', () => {
    expect(() => markRunning(task({ status: 'running', runs: [{ runId: RunId('r'), attempt: 1, pid: null, plannedStartedAt: NOW, actualStartedAt: null, logPath: null, commandFingerprint: null }] }), 1, NOW)).toThrow(/mark running/)
  })
})

describe('settleSucceeded', () => {
  it('settles a running task with result and null terminalSeq', () => {
    const running = markRunning(claimTask(task(), RunId('r'), NOW, '/l', 'f'), 1, NOW)
    const result: TaskResult = { exitCode: 0, signal: null, durationMs: 10, outputFiles: ['a.txt'] }
    const out = settleSucceeded(running, result, NOW)
    expect(out.status).toBe('succeeded')
    expect(out.result).toEqual(result)
    expect(out.terminalSeq).toBeNull()
  })

  it('rejects from non-running', () => {
    expect(() => settleSucceeded(task({ status: 'pending' }), { exitCode: 0, signal: null, durationMs: 0 }, NOW)).toThrow(/settle succeeded/)
  })
})

describe('settleFailed', () => {
  it('requeues to pending with exponential backoff when attempt < maxAttempts', () => {
    const running = markRunning(claimTask(task(), RunId('r'), NOW, '/l', 'f'), 1, NOW) // attempt 1
    const out = settleFailed(running, 'boom', NOW)
    expect(out.status).toBe('pending')
    expect(out.attempt).toBe(1)
    expect(out.lastError).toBe('boom')
    // backoffMs * 2^(attempt-1) = 1000 * 2^0 = 1000
    expect(out.delayUntil).toBe('2026-01-01T00:00:01.000Z')
  })

  it('exhausts to failed when attempt reaches maxAttempts (attempt unchanged)', () => {
    const running = markRunning(claimTask(task({ attempt: 2, maxAttempts: 3 }), RunId('r'), NOW, '/l', 'f'), 1, NOW) // attempt 3
    const out = settleFailed(running, 'boom', NOW)
    expect(out.status).toBe('failed')
    expect(out.attempt).toBe(3)
  })

  it('backoff doubles each attempt: 1000, 2000', () => {
    // attempt 2 -> 1000 * 2^(2-1) = 2000
    const running = markRunning(claimTask(task({ attempt: 1 }), RunId('r'), NOW, '/l', 'f'), 1, NOW)
    const out = settleFailed(running, 'boom', NOW)
    expect(out.delayUntil).toBe('2026-01-01T00:00:02.000Z')
  })

  it('rejects from non-running', () => {
    expect(() => settleFailed(task({ status: 'pending' }), 'x', NOW)).toThrow(/settle failed/)
  })
})

describe('stop/cancel paths', () => {
  it('requestStop transitions starting -> stopping and records reason', () => {
    const starting = claimTask(task(), RunId('r'), NOW, '/l', 'f')
    const out = requestStop(starting, 'user cancel', NOW)
    expect(out.status).toBe('stopping')
    expect(out.lastError).toBe('user cancel')
  })

  it('requestStop transitions running -> stopping', () => {
    const running = markRunning(claimTask(task(), RunId('r'), NOW, '/l', 'f'), 1, NOW)
    expect(requestStop(running, 'r', NOW).status).toBe('stopping')
  })

  it('requestStop rejects from pending', () => {
    expect(() => requestStop(task(), 'r', NOW)).toThrow(/request stop/)
  })

  it('settleCanceled only from stopping', () => {
    const stopping = requestStop(claimTask(task(), RunId('r'), NOW, '/l', 'f'), 'r', NOW)
    expect(settleCanceled(stopping, NOW).status).toBe('canceled')
    expect(() => settleCanceled(task({ status: 'running' }), NOW)).toThrow(/settle canceled/)
  })

  it('cancelPending only from pending', () => {
    const out = cancelPending(task(), 'reason', NOW)
    expect(out.status).toBe('canceled')
    expect(out.lastError).toBe('reason')
    expect(() => cancelPending(task({ status: 'starting' }), 'r', NOW)).toThrow(/cancel pending/)
  })
})

describe('retryTask', () => {
  it('resets a failed task back to pending with attempt 0 and cleared error/delay', () => {
    const out = retryTask(task({ status: 'failed', attempt: 3, delayUntil: NOW, lastError: 'boom' }), NOW)
    expect(out.status).toBe('pending')
    expect(out.attempt).toBe(0)
    expect(out.delayUntil).toBeNull()
    expect(out.lastError).toBeNull()
  })

  it('rejects from non-failed', () => {
    expect(() => retryTask(task({ status: 'pending' }), NOW)).toThrow(/retry/)
  })

  it('clears dismissed when requeuing a dismissed failed task (no ghost rows)', () => {
    const out = retryTask(task({ status: 'failed', dismissed: true }), NOW)
    expect(out.status).toBe('pending')
    expect(out.dismissed).toBe(false)
  })
})

describe('dismissTask', () => {
  it('sets dismissed=true on a terminal task without changing status', () => {
    const out = dismissTask(task({ status: 'failed' }), true, NOW)
    expect(out.dismissed).toBe(true)
    expect(out.status).toBe('failed')
    expect(out.updatedAt).toBe(NOW)
  })

  it('sets dismissed=false on undismiss (reversible)', () => {
    const out = dismissTask(task({ status: 'failed', dismissed: true }), false, NOW)
    expect(out.dismissed).toBe(false)
    expect(out.status).toBe('failed')
  })

  it('rejects a non-terminal task', () => {
    expect(() => dismissTask(task({ status: 'pending' }), true, NOW)).toThrow(/terminal/)
    expect(() => dismissTask(task({ status: 'running' }), true, NOW)).toThrow(/terminal/)
  })

  it('accepts all three terminal statuses', () => {
    for (const status of ['succeeded', 'failed', 'canceled'] as const) {
      expect(dismissTask(task({ status }), true, NOW).dismissed).toBe(true)
    }
  })
})

describe('createTask', () => {
  it('defaults dismissed to false', () => {
    const t = createTask(TaskId('tq-x'), { title: 't', prompt: 'p', executor: 'shell' }, 'tool', 'rec', NOW)
    expect(t.dismissed).toBe(false)
  })
})

describe('recoverTaskAfterCrash', () => {
  it('starting under maxAttempts recovers to pending with orphan', () => {
    const { task: out, orphan } = recoverTaskAfterCrash(task({ status: 'starting', attempt: 1 }), NOW)
    expect(out.status).toBe('pending')
    expect(out.attempt).toBe(1)
    expect(orphan).toBe(true)
  })

  it('starting at maxAttempts recovers to failed with orphan', () => {
    const { task: out, orphan } = recoverTaskAfterCrash(task({ status: 'starting', attempt: 3, maxAttempts: 3 }), NOW)
    expect(out.status).toBe('failed')
    expect(orphan).toBe(true)
  })

  it('running recovers to pending (attempt unchanged) with orphan', () => {
    const { task: out, orphan } = recoverTaskAfterCrash(task({ status: 'running', attempt: 2 }), NOW)
    expect(out.status).toBe('pending')
    expect(out.attempt).toBe(2)
    expect(orphan).toBe(true)
  })

  it('stopping recovers to canceled with terminationUnverified on last run', () => {
    const t: Task = task({
      status: 'stopping',
      runs: [{ runId: RunId('r'), attempt: 1, pid: 7, plannedStartedAt: NOW, actualStartedAt: NOW, logPath: '/l', commandFingerprint: 'fp' }],
    })
    const { task: out, orphan } = recoverTaskAfterCrash(t, NOW)
    expect(out.status).toBe('canceled')
    expect(out.runs[0]!.terminationUnverified).toBe(true)
    expect(orphan).toBe(true)
  })

  it('pending and terminal states return unchanged with orphan false', () => {
    for (const status of ['pending', 'succeeded', 'failed', 'canceled'] as const) {
      const { task: out, orphan } = recoverTaskAfterCrash(task({ status }), NOW)
      expect(out.status).toBe(status)
      expect(orphan).toBe(false)
    }
  })
})

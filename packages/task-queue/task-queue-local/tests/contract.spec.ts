import { describe, expect, it } from 'vitest'
import type { Task } from '@deepseek-ai/dsh-task-queue'
import { taskToSummary } from '../src/index.ts'
import { TASK_SUMMARY_SCHEMA } from '../../tool-task-queue/src/index.ts'

const TASK: Task = {
  id: 'tq-1' as Task['id'],
  title: 'demo',
  prompt: 'run',
  executor: 'node',
  status: 'pending',
  priority: 10,
  attempt: 0,
  maxAttempts: 1,
  backoffMs: 30_000,
  delayUntil: null,
  timeoutMs: 1_800_000,
  outputDir: 'out',
  tags: [],
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
  lastError: null,
  result: null,
  ownerSessionId: null,
  source: 'tool',
  receiptId: 'r',
  terminalSeq: null,
  runs: [],
  dismissed: false,
}

describe('task-queue contract', () => {
  it('taskToSummary keys match TASK_SUMMARY_SCHEMA properties exactly', () => {
    const summary = taskToSummary(TASK)
    expect(Object.keys(summary).sort()).toEqual(Object.keys(TASK_SUMMARY_SCHEMA.properties).sort())
  })
})

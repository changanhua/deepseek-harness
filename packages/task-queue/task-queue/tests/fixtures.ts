import {
  AttemptId, BatchId, ResultId, WorkId, digestIntent,
  type ChangeSet, type WorkFailure, type WorkKindDefinition,
} from '@changanhua/dsh-task-queue'

declare module '@changanhua/dsh-task-queue' {
  interface WorkKindMap {
    'test@1': WorkKindDefinition<
      { readonly prompt: string },
      { readonly prompt: string; readonly model: string },
      { readonly argv: readonly string[] },
      { readonly artifact: string }
    >
    'other@1': WorkKindDefinition<
      { readonly value: number },
      { readonly value: number },
      { readonly value: number },
      { readonly value: number }
    >
  }
}

export const AT = '2026-08-26T00:00:00.000Z'
export const LATER = '2026-08-26T00:00:01.000Z'
export const failure = (overrides: Partial<WorkFailure> = {}): WorkFailure => ({
  category: 'transport', sideEffect: 'not-started', retriable: true, message: 'offline', ...overrides,
})

export const work = (id = 'work-1', overrides: Record<string, unknown> = {}) => ({
  id: WorkId(id),
  kind: 'test@1' as const,
  title: 'Generate cover',
  intent: { prompt: 'cover' },
  intentDigest: digestIntent({ prompt: 'cover' }),
  resolved: { prompt: 'cover', model: 'model-1' },
  policy: { maxAttempts: 3 },
  resources: [],
  tags: ['image'],
  batchId: null,
  ownerSessionId: 'session-1',
  createdAt: AT,
  ...overrides,
})

export const receipt = (workIds = [WorkId('work-1')], overrides: Record<string, unknown> = {}) => ({
  owner: { type: 'agent' as const, sessionId: 'session-1' },
  source: 'tool' as const,
  key: 'key-1',
  intentDigest: digestIntent({ prompt: 'cover' }),
  workIds,
  batchId: null,
  createdAt: AT,
  ...overrides,
})

export const admitted = (seq = 1, workItem = work(), admissionReceipt = receipt([workItem.id])): ChangeSet => ({
  seq, changeId: `change-${seq}`, at: AT,
  events: [{ type: 'work/admitted', work: workItem }, { type: 'receipt/recorded', receipt: admissionReceipt }],
})

export const started = (seq = 2, workId = WorkId('work-1'), ordinal = 1): ChangeSet => ({
  seq, changeId: `change-${seq}`, at: LATER,
  events: [{ type: 'attempt/started', attempt: { id: AttemptId(`attempt-${ordinal}`), workId, ordinal, startedAt: LATER } }],
})

export const running = (seq = 3, attemptId = AttemptId('attempt-1')): ChangeSet => ({
  seq, changeId: `change-${seq}`, at: LATER,
  events: [{ type: 'attempt/running', attemptId, at: LATER }],
})

export const result = (overrides: Record<string, unknown> = {}) => ({
  id: ResultId('result-1'), workId: WorkId('work-1'), attemptId: AttemptId('attempt-1'), kind: 'test@1' as const,
  output: { artifact: 'cover.png' }, createdAt: LATER, ...overrides,
})

export const batch = (overrides: Record<string, unknown> = {}) => ({
  id: BatchId('batch-1'), kind: 'test@1' as const, sharedPayload: { model: 'model-1' },
  workIds: [WorkId('work-1'), WorkId('work-2')], maxParallel: 2, createdAt: AT, ...overrides,
})

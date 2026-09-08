import { memoryRecordSchema } from '../src/schema.ts'
import type { MemoryRecord } from '../src/types.ts'

/** Independent valid examples of a candidate, acceptance, and renewed acceptance. */
export function memoryHistory(): [MemoryRecord, MemoryRecord, MemoryRecord] {
  const hash = 'a'.repeat(64)
  const firstAt = '2026-09-08T00:00:00.000Z'
  const candidate = memoryRecordSchema.parse({
    id: 'memory-one', workspaceId: 'workspace-one', recordVersion: 1, topicKey: 'validation.command',
    activeRevision: null, candidateRevision: 1,
    revisions: [{
      revision: 1, kind: 'method', title: 'Validation', statement: 'Run pnpm test', tags: ['ci'], conditions: '',
      sources: [{ kind: 'file', path: 'README.md', sha256: hash }], createdBy: 'session-one', createdAt: firstAt,
    }],
    decisions: [], receipts: [{
      key: 'propose:one', digest: hash, operation: 'propose', at: firstAt,
      result: { id: 'memory-one', recordVersion: 1, revision: 1 },
    }],
  })
  const accept = (before: MemoryRecord, commandId: string, at: string) => memoryRecordSchema.parse({
    ...before, recordVersion: before.recordVersion + 1, activeRevision: 1, candidateRevision: null,
    decisions: [...before.decisions, {
      action: 'accept', revision: 1, commandId, sessionId: 'session-one', at, reviewAfter: '2026-10-08T00:00:00.000Z',
    }],
    receipts: [...before.receipts, {
      key: `command:${commandId}`, digest: hash, operation: 'accept', at,
      result: { id: before.id, recordVersion: before.recordVersion + 1, revision: 1 },
    }],
  })
  const accepted = accept(candidate, 'confirm-one', '2026-09-08T00:01:00.000Z')
  return [candidate, accepted, accept(accepted, 'confirm-two', '2026-09-08T00:02:00.000Z')]
}

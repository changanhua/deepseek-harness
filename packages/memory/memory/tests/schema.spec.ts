import { describe, expect, it } from 'vitest'
import { canonicalMemoryJson, memoryProposalSchema, memoryRecordSchema } from '../src/schema.ts'
import { memoryHistory } from './fixtures.ts'

const hash = 'a'.repeat(64)
const timestamp = '2026-09-08T00:00:00.000Z'

function proposal() {
  return {
    topicKey: 'validation.command', kind: 'method', title: '项目验证',
    statement: '运行 pnpm test。', sources: [{ kind: 'file', path: 'README.md' }],
    tags: ['验证'], conditions: '修改代码以后', idempotencyKey: 'save-validation',
  }
}

function record() {
  return {
    id: 'mem-001', workspaceId: 'workspace-a', recordVersion: 1,
    topicKey: 'validation.command', activeRevision: null, candidateRevision: 1,
    revisions: [{
      revision: 1, kind: 'method', title: '项目验证', statement: '运行 pnpm test。',
      tags: ['验证'], conditions: '修改代码以后',
      sources: [{ kind: 'file', path: 'README.md', sha256: hash }],
      createdBy: 'session-a', createdAt: timestamp,
    }],
    decisions: [],
    receipts: [{
      key: 'save-validation', digest: hash, operation: 'propose',
      result: { id: 'mem-001', recordVersion: 1, revision: 1 }, at: timestamp,
    }],
  }
}

describe('memory proposal admission', () => {
  it('retains a bounded claim and normalizes relative Windows file references', () => {
    const input = proposal()
    input.sources[0]!.path = 'docs\\testing.md'
    expect(memoryProposalSchema.parse(input)).toMatchObject({ sources: [{ path: 'docs/testing.md' }] })
  })

  it.each(['../secret', '/etc/passwd', 'C:\\secrets.txt', '\\\\server\\share', 'file.txt:stream', 'docs/../secret'])('rejects an escaping source path: %s', (path) => {
    expect(memoryProposalSchema.safeParse({ ...proposal(), sources: [{ kind: 'file', path }] }).success).toBe(false)
  })

  it.each([
    { workspaceId: 'another-project' }, { actor: 'human' }, { accepted: true },
  ])('rejects caller-supplied authority fields', (extra) => {
    expect(memoryProposalSchema.safeParse({ ...proposal(), ...extra }).success).toBe(false)
  })

  it('rejects caller-supplied source hashes', () => {
    expect(memoryProposalSchema.safeParse({ ...proposal(), sources: [{ kind: 'file', path: 'README.md', sha256: hash }] }).success).toBe(false)
  })

  it.each(['', ' '.repeat(5), '文'.repeat(2001)])('rejects an empty or oversized statement', (statement) => {
    expect(memoryProposalSchema.safeParse({ ...proposal(), statement }).success).toBe(false)
  })

  it('counts Unicode characters rather than UTF-16 code units', () => {
    expect(memoryProposalSchema.safeParse({ ...proposal(), statement: '🐕'.repeat(2000) }).success).toBe(true)
  })

  it('requires a revision fence when proposing an amendment', () => {
    expect(memoryProposalSchema.safeParse({ ...proposal(), memoryId: 'mem-001' }).success).toBe(false)
    expect(memoryProposalSchema.safeParse({ ...proposal(), expectedVersion: 1 }).success).toBe(false)
    expect(memoryProposalSchema.safeParse({ ...proposal(), memoryId: 'mem-001', expectedVersion: 1 }).success).toBe(true)
  })

  it('requires between one and five real source locators', () => {
    expect(memoryProposalSchema.safeParse({ ...proposal(), sources: [] }).success).toBe(false)
    expect(memoryProposalSchema.safeParse({ ...proposal(), sources: Array.from({ length: 6 }, () => ({ kind: 'file', path: 'README.md' })) }).success).toBe(false)
    expect(memoryProposalSchema.safeParse({ ...proposal(), sources: [{ kind: 'session-event', sessionId: 'a', seq: 0 }] }).success).toBe(true)
  })
})

describe('durable memory record consistency', () => {
  it('accepts a candidate with no active version or human decision', () => {
    expect(memoryRecordSchema.parse(record())).toEqual(record())
  })

  it('accepts a version bound to one explicit command and a future review date', () => {
    const value = record()
    const accepted = {
      ...value, recordVersion: 2, activeRevision: 1, candidateRevision: null,
      decisions: [{ action: 'accept', revision: 1, commandId: 'command-1', sessionId: 'session-a', at: timestamp, reviewAfter: '2026-10-08T00:00:00.000Z' }],
      receipts: [...value.receipts, { key: 'command-1', digest: hash, operation: 'accept', result: { id: 'mem-001', recordVersion: 2, revision: 1 }, at: timestamp }],
    }
    expect(memoryRecordSchema.safeParse(accepted).success).toBe(true)
    const overdue = { ...accepted, decisions: [{ ...accepted.decisions[0], reviewAfter: timestamp }] }
    expect(memoryRecordSchema.safeParse(overdue).success).toBe(false)
    expect(memoryRecordSchema.safeParse({ ...accepted, candidateRevision: 1 }).success).toBe(false)
  })

  it('rejects promotion without an exact human acceptance decision', () => {
    expect(memoryRecordSchema.safeParse({ ...record(), activeRevision: 1, candidateRevision: null }).success).toBe(false)
  })

  it('rejects a pointer to a missing version', () => {
    expect(memoryRecordSchema.safeParse({ ...record(), candidateRevision: 2 }).success).toBe(false)
  })

  it('rejects duplicate or non-contiguous revision identities', () => {
    const value = record()
    value.revisions.push(structuredClone(value.revisions[0]!))
    expect(memoryRecordSchema.safeParse(value).success).toBe(false)
    expect(memoryRecordSchema.safeParse({ ...record(), revisions: [{ ...record().revisions[0], revision: 2 }] }).success).toBe(false)
  })

  it.each([
    { result: { id: 'other', recordVersion: 1, revision: 1 } },
    { result: { id: 'mem-001', recordVersion: 2, revision: 1 } },
    { result: { id: 'mem-001', recordVersion: 1, revision: 3 } },
  ])('rejects a receipt that cannot describe its stored record', (extra) => {
    const value = record()
    value.receipts[0] = { ...value.receipts[0]!, ...extra }
    expect(memoryRecordSchema.safeParse(value).success).toBe(false)
  })

  it('rejects duplicate idempotency receipts', () => {
    const value = record()
    value.receipts.push({ ...value.receipts[0]!, result: { id: 'mem-001', recordVersion: 2, revision: 1 } })
    expect(memoryRecordSchema.safeParse({ ...value, recordVersion: 2 }).success).toBe(false)
  })
})

describe('canonical memory input', () => {
  it('rejects sparse arrays instead of hashing them as an empty array', () => {
    expect(() => canonicalMemoryJson(new Array(1))).toThrow(TypeError)
  })

  it('sorts nested object keys while retaining array order', () => {
    expect(canonicalMemoryJson({ z: [2, 1], a: { y: true, x: null } })).toBe('{"a":{"x":null,"y":true},"z":[2,1]}')
  })

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, new Date(), { value: undefined }])('rejects non-JSON input instead of hiding differences', (value) => {
    expect(() => canonicalMemoryJson(value)).toThrow()
  })
})

describe('corrupted durable decision history', () => {
  it.each(['missing', 'operation', 'revision', 'time'])('rejects an unmatched decision: %s', (kind) => {
    const value = memoryHistory()[1]
    if (kind === 'missing') value.decisions = []
    else if (kind === 'operation') value.receipts[1]!.operation = 'reject'
    else if (kind === 'revision') value.receipts[1]!.result.revision = 2
    else value.decisions[0]!.at = '2026-09-08T00:03:00.000Z'
    expect(memoryRecordSchema.safeParse(value).success).toBe(false)
  })

  it('rejects one command reused for multiple durable decisions', () => {
    const value = memoryHistory()[2]
    value.decisions[1]!.commandId = value.decisions[0]!.commandId
    expect(memoryRecordSchema.safeParse(value).success).toBe(false)
  })

  it.each(['missing', 'expired'])('rejects an acceptance with a %s review deadline', (kind) => {
    const value = memoryHistory()[1]
    if (kind === 'missing') delete value.decisions[0]!.reviewAfter
    else value.decisions[0]!.reviewAfter = value.decisions[0]!.at
    expect(memoryRecordSchema.safeParse(value).success).toBe(false)
  })

  it.each(['accept', 'reject', 'retire'] as const)('rejects a %s targeting an ineligible version', (action) => {
    const value = action === 'retire' ? memoryHistory()[0] : memoryHistory()[1]
    const revision = action === 'accept' ? 2 : 1
    const at = '2026-09-08T00:03:00.000Z'
    value.recordVersion++
    value.decisions.push({
      action, revision, commandId: 'bad-transition', sessionId: 'session-one', at,
      ...action === 'accept' ? { reviewAfter: '2026-10-08T00:00:00.000Z' } : {},
    })
    value.receipts.push({
      key: 'command:bad-transition', digest: hash, operation: action, at,
      result: { id: value.id, recordVersion: value.recordVersion, revision },
    })
    expect(memoryRecordSchema.safeParse(value).success).toBe(false)
  })
})

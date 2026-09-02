import { canonicalJson as queueCanonicalJson } from '@deepseek-ai/dsh-task-queue'
import {
  canonicalDigest,
  canonicalJson,
  ContractRevisionId,
  DeliveryCaseId,
  GitCommitId,
  issuePublicationIdForRevision,
  RepositoryRelativePath,
  Sha256Digest,
} from '@deepseek-ai/dsh-delivery-protocol'
import { describe, expect, it } from 'vitest'

describe('delivery canonical identity', () => {
  it.each([
    null,
    true,
    false,
    -0,
    'text',
    { b: [2, 3], a: 1 },
    { nested: { z: null, a: ['x', false] } },
  ])('stays byte-for-byte compatible with Queue canonical JSON %#', (value) => {
    expect(canonicalJson(value)).toBe(queueCanonicalJson(value))
  })

  it('produces a stable lowercase SHA-256 digest', () => {
    expect(canonicalDigest({ b: 2, a: 1 })).toBe(canonicalDigest({ a: 1, b: 2 }))
    expect(canonicalDigest({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/u)
  })

  it('derives one stable publication identity from its owning Case revision', () => {
    expect(issuePublicationIdForRevision(
      DeliveryCaseId('case-1'),
      ContractRevisionId('revision-1'),
    )).toBe('issue-publication-6a80d20cdb9109a85454154a9aabc4669352cc7aac6debcd359430fbae19f586')
    expect(issuePublicationIdForRevision(
      DeliveryCaseId('case-1'),
      ContractRevisionId('revision-2'),
    )).not.toBe(issuePublicationIdForRevision(
      DeliveryCaseId('case-2'),
      ContractRevisionId('revision-1'),
    ))
  })

  it.each([
    undefined,
    { value: undefined },
    [undefined],
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    Symbol('value'),
    new Date(0),
  ])('rejects non-JSON-safe canonical input %#', (value) => {
    expect(() => canonicalJson(value)).toThrow(/JSON-safe|plain|finite|unsupported/iu)
  })

  it('rejects cycles, sparse arrays, hidden keys, and array extras', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const sparse = Array(1)
    const hidden = { value: 1 }
    Object.defineProperty(hidden, 'secret', { enumerable: false, value: 2 })
    const extra: number[] & { extra?: number } = [1]
    extra.extra = 2
    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/iu)
    expect(() => canonicalJson(sparse)).toThrow(/sparse/iu)
    expect(() => canonicalJson(hidden)).toThrow(/enumerable/iu)
    expect(() => canonicalJson(extra)).toThrow(/extra/iu)
  })

  it('rejects symbol keys and sorts both ascending and descending comparisons', () => {
    const symbolKey = { value: 1 }
    Object.defineProperty(symbolKey, Symbol('secret'), { enumerable: true, value: 2 })
    expect(() => canonicalJson(symbolKey)).toThrow(/symbol/iu)
    expect(canonicalJson({ a: 1, c: 3, b: 2 })).toBe('{"a":1,"b":2,"c":3}')
  })
})

describe('delivery value brands', () => {
  it('accepts complete lowercase SHA-1 and SHA-256 Git object ids', () => {
    expect(GitCommitId('a'.repeat(40))).toHaveLength(40)
    expect(GitCommitId('b'.repeat(64))).toHaveLength(64)
  })

  it('rejects abbreviated or uppercase Git ids and malformed digests', () => {
    expect(() => GitCommitId('abcdef0')).toThrow(/full lowercase/iu)
    expect(() => GitCommitId('A'.repeat(40))).toThrow(/full lowercase/iu)
    expect(() => Sha256Digest(`sha256:${'A'.repeat(64)}`)).toThrow(/lowercase/iu)
  })

  it('accepts normalized repository paths and rejects authority-bearing forms', () => {
    expect(RepositoryRelativePath('packages/delivery/index.ts')).toBe('packages/delivery/index.ts')
    for (const path of ['.', '/tmp/file', 'C:/secret', 'packages/../secret', 'packages\\secret']) {
      expect(() => RepositoryRelativePath(path)).toThrow(/relative|normalized/iu)
    }
  })
})

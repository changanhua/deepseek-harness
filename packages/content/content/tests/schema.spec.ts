import { describe, expect, it } from 'vitest'
import { ContentCommandSchema, ContentEntrySchema, WebSourceSchema } from '../src/schema.ts'

const result = { operationId: 'create-1', entryId: 'idea-1', entryRevision: 1, draftRevision: 1, versionId: null }
const operation = { operationId: 'create-1', requestDigest: 'a'.repeat(64), result }
const entry = {
  id: 'idea-1', kind: 'idea', createdAt: '2026-09-06T00:00:00.000Z', entryRevision: 1,
  source: null, versions: [], headVersionId: null,
  draft: { title: '想法', body: '  中文\r\n```ts\n1\n```\n', draftRevision: 1, basedOnVersionId: null },
  projectRefs: [], favorite: false, archived: false, creation: operation, receipts: [operation],
}

describe('content records', () => {
  it('preserves exact text and returns an independent parsed record', () => {
    const parsed = ContentEntrySchema.parse(entry)
    expect(parsed).toEqual(entry)
    expect(parsed).not.toBe(entry)
  })

  it('rejects a forged original creation and a receipt history missing its latest commit', () => {
    const originalResult = { ...result, draftRevision: null, versionId: 'v1' }
    const originalOperation = { ...operation, result: originalResult }
    const original = {
      ...entry, kind: 'original', draft: null, headVersionId: 'v1',
      source: { type: 'user-provided', scope: 'provided-text', verification: 'unverified' },
      creation: originalOperation, receipts: [originalOperation],
      versions: [{ id: 'v1', number: 1, title: '', body: 'body', bodySha256: 'b'.repeat(64),
        createdAt: entry.createdAt, operation: originalOperation }],
    }
    expect(ContentEntrySchema.safeParse(original).success).toBe(true)
    expect(ContentEntrySchema.safeParse({ ...original, creation: operation }).success).toBe(false)
    expect(ContentEntrySchema.safeParse({ ...entry, receipts: [] }).success).toBe(false)
    expect(ContentEntrySchema.safeParse({ ...entry, entryRevision: 3 }).success).toBe(false)
  })

  it.each([
    { ...entry, headVersionId: 'missing' },
    { ...entry, draft: { ...entry.draft, basedOnVersionId: 'missing' } },
    { ...entry, entryRevision: 0 },
    { ...entry, kind: 'original' },
    { ...entry, projectRefs: ['p', 'p'] },
    { ...entry, creation: { ...operation, result: { ...result, entryId: 'other' } } },
    { ...entry, receipts: [operation, operation] },
    { ...entry, unknownField: 'silently dropped' },
    { ...entry, draft: null },
    { ...entry, draft: { ...entry.draft, draftRevision: 9 } },
    { ...entry, creation: { ...operation, result: { ...result, entryRevision: 9 } } },
    { ...entry, creation: { ...operation, result: { ...result, draftRevision: 9 } } },
    { ...entry, creation: { ...operation, result: { ...result, versionId: 'missing' } } },
  ])('rejects malformed stored state without repairing it', (invalid) => {
    expect(ContentEntrySchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects broken version ordinals, duplicate identities and detached operation references', () => {
    const receipt = { ...result, draftRevision: null, versionId: 'v1' }
    const op = { ...operation, result: receipt }
    const version = { id: 'v1', number: 1, title: '', body: 'x', bodySha256: 'a'.repeat(64),
      createdAt: entry.createdAt, operation: op }
    const value = { ...entry, kind: 'original', headVersionId: 'v1', draft: null,
      source: { type: 'user-provided', scope: 'provided-text', verification: 'unverified' },
      versions: [version], creation: op, receipts: [op] }
    expect(ContentEntrySchema.safeParse(value).success).toBe(true)
    for (const versions of [
      [{ ...version, number: 3 }], [version, version],
      [{ ...version, operation: { ...op, result: { ...receipt, versionId: null } } }],
      [{ ...version, operation: { ...op, result: { ...receipt, draftRevision: 1 } } }],
    ]) {
      expect(ContentEntrySchema.safeParse({ ...value, versions }).success).toBe(false)
    }
  })
})

describe('content commands', () => {
  it('accepts an unverified web source for manual imports and rejects forged verified sources', () => {
    const command = { type: 'save-text', operationId: 'op', entryId: 'text', title: '', body: '\r\n' }
    expect(ContentCommandSchema.parse(command)).toEqual(command)
    const source = {
      type: 'web-page', scope: 'single-reply', verification: 'unverified',
      url: 'https://chatgpt.com/c/example', pageTitle: 'Example', site: 'ChatGPT',
      capturedAt: '2026-09-07T00:00:00.000Z', externalMessageId: 'message-1',
    }
    expect(ContentCommandSchema.parse({ ...command, source })).toEqual({ ...command, source })
    expect(ContentCommandSchema.safeParse({ ...command, source: {
      type: 'session-message', sessionId: 'session', messageId: 'message', captureId: 'capture',
      scope: 'full-message', verification: 'host-verified', boundary: 'completed-text',
    } }).success).toBe(false)
    expect(ContentCommandSchema.safeParse({ ...command, type: 'create', source }).success).toBe(false)
  })

  it.each([
    'ftp://example.com/article', 'https://user:password@example.com/article', 'not a url',
  ])('rejects a web source URL outside the HTTP(S) credential-free boundary: %s', (url) => {
    expect(WebSourceSchema.safeParse({
      type: 'web-page', scope: 'selection', verification: 'unverified', url,
      pageTitle: 'Example', site: 'Example', capturedAt: '2026-09-07T00:00:00.000Z',
    }).success).toBe(false)
  })

  it.each([
    { type: 'metadata', entryId: 'e', operationId: 'o', favorite: true },
    { type: 'metadata', entryId: 'e', operationId: 'o', expectedEntryRevision: 1 },
    { type: 'save-draft', entryId: 'e', operationId: 'o', title: '', body: '' },
    { type: 'create', entryId: '', operationId: 'o', title: '', body: '' },
    { type: 'create', entryId: 'e', operationId: 'o', title: '', body: '\ud800' },
  ])('rejects missing concurrency guards or non-roundtrippable text', (invalid) => {
    expect(ContentCommandSchema.safeParse(invalid).success).toBe(false)
  })
})

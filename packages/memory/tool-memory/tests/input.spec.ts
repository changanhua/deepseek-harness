import { describe, expect, it } from 'vitest'
import { parseProposal, parseRead, parseSearch } from '../src/input.ts'

const valid = {
  topic_key: 'validation', kind: 'method', title: 'Validation', statement: 'Run tests', idempotency_key: 'save',
  sources: [{ kind: 'file', path: 'README.md' }],
}

describe('untrusted memory tool input', () => {
  it.each([null, false, 'query', []])('rejects non-object tool envelopes: %j', (value) => {
    for (const parse of [parseRead, parseSearch, parseProposal]) expect(() => parse(value)).toThrow()
  })

  it.each([{ id: '' }, { id: 1 }, { id: 'a'.repeat(257) }])('requires a bounded opaque read identity: %j', (value) => {
    expect(() => parseRead(value)).toThrow()
  })

  it.each([
    {}, { query: ' ' }, { query: 5 }, { query: 'x'.repeat(1001) },
    { query: 'history', limit: 0 }, { query: 'history', limit: 1.5 },
    { query: 'history', tags: 'ci' }, { query: 'history', tags: [false] },
  ])('rejects malformed search constraints: %j', (value) => {
    expect(() => parseSearch(value)).toThrow()
  })

  it.each([
    { sources: null }, { sources: [] }, { sources: [null] },
    { sources: [{ kind: 'file', path: 'README.md', session_id: 'foreign' }] },
    { sources: [{ kind: 'session-event', session_id: 'same-project', seq: -1 }] },
    { sources: [{ kind: 'session-event', session_id: 'same-project', seq: 1, path: 'README.md' }] },
    { sources: [{ kind: 'url', path: 'https://example.invalid' }] },
    { sources: [{ kind: 'file', path: '../outside.md' }] },
    { sources: [{ kind: 'file', path: 'C:/private.md' }] },
    { memory_id: 'existing' }, { expected_version: 1 },
  ])('rejects unsupported provenance and incomplete amendments: %j', (extra) => {
    expect(() => parseProposal({ ...valid, ...extra })).toThrow()
  })
})

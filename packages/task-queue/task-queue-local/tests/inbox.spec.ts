import { mkdtemp, rm, writeFile, readdir, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isUuidName, quarantineInboxFile, scanInbox, validateInboxSpec } from '../src/inbox.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tq-inbox-'))
  await mkdir(join(root, 'inbox'), { recursive: true })
  await mkdir(join(root, 'quarantine'), { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const validUuid = '123e4567-e89b-12d3-a456-426614174000'

describe('isUuidName', () => {
  it('accepts a strict UUID shape', () => {
    expect(isUuidName(validUuid)).toBe(true)
    expect(isUuidName('00000000-0000-0000-0000-000000000000')).toBe(true)
  })

  it('rejects non-UUID basenames', () => {
    expect(isUuidName('not-a-uuid')).toBe(false)
    expect(isUuidName('123e4567-e89b-12d3-a456')).toBe(false)
    expect(isUuidName(`${validUuid}extra`)).toBe(false)
    expect(isUuidName('')).toBe(false)
  })
})

describe('validateInboxSpec', () => {
  const valid = { title: 't', prompt: 'p', executor: 'claude' }

  it('accepts a minimal valid spec and fills no extra fields', () => {
    const result = validateInboxSpec(valid)
    expect('spec' in result).toBe(true)
    if ('spec' in result) {
      expect(result.spec).toEqual(valid)
    }
  })

  it('accepts a fully-populated spec', () => {
    const full = {
      title: 't', prompt: 'p', executor: 'claude',
      priority: 1, maxAttempts: 5, backoffMs: 100, delayUntil: '2026-01-01T00:00:00.000Z',
      timeoutMs: 1000, outputDir: '/out', tags: ['a', 'b'], ownerSessionId: 'sess-1',
    }
    const result = validateInboxSpec(full)
    expect('spec' in result).toBe(true)
  })

  it.each([
    [{ ...valid, title: '' }, /title/],
    [{ ...valid, title: 5 }, /title/],
    [{ ...valid, prompt: '' }, /prompt/],
    [{ ...valid, executor: '' }, /executor/],
    [{ ...valid, priority: 1.5 }, /priority/],
    [{ ...valid, priority: 'high' }, /priority/],
    [{ ...valid, maxAttempts: 0 }, /maxAttempts/],
    [{ ...valid, maxAttempts: -1 }, /maxAttempts/],
    [{ ...valid, backoffMs: -1 }, /backoffMs/],
    [{ ...valid, backoffMs: Infinity }, /backoffMs/],
    [{ ...valid, delayUntil: 123 }, /delayUntil/],
    [{ ...valid, timeoutMs: 0 }, /timeoutMs/],
    [{ ...valid, timeoutMs: -5 }, /timeoutMs/],
    [{ ...valid, outputDir: 7 }, /outputDir/],
    [{ ...valid, tags: 'nope' }, /tags/],
    [{ ...valid, tags: [1, 2] }, /tags/],
    [{ ...valid, ownerSessionId: 9 }, /ownerSessionId/],
    [null, /not an object/],
    ['string', /not an object/],
    [[], /title/],
  ] as const)('rejects an invalid spec %#', (value, message) => {
    const result = validateInboxSpec(value)
    expect('reason' in result).toBe(true)
    if ('reason' in result) expect(result.reason).toMatch(message)
  })
})

describe('scanInbox', () => {
  it('classifies a valid UUID-named JSON file as ok', async () => {
    await writeFile(join(root, 'inbox', `${validUuid}.json`), JSON.stringify({ title: 't', prompt: 'p', executor: 'claude' }))
    const results = await scanInbox(root)
    expect(results).toEqual([{ kind: 'ok', receiptId: validUuid, spec: { title: 't', prompt: 'p', executor: 'claude' } }])
  })

  it('classifies a non-UUID `.json` filename as invalid-filename', async () => {
    await writeFile(join(root, 'inbox', 'notes.json'), '{}')
    const results = await scanInbox(root)
    expect(results).toEqual([{ kind: 'invalid-filename', name: 'notes.json' }])
  })

  it('classifies bad JSON as invalid-content', async () => {
    await writeFile(join(root, 'inbox', `${validUuid}.json`), '{ not json')
    const results = await scanInbox(root)
    expect(results).toEqual([{ kind: 'invalid-content', receiptId: validUuid, reason: 'file is not valid JSON' }])
  })

  it('classifies a bad schema as invalid-content', async () => {
    await writeFile(join(root, 'inbox', `${validUuid}.json`), JSON.stringify({ title: '', prompt: 'p', executor: 'claude' }))
    const results = await scanInbox(root)
    expect(results).toEqual([{ kind: 'invalid-content', receiptId: validUuid, reason: expect.stringMatching(/title/) }])
  })

  it('ignores `.tmp` files and other stray artifacts', async () => {
    await writeFile(join(root, 'inbox', `${validUuid}.tmp`), '{}')
    await writeFile(join(root, 'inbox', 'stray.txt'), 'x')
    const results = await scanInbox(root)
    expect(results).toEqual([])
  })

  it('processes multiple entries and preserves readdir order', async () => {
    const uuid2 = '223e4567-e89b-12d3-a456-426614174000'
    await writeFile(join(root, 'inbox', `${validUuid}.json`), JSON.stringify({ title: 'a', prompt: 'p', executor: 'claude' }))
    await writeFile(join(root, 'inbox', `${uuid2}.json`), JSON.stringify({ title: 'b', prompt: 'p', executor: 'codex' }))
    const results = await scanInbox(root)
    expect(results).toHaveLength(2)
    expect(results.every(r => r.kind === 'ok')).toBe(true)
  })
})

describe('quarantineInboxFile', () => {
  it('moves a rejected file out of inbox into quarantine', async () => {
    await writeFile(join(root, 'inbox', `${validUuid}.json`), '{}')
    await quarantineInboxFile(root, `${validUuid}.json`)
    const inbox = await readdir(join(root, 'inbox'))
    const quarantine = await readdir(join(root, 'quarantine'))
    expect(inbox).toEqual([])
    expect(quarantine).toEqual([`${validUuid}.json`])
  })
})

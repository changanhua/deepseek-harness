import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import { DomainFacility, defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { ContentAccess, ContentCommand } from '@changanhua/dsh-content'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import ContentDomain, { contentDomainSpec } from '../src/index.ts'

const fibers: Fiber[] = []
const allow: ContentAccess = () => {}

afterEach(async () => {
  await Promise.all(fibers.splice(0).reverse().map(fiber => fiber.dispose()))
})

async function harness(pool = new MemoryMediaPool(), config: Record<string, number> = {}) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new MemoryStorageBackend(pool)
  ctx.storage.backend.register('memory', {
    guarantees: ['single-writer', 'commit-sync', 'private-root'],
    kv: backend.kv, close: () => backend.close(),
  })
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.provide('storageDomain', facility)
  const fiber = await ctx.plugin(ContentDomain, config)
  fibers.push(fiber)
  await vi.waitFor(() => { expect(ctx.content.status().phase).toBe('ready') })
  return { ctx, pool, backend, facility, fiber }
}

async function harnessWithoutReadyWait(pool: MemoryMediaPool) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new MemoryStorageBackend(pool)
  ctx.storage.backend.register('memory', {
    guarantees: ['single-writer', 'commit-sync', 'private-root'],
    kv: backend.kv, close: () => backend.close(),
  })
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  fibers.push(await ctx.plugin(ContentDomain))
  return { ctx }
}

async function commitThenThrowHarness(pool: MemoryMediaPool) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new MemoryStorageBackend(pool)
  let failAfterCommit = true
  ctx.storage.backend.register('memory', {
    guarantees: ['single-writer', 'commit-sync', 'private-root'],
    kv: {
      open: async (descriptor) => {
        const unit = await backend.kv.open(descriptor)
        return committedThenFailedUnit(unit, () => failAfterCommit, () => { failAfterCommit = false })
      },
    },
    close: () => backend.close(),
  })
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  fibers.push(await ctx.plugin(ContentDomain))
  await vi.waitFor(() => { expect(ctx.content.status().phase).toBe('ready') })
  return { ctx }
}

function committedThenFailedUnit(unit: KvUnit, shouldFail: () => boolean, didFail: () => void): KvUnit {
  return {
    loadAll: () => unit.loadAll(),
    deleteRecord: (table, key) => unit.deleteRecord(table, key),
    setGlobal: value => unit.setGlobal(value),
    close: () => unit.close(),
    putRecord: async (table, key, value) => {
      await unit.putRecord(table, key, value)
      if (shouldFail()) {
        didFail()
        throw new Error('response lost after commit')
      }
    },
  }
}

function create(
  entryId = 'idea', operationId = 'create', body = 'draft',
): Extract<ContentCommand, { type: 'create' }> {
  return { type: 'create', entryId, operationId, title: 'title', body }
}

function source(body = 'original') {
  return async () => ({
    source: {
      type: 'session-message' as const,
      sessionId: 'session', messageId: 'message', captureId: 'capture',
      scope: 'full-message' as const, verification: 'host-verified' as const,
      boundary: 'completed-text' as const,
    },
    title: 'assistant', body,
  })
}

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>((settle) => { resolve = settle })
  if (!resolve) throw new Error('deferred resolver was not initialized')
  return { promise, resolve }
}

describe('ContentDomain storage contract', () => {
  it('declares one private aggregate domain', () => {
    expect(contentDomainSpec).toMatchObject({
      name: 'content_library', version: 1, layout: 'single',
      requires: ['single-writer', 'commit-sync', 'private-root'],
    })
    expect(Object.keys(contentDomainSpec.tables)).toEqual(['entries'])
  })

  it('allows only one competing draft save and lets metadata leave the draft CAS intact', async () => {
    const { ctx } = await harness()
    const created = await ctx.content.execute(create(), allow)
    const metadata = await ctx.content.execute({
      type: 'metadata', entryId: 'idea', operationId: 'favorite',
      expectedEntryRevision: created.entryRevision, favorite: true,
    }, allow)
    const first = {
      type: 'save-draft' as const, entryId: 'idea', operationId: 'save-a',
      expectedDraftRevision: created.draftRevision ?? 0, basedOnVersionId: null,
      title: 'title', body: 'first',
    }
    const [one, two] = await Promise.allSettled([
      ctx.content.execute(first, allow),
      ctx.content.execute({ ...first, operationId: 'save-b', body: 'second' }, allow),
    ])
    expect([one, two].filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect([one, two].find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'revision_conflict' },
    })
    const entry = ctx.content.get('idea', allow)
    expect(entry?.favorite).toBe(true)
    expect(entry?.entryRevision).toBeGreaterThan(metadata.entryRevision)
    expect(entry?.draft?.body).toMatch(/^(first|second)$/u)
  })

  it('rechecks authorization after source preparation and returns detached values', async () => {
    const { ctx } = await harness()
    const command = create('copy', 'copy-op', 'exact\r\n文本')
    const receipt = await ctx.content.execute(command, allow)
    command.body = 'caller mutation'
    receipt.entryRevision = 999
    const entry = ctx.content.get('copy', allow)
    if (!entry?.draft) throw new Error('expected saved draft')
    entry.draft.body = 'reader mutation'
    expect(ctx.content.get('copy', allow)?.draft?.body).toBe('exact\r\n文本')
    expect(ctx.content.receipt('copy', 'copy-op', allow)?.entryRevision).toBe(1)

    let checks = 0
    const revoked: ContentAccess = () => {
      checks += 1
      if (checks > 1) throw new Error('forbidden')
    }
    const resolver = vi.fn(source())
    await expect(ctx.content.capture({ operationId: 'denied', sessionId: 'session', messageId: 'message' }, resolver, revoked))
      .rejects.toThrow('forbidden')
    expect(resolver).toHaveBeenCalledOnce()
    expect(ctx.content.snapshot(allow).entries).toHaveLength(1)

    const deny: ContentAccess = () => { throw new Error('forbidden') }
    const never = vi.fn(source())
    await expect(ctx.content.capture({ operationId: 'never', sessionId: 'session', messageId: 'message' }, never, deny))
      .rejects.toThrow('forbidden')
    expect(never).not.toHaveBeenCalled()
  })

  it('uses source identity, rejects divergent text, and retains the creation receipt', async () => {
    const { ctx } = await harness()
    const first = await ctx.content.capture({ operationId: 'capture-a', sessionId: 'session', messageId: 'message' }, source(), allow)
    const retry = await ctx.content.capture({ operationId: 'capture-b', sessionId: 'session', messageId: 'message' }, source(), allow)
    expect(retry).toEqual(first)
    await expect(ctx.content.capture({ operationId: 'capture-c', sessionId: 'session', messageId: 'message' }, source('changed'), allow))
      .rejects.toMatchObject({ code: 'source_conflict' })
    expect(ctx.content.receipt(first.entryId, 'capture-a', allow)).toEqual(first)
  })

  it('replays a same-operation capture and rejects malformed or mismatched resolver results', async () => {
    const { ctx } = await harness()
    const command = { operationId: 'same-capture', sessionId: 'session', messageId: 'message' }
    const first = await ctx.content.capture(command, source(), allow)
    expect(await ctx.content.capture({ ...command }, source(), allow)).toEqual(first)
    await expect(ctx.content.capture({ operationId: 'wrong-source', sessionId: 'session', messageId: 'message' }, async () => ({
      ...(await source()()), source: { ...(await source()()).source, sessionId: 'other' },
    }), allow)).rejects.toMatchObject({ code: 'source_conflict' })
    await expect(ctx.content.capture({ operationId: 'bad-source', sessionId: 'session', messageId: 'message' }, async () => ({ bad: true }) as never, allow))
      .rejects.toMatchObject({ code: 'invalid_request' })
    await expect(ctx.content.execute({ type: 'create', entryId: 'bad', operationId: 'bad', title: 'x', body: '\ud800' } as never, allow))
      .rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('does not turn a rejected storage write into success and requires reopen for reads', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    pool.failNextWrites = 1
    await expect(first.ctx.content.execute(create('failure', 'failure-op'), allow)).rejects.toMatchObject({ code: 'storage_failed' })
    expect(first.ctx.content.status()).toMatchObject({ phase: 'unavailable', reason: 'storage_failed' })
    expect(() => first.ctx.content.get('failure', allow)).toThrow()
    await expect(first.ctx.content.execute(create('later', 'later-op'), allow)).rejects.toMatchObject({ code: 'storage_failed' })
    const second = await harness(pool)
    expect(second.ctx.content.get('failure', allow)).toBeUndefined()
  })

  it('recovers an operation whose durable write committed before the provider received a failure', async () => {
    const pool = new MemoryMediaPool()
    const first = await commitThenThrowHarness(pool)
    const request = create('uncertain', 'uncertain-op', 'durable text')
    await expect(first.ctx.content.execute(request, allow)).rejects.toMatchObject({ code: 'storage_failed' })
    const reopened = await harness(pool)
    expect(await reopened.ctx.content.execute(request, allow)).toMatchObject({
      operationId: 'uncertain-op', entryId: 'uncertain', entryRevision: 1,
    })
    expect(reopened.ctx.content.get('uncertain', allow)?.draft?.body).toBe('durable text')
  })

  it('invalidates every queued write after the first uncertain storage failure', async () => {
    const pool = new MemoryMediaPool()
    const { ctx } = await harness(pool)
    pool.failNextWrites = 1
    const outcomes = await Promise.allSettled([
      ctx.content.execute(create('first-write', 'first-op'), allow),
      ctx.content.execute(create('second-write', 'second-op'), allow),
    ])
    expect(outcomes.every(outcome => outcome.status === 'rejected')).toBe(true)
    expect(ctx.content.status()).toMatchObject({ phase: 'unavailable', reason: 'storage_failed' })
    expect(pool.media.get('content_library')?.tables.get('entries')?.size ?? 0).toBe(0)
    expect(() => ctx.content.snapshot(allow)).toThrow()
  })

  it('enforces UTF-8 body capacity without truncating exact multibyte text', async () => {
    const { ctx } = await harness(new MemoryMediaPool(), {
      bodyBytes: 6,
      entryBytes: 100_000,
      libraryBytes: 100_000,
    })
    await ctx.content.execute(create('two-chars', 'within', '中文'), allow)
    expect(ctx.content.get('two-chars', allow)?.draft?.body).toBe('中文')
    await expect(ctx.content.execute(create('three-chars', 'over', '中文啊'), allow))
      .rejects.toMatchObject({ code: 'capacity_exceeded' })
    expect(ctx.content.get('three-chars', allow)).toBeUndefined()
  })

  it('keeps an over-limit existing library readable while refusing every new write', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    await first.ctx.content.execute(create('retained', 'retained-op', '中文啊'), allow)
    await first.fiber.dispose()
    const reopened = await harness(pool, { bodyBytes: 1, entryBytes: 100_000, libraryBytes: 100_000 })
    expect(reopened.ctx.content.status()).toMatchObject({ phase: 'ready', reason: 'capacity_exceeded' })
    expect(reopened.ctx.content.snapshot(allow).entries[0]?.draft?.body).toBe('中文啊')
    await expect(reopened.ctx.content.execute(create('new', 'new-op', 'x'), allow))
      .rejects.toMatchObject({ code: 'capacity_exceeded' })
  })

  it('accepts exact independently measured entry and library JSON boundaries', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    await first.ctx.content.execute(create('boundary', 'boundary-op', 'boundary text'), allow)
    const entry = first.ctx.content.get('boundary', allow)
    if (!entry) throw new Error('expected entry for boundary measurement')
    const table = pool.media.get('content_library')?.tables.get('entries')
    if (!table) throw new Error('expected durable entries table')
    const entryBytes = Buffer.byteLength(JSON.stringify(entry), 'utf8')
    const libraryBytes = Buffer.byteLength(JSON.stringify({
      tables: { entries: Object.fromEntries(table) }, global: null,
    }), 'utf8')
    await first.fiber.dispose()

    const exact = await harness(pool, { bodyBytes: 100_000, entryBytes, libraryBytes })
    expect(exact.ctx.content.status()).toMatchObject({ phase: 'ready', reason: null })
    await exact.fiber.dispose()

    const below = await harness(pool, { bodyBytes: 100_000, entryBytes: entryBytes - 1, libraryBytes: libraryBytes - 1 })
    expect(below.ctx.content.status()).toMatchObject({ phase: 'ready', reason: 'capacity_exceeded' })
    expect(below.ctx.content.get('boundary', allow)?.draft?.body).toBe('boundary text')
  })

  it('counts special and maximum-length entry identities as ordinary retained records', async () => {
    const { ctx } = await harness()
    await ctx.content.execute(create('__proto__', 'proto-op'), allow)
    const maximum = 'x'.repeat(512)
    await ctx.content.execute(create(maximum, 'maximum-op'), allow)
    expect(ctx.content.get('__proto__', allow)?.id).toBe('__proto__')
    expect(ctx.content.get(maximum, allow)?.id).toBe(maximum)
  })

  it('keeps permanent creation receipts while evicting old transient mutation receipts', async () => {
    const { ctx } = await harness()
    const created = await ctx.content.execute(create('history', 'creation'), allow)
    let revision = created.entryRevision
    for (let index = 0; index < 257; index += 1) {
      const outcome = await ctx.content.execute({
        type: 'metadata', entryId: 'history', operationId: `metadata-${index}`,
        expectedEntryRevision: revision, favorite: index % 2 === 0,
      }, allow)
      revision = outcome.entryRevision
    }
    expect(ctx.content.receipt('history', 'creation', allow)).toEqual(created)
    expect(ctx.content.receipt('history', 'metadata-0', allow)).toBeUndefined()
    await expect(ctx.content.execute({
      type: 'metadata', entryId: 'history', operationId: 'metadata-0',
      expectedEntryRevision: 1, favorite: true,
    }, allow)).rejects.toMatchObject({ code: 'revision_conflict' })
  })

  it('preserves immutable originals through two draft-to-version edit cycles', async () => {
    const { ctx } = await harness()
    const original = await ctx.content.execute({
      type: 'save-text', entryId: 'original', operationId: 'import', title: 'source', body: 'first\r\nsource',
    }, allow)
    const started = await ctx.content.execute({
      type: 'start-draft', entryId: 'original', operationId: 'start-1', expectedEntryRevision: original.entryRevision,
    }, allow)
    const saved = await ctx.content.execute({
      type: 'save-draft', entryId: 'original', operationId: 'save-1',
      expectedDraftRevision: started.draftRevision ?? 0, basedOnVersionId: original.versionId,
      title: 'edited', body: 'second working copy',
    }, allow)
    const committed = await ctx.content.execute({
      type: 'commit-version', entryId: 'original', operationId: 'commit-1',
      expectedDraftRevision: saved.draftRevision ?? 0, basedOnVersionId: original.versionId,
      expectedHeadVersionId: original.versionId,
    }, allow)
    const entry = ctx.content.get('original', allow)
    expect(entry?.versions.map(version => version.body)).toEqual(['first\r\nsource', 'second working copy'])
    expect(entry?.draft).toBeNull()
    expect(committed.versionId).not.toBe(original.versionId)

    const secondStart = await ctx.content.execute({
      type: 'start-draft', entryId: 'original', operationId: 'start-2', expectedEntryRevision: committed.entryRevision,
    }, allow)
    const secondSave = await ctx.content.execute({
      type: 'save-draft', entryId: 'original', operationId: 'save-2',
      expectedDraftRevision: secondStart.draftRevision ?? 0, basedOnVersionId: committed.versionId,
      title: 'third', body: 'third working copy',
    }, allow)
    await ctx.content.execute({
      type: 'commit-version', entryId: 'original', operationId: 'commit-2',
      expectedDraftRevision: secondSave.draftRevision ?? 0, basedOnVersionId: committed.versionId,
      expectedHeadVersionId: committed.versionId,
    }, allow)
    expect(ctx.content.get('original', allow)?.versions.map(version => version.body))
      .toEqual(['first\r\nsource', 'second working copy', 'third working copy'])
  })

  it('enforces metadata references and every stale or illegal edit transition', async () => {
    const { ctx } = await harness()
    const original = await ctx.content.execute({
      type: 'save-text', entryId: 'guards', operationId: 'import', title: 'source', body: 'body',
    }, allow)
    await expect(ctx.content.execute({
      type: 'save-draft', entryId: 'guards', operationId: 'no-draft', expectedDraftRevision: 1,
      basedOnVersionId: original.versionId, title: 'x', body: 'x',
    }, allow)).rejects.toMatchObject({ code: 'revision_conflict' })
    await expect(ctx.content.execute({
      type: 'commit-version', entryId: 'guards', operationId: 'no-draft-commit', expectedDraftRevision: 1,
      basedOnVersionId: original.versionId, expectedHeadVersionId: original.versionId,
    }, allow)).rejects.toMatchObject({ code: 'revision_conflict' })
    await expect(ctx.content.execute({
      type: 'start-draft', entryId: 'guards', operationId: 'stale-start', expectedEntryRevision: 99,
    }, allow)).rejects.toMatchObject({ code: 'revision_conflict' })
    const started = await ctx.content.execute({
      type: 'start-draft', entryId: 'guards', operationId: 'start', expectedEntryRevision: original.entryRevision,
    }, allow)
    await expect(ctx.content.execute({
      type: 'start-draft', entryId: 'guards', operationId: 'start-again', expectedEntryRevision: started.entryRevision,
    }, allow)).rejects.toMatchObject({ code: 'invalid_transition' })
    await expect(ctx.content.execute({
      type: 'save-draft', entryId: 'guards', operationId: 'wrong-base',
      expectedDraftRevision: started.draftRevision ?? 0, basedOnVersionId: null, title: 'x', body: 'x',
    }, allow)).rejects.toMatchObject({ code: 'revision_conflict' })
    const metadata = await ctx.content.execute({
      type: 'metadata', entryId: 'guards', operationId: 'metadata', expectedEntryRevision: started.entryRevision,
      archived: true, addProjectRef: 'project-a',
    }, allow)
    const removed = await ctx.content.execute({
      type: 'metadata', entryId: 'guards', operationId: 'remove-project', expectedEntryRevision: metadata.entryRevision,
      removeProjectRef: 'project-a', favorite: true,
    }, allow)
    expect(ctx.content.get('guards', allow)).toMatchObject({ archived: true, favorite: true, projectRefs: [] })
    await expect(ctx.content.execute({
      type: 'metadata', entryId: 'missing', operationId: 'missing', expectedEntryRevision: removed.entryRevision, favorite: true,
    }, allow)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('replays exact creation requests but rejects changed payloads and another operation for the same entry', async () => {
    const { ctx } = await harness()
    const request = create('idempotent', 'same-op', 'same body')
    const first = await ctx.content.execute(request, allow)
    expect(await ctx.content.execute({ ...request }, allow)).toEqual(first)
    await expect(ctx.content.execute({ ...request, body: 'changed body' }, allow))
      .rejects.toMatchObject({ code: 'operation_conflict' })
    await expect(ctx.content.execute(create('idempotent', 'another-op', 'same body'), allow))
      .rejects.toMatchObject({ code: 'operation_conflict' })
  })

  it('retains version receipts permanently after the recent metadata window advances', async () => {
    const { ctx } = await harness()
    const imported = await ctx.content.execute({
      type: 'save-text', entryId: 'version-history', operationId: 'import', title: 'source', body: 'source',
    }, allow)
    const started = await ctx.content.execute({
      type: 'start-draft', entryId: 'version-history', operationId: 'start', expectedEntryRevision: imported.entryRevision,
    }, allow)
    const saved = await ctx.content.execute({
      type: 'save-draft', entryId: 'version-history', operationId: 'save',
      expectedDraftRevision: started.draftRevision ?? 0, basedOnVersionId: imported.versionId, title: 'edited', body: 'edited',
    }, allow)
    const version = await ctx.content.execute({
      type: 'commit-version', entryId: 'version-history', operationId: 'version-op',
      expectedDraftRevision: saved.draftRevision ?? 0, basedOnVersionId: imported.versionId,
      expectedHeadVersionId: imported.versionId,
    }, allow)
    let revision = version.entryRevision
    for (let index = 0; index < 257; index += 1) {
      const result = await ctx.content.execute({
        type: 'metadata', entryId: 'version-history', operationId: `advance-${index}`,
        expectedEntryRevision: revision, favorite: index % 2 === 0,
      }, allow)
      revision = result.entryRevision
    }
    expect(ctx.content.receipt('version-history', 'version-op', allow)).toEqual(version)
  })

  it('refuses a reopened record whose body no longer matches its stored digest', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const imported = await first.ctx.content.execute({
      type: 'save-text', entryId: 'digest', operationId: 'digest-op', title: 'source', body: 'before',
    }, allow)
    await first.fiber.dispose()
    const stored = pool.media.get('content_library')?.tables.get('entries')?.get('digest') as { versions: Array<{ body: string }> } | undefined
    if (!stored) throw new Error('expected direct persisted content record')
    const version = stored.versions.at(0)
    if (!version) throw new Error('expected persisted original version')
    version.body = 'after'
    const reopened = await harnessWithoutReadyWait(pool)
    await vi.waitFor(() => { expect(reopened.ctx.content.status()).toMatchObject({ phase: 'unavailable', reason: 'invalid_library' }) })
    expect(imported.versionId).toBeDefined()
  })

  it('refuses a structurally valid record persisted under a different table key', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    await first.ctx.content.execute(create('right-key', 'key-op'), allow)
    await first.fiber.dispose()
    const entries = pool.media.get('content_library')?.tables.get('entries')
    const record = entries?.get('right-key')
    if (!entries || !record) throw new Error('expected valid persisted record')
    entries.delete('right-key')
    entries.set('wrong-key', record)
    const reopened = await harnessWithoutReadyWait(pool)
    await vi.waitFor(() => { expect(reopened.ctx.content.status()).toMatchObject({ phase: 'unavailable', reason: 'invalid_library' }) })
  })

  it('rejects a routed backend that does not declare the content guarantees', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const backend = new MemoryStorageBackend()
    ctx.storage.backend.register('unsafe', { kv: backend.kv, close: () => backend.close() })
    const facility = new DomainFacility(ctx, { backend: 'unsafe' })
    ctx.provide('storageDomain', facility)
    fibers.push(await ctx.plugin(ContentDomain))
    await vi.waitFor(() => { expect(ctx.content.status()).toMatchObject({ phase: 'unavailable' }) })
    expect(ctx.content.status().reason).toBe('storage_failed')
  })

  it('stays diagnosable without Storage Domain and maps an exclusive-library open failure', async () => {
    const unavailable = new Context()
    fibers.push(await unavailable.plugin(ContentDomain))
    expect(unavailable.content.status()).toMatchObject({ phase: 'unavailable', reason: 'unavailable' })
    expect(() => unavailable.content.snapshot(allow)).toThrow()

    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('busy', {
      guarantees: ['single-writer', 'commit-sync', 'private-root'],
      kv: { open: async () => { throw Object.assign(new Error('busy'), { errcode: 5 }) } },
      close: async () => {},
    })
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'busy' }))
    fibers.push(await ctx.plugin(ContentDomain))
    await vi.waitFor(() => { expect(ctx.content.status()).toMatchObject({ phase: 'unavailable', reason: 'library_in_use' }) })
  })

  it('drains a capture accepted before shutdown after its resolver becomes ready', async () => {
    const { ctx, fiber, pool } = await harness()
    const gate = deferred<Awaited<ReturnType<ReturnType<typeof source>>>>()
    const resolver = vi.fn(async () => gate.promise)
    const capture = ctx.content.capture({
      operationId: 'shutdown-capture', sessionId: 'session', messageId: 'message',
    }, resolver, allow)
    await vi.waitFor(() => { expect(resolver).toHaveBeenCalledOnce() })
    const stopping = fiber.dispose()
    gate.resolve(await source()())
    await expect(capture).resolves.toMatchObject({ operationId: 'shutdown-capture' })
    await stopping
    expect(pool.media.get('content_library')?.tables.get('entries')?.size).toBe(1)
  })

  it('keeps an ordinary domain usable when its own persisted aggregate is invalid', async () => {
    const pool = new MemoryMediaPool()
    pool.versions.set('content_library', 1)
    pool.media.set('content_library', {
      tables: new Map([['entries', new Map<string, unknown>([['wrong-key', { invalid: true }]])]]), global: null,
    })
    const ctx = new Context()
    await ctx.plugin(Storage)
    const backend = new MemoryStorageBackend(pool)
    ctx.storage.backend.register('memory', {
      guarantees: ['single-writer', 'commit-sync', 'private-root'], kv: backend.kv, close: () => backend.close(),
    })
    const facility = new DomainFacility(ctx, { backend: 'memory' })
    ctx.provide('storageDomain', facility)
    fibers.push(await ctx.plugin(ContentDomain))
    await vi.waitFor(() => { expect(ctx.content.status()).toMatchObject({ phase: 'unavailable', reason: 'invalid_library' }) })
    const ordinary = defineDomain({
      name: 'ordinary', version: 1,
      tables: { values: domainTable<string, { value: string }>(z.strictObject({ value: z.string() })) },
    })
    const opened = await facility.open(ordinary)
    await opened.table('values').put('safe', { value: 'still works' })
    expect(opened.table('values').get('safe')).toEqual({ value: 'still works' })
  })
})

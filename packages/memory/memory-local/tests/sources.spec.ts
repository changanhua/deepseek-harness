import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { captureMemorySources, checkMemorySources } from '../src/sources.ts'

const roots: string[] = []
const contexts: Context[] = []
const links: string[] = []
const MAX_BYTES = 1024 * 1024

afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const path of links.splice(0)) await unlink(path)
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !root.includes('dsh-memory-source-test-')) throw new Error('refusing unrelated cleanup')
    await rm(root, { recursive: true, force: true })
  }
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-source-test-'))
  roots.push(root)
  const cwd = join(root, 'project')
  await mkdir(cwd)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(SessionQuery, { path: ':memory:', openAt: 'never' })
  await ctx.plugin(LocalFileSystem, { cwd })
  return { ctx, cwd, root, access: { fs: ctx.fs, query: ctx.sessionQuery, persistence: ctx.sessionPersistence, cwd } }
}

describe('memory source provenance', () => {
  it('rejects a Session query result without project metadata', async () => {
    const { ctx, access } = await harness()
    const session = ctx.sessions.create(SessionId('no-project'))
    const event = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'global statement' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await ctx.sessions.flush(session)
    await expect(captureMemorySources(access, [{ kind: 'session-event', sessionId: session.id, seq: event.seq }], MAX_BYTES))
      .rejects.toMatchObject({ code: 'source-unavailable' })
  })

  it('propagates cancellation after a physical Session read finishes', async () => {
    const { ctx, cwd, access } = await harness()
    const session = ctx.sessions.create(SessionId('cancel-session-source'), { meta: { cwd } })
    const event = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'physical source' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await ctx.sessions.flush(session)
    const controller = new AbortController()
    const read = access.persistence.readFrom.bind(access.persistence)
    vi.spyOn(access.persistence, 'readFrom').mockImplementationOnce(async (...args) => {
      const result = await read(...args)
      controller.abort(new Error('cancel after persisted read'))
      return result
    })
    await expect(captureMemorySources(access, [{ kind: 'session-event', sessionId: session.id, seq: event.seq }], MAX_BYTES, controller.signal))
      .rejects.toThrow('cancel after persisted read')
  })

  it('distinguishes invalid stored locators or limits from temporary source unavailability', async () => {
    const { access } = await harness()
    const source = { kind: 'file' as const, path: 'README.md', sha256: 'a'.repeat(64) }
    await expect(checkMemorySources(access, [source], 0)).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(checkMemorySources(access, [{ ...source, path: '../outside.md' }], 100)).rejects.toMatchObject({ name: 'ZodError' })
  })

  it('rejects an unmappable project and a filesystem that returns more bytes than allowed', async () => {
    const { cwd, access } = await harness()
    await writeFile(join(cwd, 'README.md'), 'hello')
    const mapping = vi.spyOn(access.fs, 'processPathFromHostPath').mockReturnValueOnce(undefined)
    await expect(captureMemorySources(access, [{ kind: 'file', path: 'README.md' }], 10)).rejects.toMatchObject({ code: 'source-unavailable' })
    mapping.mockRestore()
    vi.spyOn(access.fs, 'readBytes').mockResolvedValueOnce(new Uint8Array(11))
    await expect(captureMemorySources(access, [{ kind: 'file', path: 'README.md' }], 10)).rejects.toMatchObject({ code: 'source-unavailable' })
  })

  it('handles a backend without a size hint and still rejects valid UTF-8 containing NUL', async () => {
    const { cwd, access } = await harness()
    await writeFile(join(cwd, 'README.md'), 'hello')
    const info = await access.fs.stat(await access.fs.resolve('README.md'))
    if (info === undefined) throw new Error('test file metadata missing')
    const withoutSize = { ...info }
    Reflect.deleteProperty(withoutSize, 'size')
    vi.spyOn(access.fs, 'stat').mockResolvedValue(withoutSize)
    const captured = await captureMemorySources(access, [{ kind: 'file', path: 'README.md', line: 1 }], 10)
    expect(await checkMemorySources(access, captured, 10)).toMatchObject([{ status: 'current', source: { line: 1 } }])
    await writeFile(join(cwd, 'README.md'), 'a\0b')
    await expect(captureMemorySources(access, [{ kind: 'file', path: 'README.md' }], 10)).rejects.toMatchObject({ code: 'source-unavailable' })
  })

  it.each(['id', 'cwd', 'missing-cwd'])('rejects persisted Session metadata differing from the authorized query: %s', async (field) => {
    const { ctx, cwd, root, access } = await harness()
    const session = ctx.sessions.create(SessionId('inconsistent-metadata'), { meta: { cwd } })
    const event = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'a recorded source' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await ctx.sessions.flush(session)
    const read = access.persistence.readFrom.bind(access.persistence)
    vi.spyOn(access.persistence, 'readFrom').mockImplementation(async (...args) => {
      const stored = await read(...args)
      const meta = { ...stored.meta }
      if (field === 'id') meta.id = SessionId('different-id')
      else if (field === 'cwd') meta.cwd = root
      else Reflect.deleteProperty(meta, 'cwd')
      return { ...stored, meta }
    })
    await expect(captureMemorySources(access, [{ kind: 'session-event', sessionId: session.id, seq: event.seq }], MAX_BYTES))
      .rejects.toMatchObject({ code: 'source-unavailable' })
  })

  it.each(['', 'x'.repeat(21)])('rejects empty or oversized persisted Session text: %j', async (text) => {
    const { ctx, cwd, access } = await harness()
    const session = ctx.sessions.create(SessionId('unusable-text'), { meta: { cwd } })
    const event = session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    await ctx.sessions.flush(session)
    await expect(captureMemorySources(access, [{ kind: 'session-event', sessionId: session.id, seq: event.seq }], 20))
      .rejects.toMatchObject({ code: 'source-unavailable' })
  })

  it('detects a stored event-type mismatch even when the text fingerprint matches', async () => {
    const { ctx, cwd, access } = await harness()
    const session = ctx.sessions.create(SessionId('typed-source'), { meta: { cwd } })
    const event = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await ctx.sessions.flush(session)
    const captured = await captureMemorySources(access, [{ kind: 'session-event', sessionId: session.id, seq: event.seq }], 20)
    const source = captured[0]
    if (source?.kind !== 'session-event') throw new Error('test did not capture a Session source')
    expect(await checkMemorySources(access, [{ ...source, eventType: 'assistant/message' }], 20)).toMatchObject([{ status: 'changed' }])
  })

  it('does not fall back to host reads when the Agent filesystem denies access', async () => {
    const { cwd, access } = await harness()
    await writeFile(join(cwd, 'private.md'), 'sensitive project source')
    const captured = await captureMemorySources(access, [{ kind: 'file', path: 'private.md' }], MAX_BYTES)
    vi.spyOn(access.fs, 'readBytes').mockRejectedValue(Object.assign(new Error('access denied: private.md'), { code: 'EACCES' }))
    await expect(captureMemorySources(access, [{ kind: 'file', path: 'private.md' }], MAX_BYTES))
      .rejects.toMatchObject({ code: 'source-unavailable', message: 'memory source cannot be read in this Workspace' })
    const checked = await checkMemorySources(access, captured, MAX_BYTES)
    expect(checked).toEqual([{ source: captured[0], status: 'unavailable' }])
    expect(JSON.stringify(checked)).not.toContain('sensitive project source')
  })

  it('rejects absent and non-content events within an otherwise authorized stored Session', async () => {
    const { ctx, cwd, access } = await harness()
    const session = ctx.sessions.create(SessionId('authorized-without-content'), { meta: { cwd } })
    const boundary = session.append('turn/start', { turn: 1 })
    await ctx.sessions.flush(session)
    for (const seq of [boundary.seq, boundary.seq + 100]) {
      await expect(captureMemorySources(access, [{ kind: 'session-event', sessionId: session.id, seq }], MAX_BYTES))
        .rejects.toMatchObject({ code: 'source-unavailable' })
    }
  })

  it('hashes complete file bytes and reports changed bytes separately from missing data', async () => {
    const { cwd, access } = await harness()
    await writeFile(join(cwd, 'README.md'), 'hello')
    const captured = await captureMemorySources(access, [{ kind: 'file', path: 'README.md' }], MAX_BYTES)
    expect(captured).toEqual([{ kind: 'file', path: 'README.md', sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' }])
    expect(await checkMemorySources(access, captured, MAX_BYTES)).toMatchObject([{ status: 'current', preview: 'hello' }])
    await writeFile(join(cwd, 'README.md'), 'different')
    expect(await checkMemorySources(access, captured, MAX_BYTES)).toMatchObject([{ status: 'changed' }])
    await unlink(join(cwd, 'README.md'))
    expect(await checkMemorySources(access, captured, MAX_BYTES)).toMatchObject([{ status: 'unavailable' }])
  })

  it('rejects directories, binary text and source files exceeding the read limit', async () => {
    const { cwd, access } = await harness()
    await mkdir(join(cwd, 'folder'))
    await writeFile(join(cwd, 'binary'), Buffer.from([0xff, 0x00]))
    await writeFile(join(cwd, 'large'), 'a'.repeat(21))
    for (const path of ['folder', 'binary', 'large']) {
      await expect(captureMemorySources(access, [{ kind: 'file', path }], 20)).rejects.toMatchObject({ code: 'source-unavailable' })
    }
  })

  it('rejects a junction escaping the project while preserving the target', async () => {
    const { root, cwd, access } = await harness()
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'secret.md'), 'foreign project fact')
    const link = join(cwd, 'escape')
    await symlink(outside, link, 'junction')
    links.push(link)
    await expect(captureMemorySources(access, [{ kind: 'file', path: 'escape/secret.md' }], MAX_BYTES)).rejects.toMatchObject({ code: 'source-unavailable' })
  })

  it('binds a user statement to a physically persisted Session event', async () => {
    const { ctx, cwd, access } = await harness()
    const session = ctx.sessions.create(SessionId('source-a'), { meta: { cwd } })
    session.append('turn/start', { turn: 1 })
    const event = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    await ctx.sessions.flush(session)
    const captured = await captureMemorySources(access, [{ kind: 'session-event', sessionId: session.id, seq: event.seq }], MAX_BYTES)
    expect(captured).toEqual([{ kind: 'session-event', sessionId: 'source-a', seq: event.seq, eventType: 'user/message', sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' }])
    expect(await checkMemorySources(access, captured, MAX_BYTES)).toMatchObject([{ status: 'current', preview: 'hello' }])
  })

  it('does not read another project event or fabricate an event beyond the stored prefix', async () => {
    const { ctx, root, access } = await harness()
    const foreign = join(root, 'other')
    await mkdir(foreign)
    const session = ctx.sessions.create(SessionId('foreign'), { meta: { cwd: foreign } })
    session.append('turn/start', { turn: 1 })
    const event = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'not for this project' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    await ctx.sessions.flush(session)
    await expect(captureMemorySources(access, [{ kind: 'session-event', sessionId: session.id, seq: event.seq }], MAX_BYTES)).rejects.toMatchObject({ code: 'source-unavailable' })
    await expect(captureMemorySources(access, [{ kind: 'session-event', sessionId: 'absent', seq: 999 }], MAX_BYTES)).rejects.toMatchObject({ code: 'source-unavailable' })
  })

  it('propagates cancellation instead of reporting a source as invalid', async () => {
    const { access } = await harness()
    const signal = AbortSignal.abort(new Error('operator canceled'))
    await expect(captureMemorySources(access, [{ kind: 'file', path: 'README.md' }], MAX_BYTES, signal)).rejects.toThrow('operator canceled')
  })
})

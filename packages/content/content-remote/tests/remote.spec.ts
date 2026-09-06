import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { ContentError } from '@changanhua/dsh-content'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import ContentRemote from '../src/index.ts'

function fixture() {
  const ctx = new Context()
  let allowed = true
  const authorize = vi.fn(() => { if (!allowed) throw new Error('private credential') })
  ctx.provide('connection', { assertAuthorized: authorize } as never)
  const content = {
    status: vi.fn(() => ({ phase: 'ready', reason: null, limits: { bodyBytes: 1, entryBytes: 2, libraryBytes: 3 } })),
    get: vi.fn((_id: string, admit: () => void) => { admit(); return undefined }),
    snapshot: vi.fn((admit: () => void) => { admit(); return { formatVersion: 1, entries: [] } }),
    receipt: vi.fn((_id: string, _operation: string, admit: () => void) => { admit(); return undefined }),
    execute: vi.fn(async (_input: unknown, admit: () => void) => { await Promise.resolve(); admit(); return { operationId: 'o' } }),
    capture: vi.fn(async (input: unknown, resolve: (request: unknown) => Promise<unknown>, admit: () => void) => {
      admit()
      await resolve(input)
      admit()
      return { operationId: 'o' }
    }),
  }
  ctx.provide('content', content as never)
  const resolve = vi.fn(async (_input: unknown, admit: () => void) => { admit(); return {} })
  ctx.provide('contentSession', { resolve } as never)
  const remote = new ContentRemote(ctx)
  return { remote, content, resolve, authorize, revoke: () => { allowed = false }, signal: new AbortController().signal }
}

describe('Content Remote authorization', () => {
  it('authorizes every read including status and maps missing values to null', () => {
    const f = fixture()
    expect(f.remote.status(f.signal).phase).toBe('ready')
    expect(f.remote.get('entry', f.signal)).toBeNull()
    expect(f.remote.snapshot(f.signal).entries).toEqual([])
    expect(f.remote.receipt('entry', 'op', f.signal)).toBeNull()
    f.revoke()
    for (const call of [() => f.remote.status(f.signal), () => f.remote.get('entry', f.signal),
      () => f.remote.snapshot(f.signal), () => f.remote.receipt('entry', 'op', f.signal)]) {
      expect(call).toThrow(TypertRemoteFailure)
      let thrown: unknown
      try { call() } catch (error) { thrown = error }
      expect((thrown as TypertRemoteFailure).failure.code).toBe('forbidden')
    }
    expect(f.content.status).toHaveBeenCalledOnce()
    expect(f.content.snapshot).toHaveBeenCalledOnce()
  })

  it('rejects forged source and caller fields before reading the Session', async () => {
    const f = fixture()
    await expect(f.remote.capture({ operationId: 'o', sessionId: 's', messageId: '1', body: 'forged', isHuman: true } as never, f.signal))
      .rejects.toMatchObject({ failure: { code: 'invalid_request' } })
    expect(f.resolve).not.toHaveBeenCalled()
    await expect(f.remote.execute({ type: 'create', entryId: 'e', operationId: 'o', title: '', body: '', ownerId: 'human' } as never, f.signal))
      .rejects.toMatchObject({ failure: { code: 'invalid_request' } })
    expect(f.content.execute).not.toHaveBeenCalled()
  })

  it('rechecks authority after admission and preserves typed failures without payload', async () => {
    const f = fixture()
    const pending = f.remote.execute({ type: 'create', entryId: 'e', operationId: 'o', title: '', body: 'secret' }, f.signal)
    f.revoke()
    await expect(pending).rejects.toMatchObject({ failure: { code: 'forbidden', details: {} } })
    const other = fixture()
    other.content.execute.mockRejectedValueOnce(new ContentError('revision_conflict'))
    await expect(other.remote.execute({ type: 'create', entryId: 'e', operationId: 'o', title: '', body: 'secret' }, other.signal))
      .rejects.toMatchObject({ failure: { code: 'revision_conflict', details: {} } })
    other.content.execute.mockRejectedValueOnce(new Error('secret database path'))
    await expect(other.remote.execute({ type: 'create', entryId: 'e', operationId: 'o', title: '', body: 'secret' }, other.signal))
      .rejects.toMatchObject({ failure: { code: 'unavailable', message: 'Content operation failed: unavailable', details: {} } })
  })

  it('passes a trusted resolver and the same request signal to capture', async () => {
    const f = fixture()
    const request = { operationId: 'o', sessionId: 's', messageId: '1' }
    await expect(f.remote.capture(request, f.signal)).resolves.toMatchObject({ operationId: 'o' })
    expect(f.resolve).toHaveBeenCalledWith(request, expect.any(Function), f.signal)
    const controller = new AbortController()
    controller.abort('sensitive cancellation reason')
    await expect(f.remote.capture(request, controller.signal)).rejects.toMatchObject({ failure: { code: 'closed' } })
    expect(f.resolve).toHaveBeenCalledOnce()
  })

  it('rechecks authority after a suspended source read and before the commit', async () => {
    const f = fixture()
    let release!: () => void
    const gated = new Promise<void>((gatedResolve) => { release = gatedResolve })
    f.resolve.mockImplementationOnce(async (_input: unknown, check: () => void) => {
      await gated
      check()
      return {
        source: { type: 'session-message', sessionId: 's', messageId: '1', captureId: 'event:1',
          scope: 'full-message', verification: 'host-verified', boundary: 'completed-text' },
        title: '', body: 'resolved body',
      }
    })
    const pending = f.remote.capture({ operationId: 'o', sessionId: 's', messageId: '1' }, f.signal)
    f.revoke()
    release()
    await expect(pending).rejects.toMatchObject({ failure: { code: 'forbidden', details: {} } })
    expect(f.resolve).toHaveBeenCalledOnce()
  })
})

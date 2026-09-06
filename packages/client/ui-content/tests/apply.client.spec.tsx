// @vitest-environment jsdom
/**
 * The ui-content browser half on a real cordis Context with fake remote
 * faces: the plugin registers the capture entry, the library workspace, and
 * the sidebar entry; one store backs every contribution; a connection reset
 * re-reads a warm store; and registration plus the store ride the plugin
 * fiber, so a reload withdraws all of them and refuses further work.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CaptureInjected, LibraryInjected } from '../src/client/contract.ts'
import { apply, inject } from '../src/client/index.ts'

afterEach(cleanup)

const sid = (k: string): SessionId => k as SessionId

/** Boot the plugin over a recording contentRemote double. */
async function bench() {
  const ctx = new Context()
  const calls: { method: string; args: unknown }[] = []
  const contentRemote = {
    status: (signal?: AbortSignal) => {
      calls.push({ method: 'status', args: { aborted: signal?.aborted } })
      return Promise.resolve({
        ok: true as const,
        value: { phase: 'ready', reason: null, limits: { bodyBytes: 1, entryBytes: 1, libraryBytes: 1 } },
      })
    },
    snapshot: (signal?: AbortSignal) => {
      calls.push({ method: 'snapshot', args: { aborted: signal?.aborted } })
      return Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [] } })
    },
    get: () => Promise.resolve({ ok: true as const, value: null }),
    capture: (input: { operationId: string; sessionId: string; messageId: string }, signal?: AbortSignal) => {
      calls.push({ method: 'capture', args: { ...input, aborted: signal?.aborted } })
      return Promise.resolve({
        ok: true as const,
        value: { operationId: input.operationId, entryId: 'source_x', entryRevision: 1, draftRevision: null, versionId: 'v1' },
      })
    },
  }
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.contentRemote', contentRemote)
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
      'shell.view': { kind: 'list', scope: 'root' },
      'sidebar.modules': { kind: 'list', scope: 'root' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  return {
    ctx,
    fiber,
    calls,
    entryOf: (name: 'conversation.chat.assistant-actions' | 'shell.view' | 'sidebar.modules') => {
      const entry = ctx.slots.entries(name)[0]!
      return {
        options: entry.options,
        locale: entry.locale,
        inject: entry.inject as unknown as
          ((sessionId: SessionId) => CaptureInjected | LibraryInjected) | undefined,
      }
    },
  }
}

describe('ui-content browser plugin', () => {
  it('registers the three slot entries with the documented ids and locale', async () => {
    const b = await bench()
    await b.fiber.await()

    expect(b.entryOf('conversation.chat.assistant-actions').options).toMatchObject({ id: 'capture', order: 12 })
    expect(b.entryOf('conversation.chat.assistant-actions').locale).toBe('content')
    expect(b.entryOf('shell.view').options).toMatchObject({ id: 'content-library' })
    expect(b.entryOf('shell.view').locale).toBe('content')
    expect(b.entryOf('sidebar.modules').options).toMatchObject({ id: 'content-library-module' })
    expect(b.entryOf('sidebar.modules').locale).toBe('content')
  })

  it('binds every entry to one shared store', async () => {
    const b = await bench()
    await b.fiber.await()

    const capture = b.entryOf('conversation.chat.assistant-actions').inject!(sid('s1')) as CaptureInjected
    const workspace = b.entryOf('shell.view').inject!(undefined as never) as LibraryInjected
    expect(capture.hooks.library).toBe(workspace.hooks.library)
    expect(capture.hooks.library.getSnapshot()).toMatchObject({ loadState: 'idle' })
  })

  it('routes a capture to the Remote with only the wire fields', async () => {
    const b = await bench()
    await b.fiber.await()

    const face = b.entryOf('conversation.chat.assistant-actions').inject!(sid('s1')) as CaptureInjected
    const outcome = await face.capture({ seq: 34, messageId: 'm-1' })
    expect(outcome).toMatchObject({ ok: true, entryId: 'source_x' })

    const capture = b.calls.find(call => call.method === 'capture')?.args as Record<string, unknown>
    expect(Object.keys(capture).sort()).toEqual(['aborted', 'messageId', 'operationId', 'sessionId'])
    expect(capture).toMatchObject({ sessionId: 's1', messageId: '34' })
    expect(String(capture.operationId)).toMatch(/^capture-ui:s1:34:/u)
  })

  it('re-reads a warm store on connection reset and leaves an idle one alone', async () => {
    const b = await bench()
    await b.fiber.await()

    const workspace = b.entryOf('shell.view').inject!(undefined as never) as LibraryInjected
    // The injected refresh is fire-and-forget; wait until the load settles.
    workspace.refresh()
    await vi.waitFor(() => { expect(workspace.hooks.library.getSnapshot().loadState).toBe('ready') })
    const before = b.calls.length

    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.calls.length).toBeGreaterThan(before) })

    const cold = await bench()
    await cold.fiber.await()
    const coldBefore = cold.calls.length
    cold.ctx.emit('connection/reset')
    await Promise.resolve()
    expect(cold.calls).toHaveLength(coldBefore)
  })

  it('withdraws the registrations and disposes the store with the plugin fiber', async () => {
    const b = await bench()
    await b.fiber.await()

    const face = b.entryOf('conversation.chat.assistant-actions').inject!(sid('s1')) as CaptureInjected
    await b.fiber.dispose()

    expect(b.ctx.slots.entries('conversation.chat.assistant-actions')).toHaveLength(0)
    expect(b.ctx.slots.entries('shell.view')).toHaveLength(0)
    expect(b.ctx.slots.entries('sidebar.modules')).toHaveLength(0)
    // The disposed store refuses further work, so no request outlives the fiber.
    const before = b.calls.length
    await expect(face.capture({ seq: 34, messageId: 'm-1' })).resolves.toMatchObject({
      ok: false, error: { code: 'disposed' },
    })
    expect(b.calls).toHaveLength(before)
  })
})

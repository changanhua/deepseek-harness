import { describe, expect, test, vi } from 'vitest'
import { createAssistantSessionSurfaces } from '../src/assistant-session-surfaces.js'

const installationId = '123e4567-e89b-42d3-a456-426614174000'
const connection = () => ({ baseUrl: 'https://dsh.test', phase: 'connected', grant: { installationId, scopes: ['session:interact'] } })
type SurfaceSession = {
  bind(sessionId: string): Promise<unknown>
  read(): { streamId: string | null; binding: { sessionId: string } | null; phase: string }
}
type SurfaceSessions = {
  session(surfaceId: string): SurfaceSession
  ready(surfaceId: string): Promise<SurfaceSession>
  onEvent(frame: unknown): Promise<void>
  release(surfaceId: string): Promise<void>
  dispose(): Promise<void>
}
const registry = (options: Record<string, unknown>) => createAssistantSessionSurfaces(options) as SurfaceSessions

describe('assistant surface Session registry', () => {
  test('restores one surface exactly once across concurrent readiness calls', async () => {
    const values: Record<string, unknown> = {}
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: structuredClone(values[key]) })),
      set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(values, structuredClone(patch)) }),
    }
    const surfaces = registry({ storage, call: vi.fn(), getConnection: connection })

    const [first, second] = await Promise.all([surfaces.ready('document-a'), surfaces.ready('document-a')])

    expect(first).toBe(second)
    expect(storage.get).toHaveBeenCalledTimes(1)
    await surfaces.dispose()
  })

  test('isolates binding, follow frames and durable state for concurrent surfaces', async () => {
    const values: Record<string, unknown> = {}
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: structuredClone(values[key]) })),
      set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(values, structuredClone(patch)) }),
    }
    const call = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'session.follow') return { streamId: params.streamId }
      throw new Error(`unexpected ${method}`)
    })
    const surfaces = registry({ storage, call, getConnection: connection })
    const first = surfaces.session('document-a')
    const second = surfaces.session('document-b')

    await first.bind('session-a')
    await second.bind('session-b')
    const firstStream = first.read().streamId
    const secondStream = second.read().streamId
    await surfaces.onEvent({ type: 'event', streamId: firstStream, event: {
      type: 'snapshot', header: { id: 'session-a', version: 1, createdAt: 1 }, records: [], cursor: -1,
      hasMore: false, projections: {}, assistantStream: { revision: 0 },
    } })

    expect(first.read()).toMatchObject({ binding: { sessionId: 'session-a' }, phase: 'live' })
    expect(second.read()).toMatchObject({ binding: { sessionId: 'session-b' }, phase: 'following', streamId: secondStream })
    expect(firstStream).not.toBe(secondStream)
    expect(values['dsh.assistant.session.v2.document-a']).toMatchObject({ binding: { sessionId: 'session-a' } })
    expect(values['dsh.assistant.session.v2.document-b']).toMatchObject({ binding: { sessionId: 'session-b' } })
    await surfaces.dispose()
  })

  test('releases only the closed surface and restores its persisted binding on reopen', async () => {
    const values: Record<string, unknown> = {}
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: structuredClone(values[key]) })),
      set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(values, structuredClone(patch)) }),
    }
    const call = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'session.follow') return { streamId: params.streamId }
      throw new Error(`unexpected ${method}`)
    })
    const surfaces = registry({ storage, call, getConnection: connection })
    const original = await surfaces.ready('document-a')
    await original.bind('session-a')

    await surfaces.release('document-a')
    expect(original.read().streamId).toBeNull()
    const reopened = await surfaces.ready('document-a')

    expect(reopened).not.toBe(original)
    expect(reopened.read()).toMatchObject({ binding: { sessionId: 'session-a' }, phase: 'following' })
    expect(call.mock.calls.filter(([method]) => method === 'session.follow')).toHaveLength(2)
    await surfaces.dispose()
  })
})

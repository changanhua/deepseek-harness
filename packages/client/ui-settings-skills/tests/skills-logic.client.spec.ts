import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { isOrdinary, ordinarySessionsOf, resolveTarget } from '../src/client/controller.ts'
import { createSkillsFeatureController } from '../src/client/skills-feature-store.ts'
import { createSkillsSnapshotController } from '../src/client/skills-snapshot.ts'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'

const S1 = 's1' as SessionId
const S2 = 's2' as SessionId
const SUB = 'sub' as SessionId

describe('ordinary session resolution', () => {
  it('classifies ordinary rows and excludes blank and subagent rows', () => {
    expect(isOrdinary({ id: S1 })).toBe(true)
    expect(isOrdinary({ id: S1, blank: false, origin: undefined })).toBe(true)
    expect(isOrdinary({ id: S1, blank: true })).toBe(false)
    expect(isOrdinary({ id: SUB, origin: 'subagent' })).toBe(false)
  })

  it('projects known ordinary ids and the current ordinary id', () => {
    const byId = {
      [String(S1)]: { id: S1, blank: false },
      [String(S2)]: { id: S2, blank: true },
      [String(SUB)]: { id: SUB, origin: 'subagent' as const },
    }
    const { known, currentOrdinary } = ordinarySessionsOf(byId, S2)
    expect([...known]).toEqual([S1])
    expect(currentOrdinary).toBeUndefined()
    expect(ordinarySessionsOf(byId, S1).currentOrdinary).toBe(S1)
  })
})

describe('resolveTarget (§3.4 fallback ladder)', () => {
  it('keeps an adopted session while it still exists', () => {
    expect(resolveTarget(S1, new Set([S1, S2]), S2)).toEqual({ mode: 'explicit', sessionId: S1 })
  })

  it('falls back to the current ordinary session when the adopted one disappears', () => {
    expect(resolveTarget(S1, new Set([S2]), S2)).toEqual({ mode: 'following', sessionId: S2 })
  })

  it('returns none when no ordinary session remains', () => {
    expect(resolveTarget(S1, new Set(), undefined)).toEqual({ mode: 'none' })
    expect(resolveTarget(undefined, new Set(), undefined)).toEqual({ mode: 'none' })
  })

  it('follows the current ordinary session when nothing is adopted', () => {
    expect(resolveTarget(undefined, new Set([S1]), S1)).toEqual({ mode: 'following', sessionId: S1 })
  })
})

describe('SkillsFeatureController', () => {
  it('adopts and follows through the observable source', () => {
    const feature = createSkillsFeatureController()
    const listener = vi.fn()
    feature.source.subscribe(listener)
    expect(feature.source.getSnapshot().adopted).toBeUndefined()
    feature.adopt(S1)
    expect(feature.source.getSnapshot().adopted).toBe(S1)
    feature.followCurrent()
    expect(feature.source.getSnapshot().adopted).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('SkillsSnapshotController', () => {
  const value = {
    sessionId: S1,
    fidelity: 'live' as const,
    complete: true,
    entries: [],
    diagnostics: [],
  }

  it('loads a snapshot and publishes it through the observable source', async () => {
    const api = { skillManagement: { snapshot: vi.fn(async () => ({ rpcId: 'r', result: { ok: true, value } })) } } as unknown as Pick<IApiClient, 'skillManagement'>
    const controller = createSkillsSnapshotController(api)
    const listener = vi.fn()
    controller.source.subscribe(listener)
    controller.load(S1)
    await vi.waitFor(() => expect(controller.source.getSnapshot().status).toBe('ready'))
    expect(listener).toHaveBeenCalled()
    expect(controller.source.getSnapshot()).toMatchObject({ status: 'ready', sessionId: S1, snapshot: value })
  })

  it('keeps last-good snapshot and surfaces an error on a failed refresh', async () => {
    const api = { skillManagement: { snapshot: vi.fn(async () => ({ rpcId: 'r', result: { ok: false, error: { code: 'internal', message: 'boom', details: {} } } })) } } as unknown as Pick<IApiClient, 'skillManagement'>
    const controller = createSkillsSnapshotController(api)
    controller.load(S1)
    await vi.waitFor(() => expect(controller.source.getSnapshot().status).toBe('error'))
    expect(controller.source.getSnapshot().error).toContain('boom')
  })

  it('retry re-uses the addressed session and reset clears the slot', async () => {
    const api = { skillManagement: { snapshot: vi.fn(async () => ({ rpcId: 'r', result: { ok: true, value } })) } } as unknown as Pick<IApiClient, 'skillManagement'>
    const controller = createSkillsSnapshotController(api)
    controller.load(S1)
    await vi.waitFor(() => expect(controller.source.getSnapshot().status).toBe('ready'))
    controller.reset()
    expect(controller.source.getSnapshot().sessionId).toBeUndefined()
    controller.load(S2)
    await vi.waitFor(() => expect(controller.source.getSnapshot().sessionId).toBe(S2))
    controller.retry()
    expect(api.skillManagement.snapshot).toHaveBeenLastCalledWith({ sessionId: S2 })
  })

  it('an older response never overwrites a newer addressing slot', async () => {
    const resolvers: Array<(response: unknown) => void> = []
    const api = { skillManagement: { snapshot: vi.fn(() => new Promise((resolve) => { resolvers.push(resolve) })) } } as unknown as Pick<IApiClient, 'skillManagement'>
    const controller = createSkillsSnapshotController(api)
    controller.load(S1)
    controller.load(S2)
    expect(api.skillManagement.snapshot).toHaveBeenCalledTimes(2)
    // The first response lands after the second load superseded it: it must not
    // publish, because the slot belongs to S2 now.
    resolvers[0]!({ rpcId: 'r', result: { ok: true, value } })
    resolvers[1]!({ rpcId: 'r', result: { ok: true, value } })
    await vi.waitFor(() => expect(controller.source.getSnapshot().status).toBe('ready'))
    expect(controller.source.getSnapshot().sessionId).toBe(S2)
  })
})

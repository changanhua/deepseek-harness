import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { readFcSbcMain } from '../../../../apps/chrome-extension/src/fc-sbc-main-read.js'
import { load } from './harness.ts'
import { fixture } from './fixture.ts'
import type { FcSbcRealitySnapshot } from '../src/index.ts'

it('compiles an actual existing MAIN reader result with external reads mocked and every write boundary forbidden', async () => {
  const writes = { browser: vi.fn(), purchase: vi.fn(), fill: vi.fn(), submit: vi.fn(), planning: vi.fn(), safety: vi.fn() }
  const forbidden = () => { throw new Error('real external work is forbidden') }
  Object.values(writes).forEach(fn => fn.mockImplementation(forbidden))
  const network = vi.fn(forbidden)
  vi.stubGlobal('fetch', network)
  vi.stubGlobal('UTBucketedItemSearchViewModel', class { searchCriteria = {} })
  vi.stubGlobal('UTSearchCriteriaDTO', class { offset = 0 })
  vi.stubGlobal('services', {
    User: { platform: 'pc' },
    SBC: { requestSets: async () => ({ sets: [{ id: 'raw-set', name: 'Raw fixture' }] }),
      requestChallengesForSet: async () => ({ challenges: [{ id: 'raw-challenge', name: 'Raw challenge', slotCount: 2,
        requirements: [{ type: 'quality', minimum: 2, values: ['gold'] }], rewards: [{ name: 'fixture reward' }] }] }),
      loadChallenge: async () => { throw new Error('complete local requirement rows should not load again') }, submit: writes.submit,
      fillSquad: writes.fill },
    Club: { search: async () => ({ items: ['raw-one', 'raw-two'].map(id => ({ id, resourceId: `v-${id}`, rating: 78, isPlayer: true,
      quality: 'gold', locked: false })), retrievedAll: true }) },
    Item: { searchStorageItems: async () => ({ items: [], retrievedAll: true }) },
    Market: { purchase: writes.purchase }, Browser: { write: writes.browser }, Planning: { mutate: writes.planning },
    Safety: { execute: writes.safety },
  })
  const root = await mkdtemp(join(tmpdir(), 'fc-raw-fixture-'))
  let ctx: Awaited<ReturnType<typeof load>> | undefined
  try {
    const input = fixture()
    const read = await readFcSbcMain({ href: input.page.url, capturedAt: input.probe!.capturedAt })
    ctx = await load(root)
    const ref = await ctx.fcSbcDomain.captureReality({ ...input, read: structuredClone(read) as typeof input.read,
      requestId: 'actual-reader' })
    const snapshot = (await ctx.fcSbcDomain.readArtifact(ref))!.payload as FcSbcRealitySnapshot
    expect(snapshot.inventory.status).toBe('complete')
    expect(snapshot.inventory.cards.map(row => row.instanceId)).toEqual(['raw-one', 'raw-two'])
    const plan = await ctx.fcSbcDomain.buildPlan({ requestId: 'actual-reader-plan', realityRef: ref })
    expect(plan.kind).toBe('sbc-plan')
    for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled()
    expect(network).not.toHaveBeenCalled()
  } finally { await ctx?.fiber.dispose(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }) }
})

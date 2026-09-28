import { describe, expect, it } from 'vitest'
import { contractReadiness, ContractRevisionId } from '@changanhua/dsh-delivery-protocol'
import { bootPlanningBundle } from './harness.ts'

describe('personal planning execution overlay', () => {
  it('loads the real bridge overlay and preserves one shaping Case across restart', async () => {
    const first = await bootPlanningBundle(true)
    const worlds = [first]
    const signal = new AbortController().signal
    try {
      const created = await first.remote.execute({ workspaceId: first.workspaceId, command: first.create('execution-source') }, signal)
      const input = { workspaceId: first.workspaceId, itemId: created.itemId!, expectedRevisionId: created.revisionId! }
      const linked = await first.remote.handoff(input, signal)
      expect(linked.phase).toBe('linked')
      const delivery = first.ctx.get('delivery')!
      expect(contractReadiness(delivery.getContractRevision(ContractRevisionId(linked.contractRevisionId!))!).ready).toBe(false)
      expect(delivery.snapshot().dispatchBindings).toHaveLength(0)
      expect(linked.source.sources).toMatchObject([{ kind: 'manual', text: 'operator note' }])
      await first.close()
      const second = await first.reopen(); worlds.push(second)
      await expect(second.remote.handoff(input, signal)).resolves.toEqual(linked)
      expect(second.ctx.get('delivery')!.snapshot().deliveryCases).toHaveLength(1)
      expect((await second.remote.snapshot(second.workspaceId, signal)).handoffs).toEqual([linked])
    } finally {
      await Promise.all(worlds.map(world => world.close()))
      await first.dispose()
    }
  })
})

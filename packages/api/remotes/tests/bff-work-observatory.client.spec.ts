/** BFF assembly fixture for the Work Observatory Remote namespace. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import workObservatoryRemote from '@deepseek-ai/dsh-host-work-observatory/remote'
import type {
  ClientObservation,
  ClientObservationAck,
  ClientRemote,
  WorkInterval,
  WorkObservatoryRange,
  WorkObservatoryRangeRequest,
} from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '../src/client/index.ts'

/**
 * Compile-time contract: the BFF surface exposes the `workObservatory` namespace.
 * A business Client package reaches the Remote through this assembly alone, never
 * through the Host runtime; this function must type-check against `ClientRemote`.
 * @param remote - the BFF Client Remote surface.
 */
function bffNamespaceContract(remote: ClientRemote): void {
  void remote.workObservatory.observeClient
  void remote.workObservatory.range
}
void bffNamespaceContract

describe('Work Observatory BFF assembly', () => {
  it('mounts the generated workObservatory Remote through the Client assembly', async () => {
    const ctx = new Context()
    const mounted: unknown[] = []
    ctx.provide('remote', {
      $mount: vi.fn(async (contribution: unknown) => {
        mounted.push(contribution)
        return () => undefined
      }),
    } as never)
    const client = ctx.plugin({ inject, apply })
    await client

    const contributions = mounted as Array<{
      package: string
      descriptors: Array<{ id: string }>
    }>
    const workObservatory = contributions.find(
      contribution => contribution.package === '@deepseek-ai/dsh-host-work-observatory',
    )
    expect(workObservatory).toBeDefined()
    expect(workObservatory?.descriptors.map(descriptor => descriptor.id)).toEqual([
      '@deepseek-ai/dsh-host-work-observatory#workObservatory/observeClient',
      '@deepseek-ai/dsh-host-work-observatory#workObservatory/range',
    ])
    // The mounted contribution is the owner package's generated Remote, not a re-declaration.
    expect(mounted).toContain(workObservatoryRemote)

    await ctx.fiber.dispose()
  })

  it('re-exports Work Observatory payload vocabulary from the BFF assembly', () => {
    const observation: ClientObservation = {
      clientId: 'bff-fixture',
      seq: 0,
      visible: true,
      active: true,
      clientObservedAt: 1,
    }
    const ack: ClientObservationAck = { accepted: true }
    const request: WorkObservatoryRangeRequest = { from: 0, to: 10 }
    const result: WorkObservatoryRange = {
      from: 0,
      to: 10,
      summary: { humanActiveMs: 0, pageVisibleMs: 0, agentRunningMs: 0, agentSoloMs: 0, togetherMs: 0 },
      timeline: { humanActive: [], pageVisible: [], agentRunning: [] },
    }
    const interval: WorkInterval = { start: 0, end: 10 }

    expect(ack.accepted).toBe(true)
    expect(request.to).toBe(10)
    expect(result.summary.agentRunningMs).toBe(0)
    expect(interval.end - interval.start).toBe(10)
    expect(observation.clientId).toBe('bff-fixture')
  })
})

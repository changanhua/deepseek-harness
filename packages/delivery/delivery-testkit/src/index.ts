/** Deterministic fake providers and Protocol fixtures for Delivery Consumers. */

import { type Context, type Fiber } from '@deepseek-ai/cordis'
import { FakeDelivery, type FakeDeliveryOptions } from './fake-delivery.ts'
import { FakeDeliveryEvidence, type FakeDeliveryEvidenceOptions } from './fake-evidence.ts'
import { FakeRepositoryWorkspace } from './fake-repo-workspace.ts'

export * from './fake-delivery.ts'
export * from './fake-evidence.ts'
export * from './fake-repo-workspace.ts'
export * from './fixtures.ts'

/** Configuration hooks for deterministic clocks, ids, and evidence publication. */
export interface DeliveryTestkitOptions {
  readonly delivery?: FakeDeliveryOptions
  readonly evidence?: FakeDeliveryEvidenceOptions
}

/** Mounted fake services plus one reverse-order lifecycle disposer. */
export interface MountedDeliveryTestkit {
  readonly delivery: FakeDelivery
  readonly repoWorkspace: FakeRepositoryWorkspace
  readonly deliveryEvidence: FakeDeliveryEvidence
  dispose(): Promise<void>
}

/**
 * Mount all three fake Service Providers and prove their concrete identities.
 * @param ctx - Cordis context that owns the fake services.
 * @param options - Optional deterministic clock and id hooks.
 * @returns concrete fakes and an awaited reverse-order disposer.
 */
export async function mountDeliveryTestkit(
  ctx: Context,
  options: DeliveryTestkitOptions = {},
): Promise<MountedDeliveryTestkit> {
  const fibers: Fiber[] = []
  let repoWorkspace: FakeRepositoryWorkspace | undefined
  let delivery: FakeDelivery | undefined
  let deliveryEvidence: FakeDeliveryEvidence | undefined
  try {
    fibers.push(await ctx.plugin((inner: Context) => {
      repoWorkspace = new FakeRepositoryWorkspace(inner)
    }))
    fibers.push(await ctx.plugin((inner: Context) => {
      delivery = new FakeDelivery(inner, options.delivery)
    }))
    fibers.push(await ctx.plugin((inner: Context) => {
      deliveryEvidence = new FakeDeliveryEvidence(inner, options.evidence)
    }))

    if (!(repoWorkspace instanceof FakeRepositoryWorkspace)) {
      throw new TypeError('delivery-testkit: FakeRepositoryWorkspace did not register its concrete provider')
    }
    if (!(delivery instanceof FakeDelivery)) {
      throw new TypeError('delivery-testkit: FakeDelivery did not register its concrete provider')
    }
    if (!(deliveryEvidence instanceof FakeDeliveryEvidence)) {
      throw new TypeError('delivery-testkit: FakeDeliveryEvidence did not register its concrete provider')
    }

    let disposed = false
    return {
      repoWorkspace,
      delivery,
      deliveryEvidence,
      async dispose() {
        if (disposed) return
        disposed = true
        for (const fiber of fibers.toReversed()) await fiber.dispose()
      },
    }
  } catch (error) {
    for (const fiber of fibers.toReversed()) await fiber.dispose().catch(() => undefined)
    throw error
  }
}

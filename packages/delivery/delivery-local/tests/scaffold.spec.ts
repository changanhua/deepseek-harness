import { describe, expect, it, vi } from 'vitest'
import type {
  CreateWorkPacketRequest,
  RecordAcceptanceDecisionRequest,
} from '@deepseek-ai/dsh-delivery'
import { LocalDelivery } from '../src/index.ts'

function scaffold(): LocalDelivery {
  return Object.create(LocalDelivery.prototype) as LocalDelivery
}

describe('local Delivery unavailable boundary', () => {
  it('rejects every durable operation with the stable unavailable classification', async () => {
    const delivery = scaffold()
    const calls = [
      delivery.adoptContractRevision({} as never),
      delivery.beginDispatch({} as never),
      delivery.bindDispatch({} as never),
    ]

    for (const call of calls) {
      await expect(call).rejects.toMatchObject({
        code: 'unavailable',
        name: 'DeliveryError',
      })
    }
    for (const read of [
      () => delivery.getContractRevision('contract-1' as never),
      () => delivery.getWorkPacket('packet-1' as never),
      () => delivery.getDispatchBinding('binding-1' as never),
      () => delivery.snapshot(),
    ]) {
      expect(read).toThrow(expect.objectContaining({
        code: 'unavailable',
        name: 'DeliveryError',
      }))
    }
  })

  it('preserves Packet verification-source authority without invoking it', async () => {
    const resolveVerificationSource = vi.fn()
    await expect(scaffold().createWorkPacket(
      {} as CreateWorkPacketRequest,
      resolveVerificationSource,
    )).rejects.toMatchObject({ code: 'unavailable' })
    expect(resolveVerificationSource).not.toHaveBeenCalled()
  })

  it('preserves both acceptance authority callbacks without invoking them', async () => {
    const resolveCandidate = vi.fn()
    const resolveEvidence = vi.fn()
    await expect(scaffold().recordAcceptanceDecision(
      {} as RecordAcceptanceDecisionRequest,
      resolveCandidate,
      resolveEvidence,
    )).rejects.toMatchObject({ code: 'unavailable' })
    expect(resolveCandidate).not.toHaveBeenCalled()
    expect(resolveEvidence).not.toHaveBeenCalled()
  })
})

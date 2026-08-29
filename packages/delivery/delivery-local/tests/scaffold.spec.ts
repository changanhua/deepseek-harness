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

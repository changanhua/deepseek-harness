import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  Config,
  LocalDeliveryEvidence,
} from '../src/index.ts'

function scaffold(): LocalDeliveryEvidence {
  return Object.create(LocalDeliveryEvidence.prototype) as LocalDeliveryEvidence
}

describe('local Delivery evidence unavailable boundary', () => {
  it('requires a non-empty storage root', () => {
    expect(Config({ root: 'evidence' })).toEqual({ root: 'evidence' })
    expect(() => Config({} as never)).toThrow()
  })

  it('constructs the provider without touching the configured root', () => {
    const ctx = new Context()
    expect(new LocalDeliveryEvidence(ctx, { root: 'evidence' }))
      .toBeInstanceOf(LocalDeliveryEvidence)
  })

  it('rejects every storage operation without publishing evidence', async () => {
    const evidence = scaffold()
    const calls = [
      evidence.save({} as never),
      evidence.resolve('evidence-1' as never),
      evidence.read({} as never),
    ]

    for (const call of calls) {
      await expect(call).rejects.toMatchObject({
        code: 'unavailable',
        name: 'DeliveryEvidenceError',
      })
    }
  })
})

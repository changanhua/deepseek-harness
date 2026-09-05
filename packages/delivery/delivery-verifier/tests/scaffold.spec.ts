import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { CompletionClaim } from '@changanhua/dsh-delivery-protocol'
import {
  DeliveryVerifierError,
  MAX_VERIFICATION_OUTPUT_BYTES,
  createDeliveryVerifier,
} from '../src/index.ts'
import type { DeliveryVerificationRunRequest } from '../src/index.ts'
import type { CompletedChangeClaim } from '../src/index.ts'

describe('delivery verifier public boundary', () => {
  it('accepts only completed claims at the public request boundary', () => {
    expectTypeOf<DeliveryVerificationRunRequest['completionClaim']>()
      .toEqualTypeOf<Extract<
      CompletionClaim,
      { readonly disposition: 'completed' }
    >>()
    expectTypeOf<CompletedChangeClaim>()
      .toEqualTypeOf<DeliveryVerificationRunRequest['completionClaim']>()
  })

  it('rejects blank identities and unsafe process-output budgets', () => {
    const valid = {
      subprocess: { spawn: vi.fn() },
      verifierVersion: 'delivery-verifier@1',
      disposeGraceMs: 5_000,
      verificationOutputBytes: 64 * 1024,
    }

    expect(() => createDeliveryVerifier({
      ...valid,
      verifierVersion: '  ',
    })).toThrow(expect.objectContaining({ code: 'configuration' }))
    for (const disposeGraceMs of [0, 1.5, 2_147_483_648]) {
      expect(() => createDeliveryVerifier({
        ...valid,
        disposeGraceMs,
      })).toThrow(expect.objectContaining({ code: 'configuration' }))
    }
    for (const verificationOutputBytes of [
      0,
      1.5,
      MAX_VERIFICATION_OUTPUT_BYTES + 1,
    ]) {
      expect(() => createDeliveryVerifier({
        ...valid,
        verificationOutputBytes,
      })).toThrow(expect.objectContaining({ code: 'configuration' }))
    }
    expect(new DeliveryVerifierError('execution', 'x').code)
      .toBe('execution')
  })
})

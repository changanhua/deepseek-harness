import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { CompletionClaim } from '@deepseek-ai/dsh-delivery-protocol'
import {
  DeliveryVerifierError,
  MAX_VERIFICATION_OUTPUT_BYTES,
  createDeliveryVerifier,
} from '../src/index.ts'
import type { DeliveryVerificationRunRequest } from '../src/index.ts'
import type { CompletedChangeClaim } from '../src/index.ts'

describe('delivery verifier unavailable boundary', () => {
  it('accepts only completed claims at the public request boundary', () => {
    expectTypeOf<DeliveryVerificationRunRequest['completionClaim']>()
      .toEqualTypeOf<Extract<
      CompletionClaim,
      { readonly disposition: 'completed' }
    >>()
    expectTypeOf<CompletedChangeClaim>()
      .toEqualTypeOf<DeliveryVerificationRunRequest['completionClaim']>()
  })

  it('publishes typed unavailable settlement without invoking subprocess', async () => {
    const spawn = vi.fn(() => {
      throw new Error('must not spawn')
    })
    const start = createDeliveryVerifier({
      subprocess: { spawn },
      verifierVersion: 'delivery-verifier@1',
      disposeGraceMs: 5_000,
      verificationOutputBytes: 64 * 1024,
    })

    const run = start(
      {} as DeliveryVerificationRunRequest,
      new AbortController().signal,
    )

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'unavailable',
      name: 'DeliveryVerifierError',
    }))
    await expect(run.cancel('operator canceled')).resolves.toBeUndefined()
    expect(spawn).not.toHaveBeenCalled()
    expect(new DeliveryVerifierError('unavailable', 'x').code)
      .toBe('unavailable')
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
  })
})

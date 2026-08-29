import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type {
  QueueAttemptIdRef,
  QueueWorkIdRef,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  DeliveryCodexRunnerError,
  MAX_MODEL_OUTPUT_BYTES,
  createCodexChangeRunner,
} from '../src/index.ts'
import type { CodeChangeRunRequest } from '../src/index.ts'

describe('delivery Codex runner unavailable boundary', () => {
  it('requires both Queue identities in every operation-local request', () => {
    expectTypeOf<CodeChangeRunRequest['queueWorkId']>()
      .toEqualTypeOf<QueueWorkIdRef>()
    expectTypeOf<CodeChangeRunRequest['queueAttemptId']>()
      .toEqualTypeOf<QueueAttemptIdRef>()
  })

  it('publishes typed unavailable settlement without invoking subprocess', async () => {
    const spawn = vi.fn(() => {
      throw new Error('must not spawn')
    })
    const start = createCodexChangeRunner({
      spawn,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })

    const run = start(
      {} as CodeChangeRunRequest,
      new AbortController().signal,
    )

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'unavailable',
      name: 'DeliveryCodexRunnerError',
    }))
    await expect(run.cancel('operator canceled')).resolves.toBeUndefined()
    expect(spawn).not.toHaveBeenCalled()
    expect(new DeliveryCodexRunnerError('unavailable', 'x').code)
      .toBe('unavailable')
  })

  it('rejects timer and model-output budgets outside the frozen safe range', () => {
    const spawn = vi.fn()
    const valid = {
      spawn,
      permissionMode: 'never' as const,
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    }

    for (const disposeGraceMs of [0, 1.5, 2_147_483_648]) {
      expect(() => createCodexChangeRunner({
        ...valid,
        disposeGraceMs,
      })).toThrow(expect.objectContaining({ code: 'configuration' }))
    }
    for (const modelOutputBytes of [0, 1.5, MAX_MODEL_OUTPUT_BYTES + 1]) {
      expect(() => createCodexChangeRunner({
        ...valid,
        modelOutputBytes,
      })).toThrow(expect.objectContaining({ code: 'configuration' }))
    }
  })
})

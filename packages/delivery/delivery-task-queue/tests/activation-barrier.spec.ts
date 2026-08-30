import { describe, expect, it, vi } from 'vitest'
import type { WorkHandler } from '@deepseek-ai/dsh-task-queue'
import {
  activationGatedHandler,
  createActivationBarrier,
} from '../src/activation.ts'

function handler(): WorkHandler<never> {
  return {
    kind: 'barrier-test@1' as never,
    async resolveAdmission(input) { return input },
    resources() { return [{ resource: 'barrier', units: 1 }] },
    policy() { return { maxAttempts: 1 } },
    async prepare(resolved) { return resolved },
    start() {
      return {
        done: Promise.resolve({
          status: 'failed',
          failure: {
            category: 'fixture',
            sideEffect: 'not-started',
            retriable: false,
            message: 'fixture',
          },
        }),
        cancel: vi.fn(),
      }
    },
  }
}

describe('Delivery Queue activation barrier', () => {
  it('passes admission metadata but blocks preparation and start until open', async () => {
    const barrier = createActivationBarrier()
    const source = handler()
    const gated = activationGatedHandler(source, barrier)
    const signal = new AbortController().signal

    await expect(gated.resolveAdmission({ admitted: true }, { signal }))
      .resolves.toEqual({ admitted: true })
    expect(gated.resources({})).toEqual([
      { resource: 'barrier', units: 1 },
    ])
    expect(gated.policy({})).toEqual({ maxAttempts: 1 })
    expect(() => gated.start({}, {
      attemptId: 'barrier-attempt' as never,
      signal,
    })).toThrow(/before activation opens/)

    const prepared = gated.prepare({ prepared: true }, {
      attemptId: 'barrier-attempt' as never,
      signal,
    })
    barrier.open()
    barrier.open()
    await expect(prepared).resolves.toEqual({ prepared: true })
    expect(gated.start({}, {
      attemptId: 'barrier-attempt' as never,
      signal,
    }).done).toBeInstanceOf(Promise)
  })

  it('rejects pending and already-aborted preparation without entering the handler', async () => {
    const source = handler()
    const prepare = vi.spyOn(source, 'prepare')
    const failed = createActivationBarrier()
    const gated = activationGatedHandler(source, failed)
    const pending = gated.prepare({}, {
      attemptId: 'barrier-attempt' as never,
      signal: new AbortController().signal,
    })
    failed.fail(new Error('reconciliation failed'))
    failed.fail(new Error('duplicate failure'))
    await expect(pending).rejects.toThrow(/activation did not complete/)

    const aborted = new AbortController()
    aborted.abort()
    await expect(activationGatedHandler(
      source,
      createActivationBarrier(),
    ).prepare({}, {
      attemptId: 'barrier-attempt' as never,
      signal: aborted.signal,
    })).rejects.toThrow(/wait was aborted/)
    expect(prepare).not.toHaveBeenCalled()
  })
})

import type {
  WorkHandler,
  WorkKind,
} from '@deepseek-ai/dsh-task-queue'

interface ActivationBarrier {
  wait(signal: AbortSignal): Promise<void>
  assertOpen(): void
  open(): void
  fail(cause: unknown): void
}

/** Keep recovered Work admission available without permitting execution. */
export function createActivationBarrier(): ActivationBarrier {
  const ready = Promise.withResolvers<void>()
  void ready.promise.catch(() => undefined)
  let state: 'pending' | 'open' | 'failed' = 'pending'
  return {
    async wait(signal) {
      if (signal.aborted) throw new Error('Delivery Queue activation wait was aborted')
      await ready.promise
    },
    assertOpen() {
      if (state !== 'open') {
        throw new Error('Delivery Queue handler cannot start before activation opens')
      }
    },
    open() {
      if (state !== 'pending') return
      state = 'open'
      ready.resolve()
    },
    fail(cause) {
      if (state !== 'pending') return
      state = 'failed'
      ready.reject(new Error('Delivery Queue activation did not complete', {
        cause,
      }))
    },
  }
}

/** Gate only execution preparation/start; recovery admission remains callable. */
export function activationGatedHandler<K extends WorkKind>(
  handler: WorkHandler<K>,
  barrier: ActivationBarrier,
): WorkHandler<K> {
  return {
    kind: handler.kind,
    resolveAdmission: (input, context) =>
      handler.resolveAdmission(input, context),
    resources: resolved => handler.resources(resolved),
    policy: resolved => handler.policy(resolved),
    async prepare(resolved, context) {
      await barrier.wait(context.signal)
      return handler.prepare(resolved, context)
    },
    start(prepared, context) {
      barrier.assertOpen()
      return handler.start(prepared, context)
    },
  }
}

import type Delivery from '@changanhua/dsh-delivery'
import {
  CODE_CHANGE_KIND,
  CODE_VERIFY_KIND,
  QueueWorkIdRef,
  canonicalDigest,
  codeChangeIntentSchema,
  codeVerifyIntentSchema,
} from '@changanhua/dsh-delivery-protocol'
import type { DispatchBinding } from '@changanhua/dsh-delivery-protocol'
import type { OperatorWorkQueue } from '@changanhua/dsh-task-queue'
import { exactBoundQueueView } from './validation.ts'

function invalid(message: string, cause?: unknown): Error {
  return new Error(
    message,
    cause === undefined ? undefined : { cause },
  )
}

function validateBoundViews(
  bindings: readonly DispatchBinding[],
  operator: Pick<OperatorWorkQueue, 'list' | 'get'>,
): void {
  for (const binding of bindings) {
    if (binding.phase !== 'bound') continue
    try {
      exactBoundQueueView(operator, binding)
    } catch (cause) {
      const suffix = cause instanceof Error
        ? ''
        : '; exact validation rejected with a non-Error value'
      throw invalid(
        `Delivery bound dispatch has no exact Queue Work view${suffix}`,
        cause,
      )
    }
  }
}

function changeIntent(binding: Extract<DispatchBinding, {
  readonly kind: typeof CODE_CHANGE_KIND
}>) {
  const intent = codeChangeIntentSchema.parse({ packetId: binding.packetId })
  const expectedKey = `delivery:${binding.packetId}:${CODE_CHANGE_KIND}`
  if (
    binding.idempotencyKey !== expectedKey
    || canonicalDigest(intent) !== binding.inputDigest
  ) {
    throw invalid(
      'Delivery change binding cannot reconstruct its exact canonical Queue intent and identity',
    )
  }
  return intent
}

function verificationIntent(binding: Extract<DispatchBinding, {
  readonly kind: typeof CODE_VERIFY_KIND
}>) {
  const prefix = `delivery:${binding.packetId}:${CODE_VERIFY_KIND}:`
  if (!binding.idempotencyKey.startsWith(prefix)) {
    throw invalid(
      'Delivery verification binding has a non-canonical idempotency key',
    )
  }
  const encoded = binding.idempotencyKey.slice(prefix.length)
  const identity = /^([0-9a-f]{40}|[0-9a-f]{64}):(sha256:[0-9a-f]{64})$/u
    .exec(encoded)
  const targetCommit = identity?.[1]
  const verificationPlanDigest = identity?.[2]
  const parsed = codeVerifyIntentSchema.safeParse({
    packetId: binding.packetId,
    targetCommit,
    verificationPlanDigest,
  })
  if (
    !parsed.success
    || canonicalDigest(parsed.data) !== binding.inputDigest
    || binding.idempotencyKey !== `${prefix}${parsed.data.targetCommit}:${parsed.data.verificationPlanDigest}`
  ) {
    throw invalid(
      'Delivery verification binding cannot reconstruct its exact Queue intent',
    )
  }
  return parsed.data
}

/**
 * Validate bound Queue views and resume every persisted submitting handshake.
 * @param bindings - Complete durable Delivery binding snapshot.
 * @param operator - Trusted Queue admission and view capabilities.
 * @param delivery - Delivery capability that conditionally binds recovered Work ids.
 * @returns A promise that resolves after every binding validates or converges.
 */
export async function reconcileDeliveryQueueBindings(
  bindings: readonly DispatchBinding[],
  operator: Pick<OperatorWorkQueue, 'enqueue' | 'list' | 'get'>,
  delivery: Pick<Delivery, 'bindDispatch'>,
): Promise<void> {
  validateBoundViews(bindings, operator)
  for (const binding of bindings) {
    if (binding.phase !== 'submitting') continue
    const input = binding.kind === CODE_CHANGE_KIND
      ? changeIntent(binding)
      : verificationIntent(binding)
    const verificationTarget = binding.kind === CODE_VERIFY_KIND
      ? verificationIntent(binding).targetCommit
      : undefined
    const workId = await operator.enqueue({
      kind: binding.kind,
      title: binding.kind === CODE_CHANGE_KIND
        ? `Change code for Delivery Packet ${binding.packetId}`
        : `Verify Delivery Packet ${binding.packetId} at ${verificationTarget}`,
      input,
      idempotencyKey: binding.idempotencyKey,
    })
    await delivery.bindDispatch({
      bindingId: binding.id,
      queueWorkId: QueueWorkIdRef(String(workId)),
    })
  }
}

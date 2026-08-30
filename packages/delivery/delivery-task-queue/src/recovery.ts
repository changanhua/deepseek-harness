import type Delivery from '@deepseek-ai/dsh-delivery'
import {
  CODE_CHANGE_KIND,
  CODE_VERIFY_KIND,
  QueueWorkIdRef,
  canonicalDigest,
  codeChangeIntentSchema,
  codeVerifyIntentSchema,
} from '@deepseek-ai/dsh-delivery-protocol'
import type { DispatchBinding } from '@deepseek-ai/dsh-delivery-protocol'
import { WorkId } from '@deepseek-ai/dsh-task-queue'
import type { OperatorWorkQueue, WorkView } from '@deepseek-ai/dsh-task-queue'

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
  operator.list()
  for (const binding of bindings) {
    if (binding.phase !== 'bound') continue
    let view: WorkView
    try {
      view = operator.get(WorkId(String(binding.queueWorkId)))
    } catch (cause) {
      throw invalid('Delivery bound dispatch has no exact Queue Work view', cause)
    }
    if (
      view.work.id !== WorkId(String(binding.queueWorkId))
      || view.work.kind !== binding.kind
      || view.work.intentDigest !== binding.inputDigest
    ) {
      throw invalid(
        'Delivery bound dispatch points to a malformed Queue Work view',
      )
    }
  }
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
  const targetCommit = encoded.slice(0, 40)
  const separator = encoded.slice(40, 41)
  const verificationPlanDigest = encoded.slice(41)
  const parsed = codeVerifyIntentSchema.safeParse({
    packetId: binding.packetId,
    targetCommit,
    verificationPlanDigest,
  })
  if (
    separator !== ':'
    || !parsed.success
    || canonicalDigest(parsed.data) !== binding.inputDigest
  ) {
    throw invalid(
      'Delivery verification binding cannot reconstruct its exact Queue intent',
    )
  }
  return parsed.data
}

/** Validate bound Queue views and resume every persisted submitting handshake. */
export async function reconcileDeliveryQueueBindings(
  bindings: readonly DispatchBinding[],
  operator: Pick<OperatorWorkQueue, 'enqueue' | 'list' | 'get'>,
  delivery: Pick<Delivery, 'bindDispatch'>,
): Promise<void> {
  validateBoundViews(bindings, operator)
  for (const binding of bindings) {
    if (binding.phase !== 'submitting') continue
    const input = binding.kind === CODE_CHANGE_KIND
      ? codeChangeIntentSchema.parse({ packetId: binding.packetId })
      : verificationIntent(binding)
    const verificationTarget = binding.kind === CODE_VERIFY_KIND
      ? verificationIntent(binding).targetCommit
      : undefined
    if (canonicalDigest(input) !== binding.inputDigest) {
      throw invalid(
        'Delivery submitting binding does not match its canonical Queue intent',
      )
    }
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

import { Context, Service } from '@deepseek-ai/cordis'

/** Host-bound authority; no caller can recreate this object from a wire payload. */
export interface EvalActivationAccess {
  readonly actorId: string
  readonly workspaceId: string
  authorize(): void | Promise<void>
}

/** One human-approved, single-use continuation grant. Its approval is never inferred from a Queue notification. */
export interface EvalActivationGrant {
  readonly id: string
  readonly actorId: string
  readonly workspaceId: string
  readonly sessionId: string
  readonly goal: { readonly id: string; readonly revision: number }
  readonly decisionDigest: string
  /** A retained Gate decision, re-read by the trusted Host immediately before dispatch. */
  readonly gateId: string
  /** Exact immutable Budget reference issued by the Budget owner. */
  readonly budgetRef: { readonly id: string; readonly version: '1'; readonly digest: string }
  readonly expiresAt: number
  readonly maxActivations: 1
}

/** Host-observed terminal cell facts selected for one continuation. */
export interface EvalActivationRequest {
  readonly idempotencyKey: string
  readonly grant: EvalActivationGrant
  readonly work: { readonly id: string; readonly attemptId: string; readonly terminalDigest: string }
  /** A Host-owned continuation message body. It is persisted only inside the provider ledger. */
  readonly followup: string
}

/** Immutable continuation target installed by Host composition, never CLI input. */
export interface ContinuationPolicy {
  readonly grantId: string
  readonly sessionId: string
  readonly goal: { readonly id: string; readonly revision: number }
  readonly budgetRef: { readonly id: string; readonly version: '1'; readonly digest: string }
  readonly expiresAt: number
  readonly followup: string
}
/** Host-private constructor binding policy to current Gate/Queue facts, never caller-supplied terminal data. */
export type ActivationRequestFactory = (access: EvalActivationAccess, policy: ContinuationPolicy,
  gateId: string, operationId: string, signal?: AbortSignal) => Promise<EvalActivationRequest>

/** Safe durable projection. `needs-attention` never retries or redelivers a message. */
export interface EvalActivationView {
  readonly id: string
  readonly grantId: string
  readonly workId: string
  readonly sessionId: string
  readonly goal: { readonly id: string; readonly revision: number }
  readonly phase: 'pending' | 'resuming' | 'followup-pending' | 'consumed' | 'blocked' | 'needs-attention'
  readonly messageId: string | null
  readonly reason: string | null
}

/** Stable, path-free denial and recovery classifications for continuation Consumers. */
export class EvalActivationError extends Error {
  constructor(readonly code: 'unavailable' | 'unauthorized' | 'not-found' | 'conflict' | 'expired' | 'blocked' | 'needs-attention', options?: ErrorOptions) {
    super(`eval-activation:${code}`, options); this.name = 'EvalActivationError'
  }
}

declare module '@deepseek-ai/cordis' { interface Context { evalActivation: EvalActivation } }

/** Durable, explicit bridge from one approved Eval terminal result to at most one Goal round. */
export abstract class EvalActivation extends Service {
  constructor(ctx: Context) { super(ctx, 'evalActivation') }
  /**
   * Persist or recover one exact single-use continuation intent.
   * @param access Current Host-bound actor and Workspace authorization.
   * @param request Host-derived Grant, terminal Attempt and fixed continuation message.
   * @param signal Caller cancellation; committed claims remain recoverable.
   * @returns Durable receipt state; consumption never asserts Goal completion.
   */
  abstract activate(access: EvalActivationAccess, request: EvalActivationRequest, signal?: AbortSignal): Promise<EvalActivationView>
  /**
   * Read a path-free continuation projection without resuming an Agent or sending a follow-up.
   * @param access Current Workspace read authorization.
   * @param id Exact retained continuation identity.
   * @returns Safe receipt without private message text or filesystem locations.
   */
  abstract get(access: EvalActivationAccess, id: string): Promise<EvalActivationView>
  /**
   * Reconcile persisted intent after a restart; uncertain delivery stays needs-attention.
   * @param access Current authorization for the actor that owns the claimed Grant.
   * @param id Exact existing continuation identity.
   * @param signal Cancellation of recovery; an unproven dispatch is never repeated.
   * @returns Refreshed receipt based on exact persisted Goal message identity.
   */
  abstract reconcile(access: EvalActivationAccess, id: string, signal?: AbortSignal): Promise<EvalActivationView>
}

export default EvalActivation

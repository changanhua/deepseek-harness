import { Context, Service } from '@deepseek-ai/cordis'
import type {
  LinkDeliveryHandoffInput,
  PlanningAccess,
  PlanningBoardSnapshot,
  PlanningCommand,
  PlanningHandoff,
  PlanningMutationResult,
  PrepareDeliveryHandoffInput,
} from './types.ts'
export * from './schema.ts'
export * from './types.ts'
export * from './evolution.ts'
export * from './context.ts'
export { PlanningError } from './errors.ts'
declare module '@deepseek-ai/cordis' {
  interface Context {
    planning: Planning
  }
}
/**
 * Trusted Host-only planning seam. A trusted composition supplies {@link PlanningAccess}; this
 * contract does not isolate callers from a malicious Host plugin. Providers reauthorize that
 * supplied access before source reads and commits so a stale legitimate caller cannot write.
 */
export abstract class Planning extends Service {
  constructor(ctx: Context) {
    super(ctx, 'planning')
  }
  /**
   * Read a detached Board snapshot.
   * @param access - Trusted Host-derived caller authority for one Workspace.
   * @param signal - Optional caller lifetime; cancellation prevents a result from being returned.
   * @returns A consumer-safe current Board snapshot without provider-private replay receipts.
   * @throws {PlanningError} When the caller is no longer authorized, the Workspace is unavailable, or the provider is closed.
   */
  abstract snapshot(access: PlanningAccess, signal?: AbortSignal): Promise<PlanningBoardSnapshot>
  /**
   * Atomically apply one CAS-fenced command.
   * @param access - Trusted Host-derived caller authority rechecked before the durable commit.
   * @param command - Strict command carrying the expected Board version and idempotency request id.
   * @param signal - Optional caller lifetime checked before externally observed work and commit.
   * @returns The committed or replayed mutation receipt; an identical request id returns its original receipt.
   * @throws {PlanningError} When authorization, references, version, capacity, source capture, or provider lifetime prevents the mutation.
   */
  abstract execute(
    access: PlanningAccess,
    command: PlanningCommand,
    signal?: AbortSignal,
  ): Promise<PlanningMutationResult>
  /**
   * Freeze one exact current revision for deterministic Delivery mapping without creating external work.
   * @param access - Trusted Host-derived caller authority rechecked before the durable handoff record is written.
   * @param input - Exact revision, repository, mapping version, and stable request identity to freeze.
   * @param signal - Optional caller lifetime checked before the durable write.
   * @returns The prepared durable handoff; retries with the same identity return that frozen record.
   * @throws {PlanningError} When direct-user authorization, revision identity, mapping identity, or provider lifetime is invalid.
   */
  abstract prepareDeliveryHandoff(
    access: PlanningAccess,
    input: PrepareDeliveryHandoffInput,
    signal?: AbortSignal,
  ): Promise<PlanningHandoff>
  /**
   * Bind a prepared handoff to the exact Case and Contract revision returned by Delivery.
   * @param access - Trusted Host bridge authority; providers reject a direct user or Agent caller for this transition.
   * @param input - Stable handoff key plus the Case and Contract revision identities returned by Delivery.
   * @param signal - Optional caller lifetime checked before the durable link is committed.
   * @returns The linked durable handoff; an identical recovery retry returns the same record.
   * @throws {PlanningError} When the prepared handoff is absent, identities conflict, authorization is invalid, or the provider is closed.
   */
  abstract linkDeliveryHandoff(
    access: PlanningAccess,
    input: LinkDeliveryHandoffInput,
    signal?: AbortSignal,
  ): Promise<PlanningHandoff>
}
export default Planning

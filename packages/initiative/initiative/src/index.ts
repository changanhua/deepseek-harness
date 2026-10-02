import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { InitiativeCommand, InitiativeInvocation, InitiativePage, InitiativeQuery, InitiativeReceipt } from './types.ts'
export * from './schema.ts'
export * from './brand.ts'
export type * from './types.ts'

/** Expected Candidate failures, without granting new authority or executing a fallback. */
export class InitiativeError extends Error {
  constructor(readonly code: 'unauthorized' | 'unavailable' | 'not-found' | 'conflict' | 'idempotency-conflict' | 'invalid-input' | 'invalid-transition' | 'capacity-exceeded', message: string) {
    super(message)
    this.name = 'InitiativeError'
  }
}
declare module '@deepseek-ai/cordis' { interface Context { initiative: Initiative } }
/** Candidate owner; callers supply a live Agent, never a claimed actor or Workspace. */
export abstract class Initiative extends Service {
  constructor(ctx: Context) { super(ctx, 'initiative') }
  /**
   * Commit an authorized Candidate fact or explicit Human promotion.
   * @param agent - Exact live runtime caller, revalidated at durable commits.
   * @param input - Strict mutation with idempotency key and exact versions where required.
   * @param invocation - Commands-owned identity for Human calls; absent for model Tools.
   * @param signal - Caller cancellation, checked before commits.
   * @returns Original durable receipt on an identical authorized replay.
   */
  abstract execute(
    agent: Agent, input: InitiativeCommand, invocation?: InitiativeInvocation, signal?: AbortSignal,
  ): Promise<InitiativeReceipt>
  /**
   * Read detached Candidate history in the caller's current Workspace.
   * @param agent - Exact live runtime caller.
   * @param query - Exact revision or bounded filters.
   * @param invocation - Active Human command identity when outside an Agent turn.
   * @param signal - Caller cancellation.
   * @returns Candidate facts and explicitly unavailable RIR relations, never inferred verification.
   */
  abstract read(agent: Agent, query: InitiativeQuery, invocation?: InitiativeInvocation, signal?: AbortSignal): Promise<InitiativePage>
}
export default Initiative

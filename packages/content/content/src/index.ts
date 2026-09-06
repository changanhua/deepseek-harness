/** Human content library definition. Consumers supply trusted authorization and source resolution. */
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  CaptureCommand, ContentAccess, ContentCommand, ContentEntry, ContentErrorCode,
  ContentReceipt, ContentSnapshot, ContentSourceResolver, ContentStatus,
} from './types.ts'

export * from './schema.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    content: Content
  }
}

/** Payload-free errors; callers inspect code, never infer commit state from transport failure. */
export class ContentError extends Error {
  constructor(readonly code: ContentErrorCode) {
    super(`Content operation failed: ${code}`)
    this.name = 'ContentError'
  }
}

/** Providers own atomic entries, serial mutations and immutable versions behind this service. */
export abstract class Content extends Service {
  constructor(ctx: Context) {
    super(ctx, 'content')
  }

  /**
   * Return payload-free state even when storage cannot open.
   * @returns Current availability and configured byte limits.
   */
  abstract status(): ContentStatus

  /**
   * Authorize a read; unavailable reads reject.
   * @param id - Stored entry identity.
   * @param authorize - Trusted synchronous access check.
   * @returns A detached committed entry, or undefined when absent.
   */
  abstract get(id: string, authorize: ContentAccess): ContentEntry | undefined

  /**
   * Authorize and copy a consistent logical snapshot.
   * @param authorize - Trusted synchronous access check.
   * @returns Every committed entry, including drafts and original versions.
   */
  abstract snapshot(authorize: ContentAccess): ContentSnapshot

  /**
   * Query a known committed outcome; absence never proves non-commit.
   * @param entryId - Stored entry identity.
   * @param operationId - Original command identity.
   * @param authorize - Trusted synchronous access check.
   * @returns The saved outcome, or undefined when unknown.
   */
  abstract receipt(entryId: string, operationId: string, authorize: ContentAccess): ContentReceipt | undefined

  /**
   * Validate and commit one mutation after checking authorization at admission and execution.
   * Identical retries return the stored receipt; reused identities or stale revisions reject.
   * Inputs and results are detached. A resolved promise confirms durable storage.
   * @param command - Exact command retained by the caller across retries.
   * @param authorize - Trusted access check, repeated inside the write chain.
   * @returns The original or newly committed receipt.
   */
  abstract execute(command: ContentCommand, authorize: ContentAccess): Promise<ContentReceipt>

  /**
   * Authorize before resolving completed text outside the write chain, then authorize again and commit.
   * Only trusted host code supplies resolveSource; the request cannot supply verified body text.
   * Repeated source identity and body return the canonical creation receipt, even under a new
   * operation id. This is a lookup, not another accepted mutation; its id is not echoed or retained.
   * A changed body rejects. Independently generated titles never overwrite the first saved title.
   * @param command - Session and message references with a retained command identity.
   * @param resolveSource - Trusted host callback that reads completed source text.
   * @param authorize - Trusted access check, before source reading and inside the write chain.
   * @returns The canonical creation receipt for the captured source.
   */
  abstract capture(
    command: CaptureCommand, resolveSource: ContentSourceResolver, authorize: ContentAccess,
  ): Promise<ContentReceipt>
}

export default Content

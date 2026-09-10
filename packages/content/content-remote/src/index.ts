/** Authenticated browser operations for the local Content library. */
import type { Context } from '@deepseek-ai/cordis'
import {
  CaptureCommandSchema, ContentCommandSchema, ContentError,
} from '@changanhua/dsh-content'
import type {
  CaptureCommand, ContentAccess, ContentCommand, ContentEntry, ContentReceipt, ContentSnapshot, ContentStatus,
} from '@changanhua/dsh-content'
import type {} from '@changanhua/dsh-content-session'
import type {} from '@deepseek-ai/dsh-client-connection'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/cordis' {
  interface Context {
    contentRemote: ContentRemote
  }
}

/** The Connection owns browser authentication; Content owns the commit-time authorization callback. */
export class ContentRemote extends TypertRemoteService {
  static inject = ['connection', 'content', 'contentSession']

  /** Register the browser namespace without contributing any model tools. */
  constructor(ctx: Context) { super(ctx, 'contentRemote') }

  /**
   * Read library availability and limits after authenticating the browser request.
   * @param signal - Exact active signal supplied by Connection.
   * @returns Payload-free provider status.
   */
  @Remote('status')
  status(signal: AbortSignal): ContentStatus {
    return this.read(signal, () => this.ctx.content.status())
  }

  /**
   * Read the committed original, versions and current draft.
   * @param entryId - Stored content identity.
   * @param signal - Exact active signal supplied by Connection.
   * @returns Detached entry or null when absent.
   */
  @Remote('get')
  get(entryId: string, signal: AbortSignal): ContentEntry | null {
    return this.read(signal, authorize => this.ctx.content.get(entryId, authorize) ?? null)
  }

  /**
   * Export one consistent committed logical library snapshot.
   * @param signal - Exact active signal supplied by Connection.
   * @returns Content records, including originals and saved drafts.
   */
  @Remote('snapshot')
  snapshot(signal: AbortSignal): ContentSnapshot {
    return this.read(signal, authorize => this.ctx.content.snapshot(authorize))
  }

  /**
   * Reconcile a command whose response was lost.
   * @param entryId - Stored content identity.
   * @param operationId - Original retained command identity.
   * @param signal - Exact active signal supplied by Connection.
   * @returns Committed receipt or null; absence does not prove non-commit.
   */
  @Remote('receipt')
  receipt(entryId: string, operationId: string, signal: AbortSignal): ContentReceipt | null {
    return this.read(signal, authorize => this.ctx.content.receipt(entryId, operationId, authorize) ?? null)
  }

  /**
   * Submit one strict content command with a repeated authorization check at commit admission.
   * @param input - Retained command; wire fields cannot assert source verification or caller authority.
   * @param signal - Exact active signal supplied by Connection.
   * @returns The durable original or newly committed receipt.
   */
  @Remote('execute')
  async execute(input: ContentCommand, signal: AbortSignal): Promise<ContentReceipt> {
    try {
      const authorize = this.authorize(signal)
      authorize()
      const parsed = ContentCommandSchema.safeParse(input)
      if (!parsed.success) throw new ContentError('invalid_request')
      return await this.ctx.content.execute(parsed.data, authorize)
    } catch (error) { throw failure(error) }
  }

  /**
   * Capture a complete plain-text assistant message read by the Host from its Session.
   * @param input - Session id and canonical decimal event sequence as messageId, plus operationId.
   * @param signal - Exact active signal supplied by Connection.
   * @returns Canonical durable capture receipt; repeated clicks reuse the saved original.
   */
  @Remote('capture')
  async capture(input: CaptureCommand, signal: AbortSignal): Promise<ContentReceipt> {
    try {
      const authorize = this.authorize(signal)
      authorize()
      const parsed = CaptureCommandSchema.safeParse(input)
      if (!parsed.success) throw new ContentError('invalid_request')
      return await this.ctx.content.capture(parsed.data,
        request => this.ctx.contentSession.resolve(request, authorize, signal), authorize)
    } catch (error) { throw failure(error) }
  }

  private authorize(signal: AbortSignal): ContentAccess {
    const connection = this.ctx.connection
    return () => {
      if (signal.aborted) throw new ContentError('closed')
      try { connection.assertAuthorized(signal) } catch { throw new ContentError('forbidden') }
    }
  }

  private read<T>(signal: AbortSignal, read: (authorize: ContentAccess) => T): T {
    try {
      const authorize = this.authorize(signal)
      authorize()
      return read(authorize)
    } catch (error) { throw failure(error) }
  }
}

function failure(error: unknown): TypertRemoteFailure {
  const code = error instanceof ContentError ? error.code : 'unavailable'
  return new TypertRemoteFailure({ code, message: `Content operation failed: ${code}`, details: {} })
}

export default ContentRemote

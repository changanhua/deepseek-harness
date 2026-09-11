import { Context, Service } from '@deepseek-ai/cordis'
import type { BrowserActionResult, BrowserEntryEvent, BrowserInstance, BrowserObservation, BrowserOperation,
  BrowserPreparedAction, BrowserPreparedTicket } from './types.ts'

export type * from './types.ts'
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A user clicked one entry mounted in an authorized external webpage.
     * @param event - Verified mount, Session, page, title, and link identity for the click.
     * @mode emit
     */
    'browser/entry-click'(event: BrowserEntryEvent): void
  }
}
declare module '@deepseek-ai/cordis' {
  interface Context { browser: Browser }
}

/** Shared browser capability; an installation connection never implies a shared action target. */
export abstract class Browser extends Service {
  constructor(ctx: Context) { super(ctx, 'browser') }
  /**
   * Return current authorized installations without exposing their credentials.
   * @returns Detached installation metadata and online state.
   */
  abstract instances(): Promise<readonly BrowserInstance[]>
  /**
   * Recheck a captured installation's authority synchronously; offline alone does not revoke access.
   * @param instance - Previously returned installation metadata.
   * @returns Whether its identity, epoch, scopes and sites still match the current authorization.
   */
  abstract isAuthorized(instance: BrowserInstance): boolean
  /**
   * Read once for a background monitor under its fixed observation authorization.
   * @param operation - Session, installation, grant epoch and read-only action.
   * @param signal - Stops this finite observation without scheduling further checks.
   * @returns The observation outcome; an unavailable browser is never an unchanged result.
   */
  abstract observe(operation: BrowserObservation, signal: AbortSignal): Promise<BrowserActionResult>
  /**
   * Execute against the explicit instance/page; lost results remain unknown and are not replayed.
   * @param operation - Caller Session, installation and domain action.
   * @param signal - Requests cancellation without promising to undo an effect.
   * @returns Observed outcome or an unresolved result with its request identity.
   */
  abstract execute(operation: BrowserOperation, signal: AbortSignal): Promise<BrowserActionResult>
  /**
   * Read facts for one page action and bind its immutable parameters before asking for approval.
   * @param operation - Caller Session, installation and action with an explicit page target.
   * @param signal - Cancels preparation before a ticket can be used.
   * @returns A bounded, expiring preparation; rejects when the target cannot be prepared.
   */
  abstract prepare(operation: BrowserOperation, signal: AbortSignal): Promise<BrowserPreparedAction>
  /**
   * Submit exactly the prepared action after rechecking authority and page facts.
   * @param ticket - Opaque preparation owned by this provider instance.
   * @param signal - Requests cancellation without undoing an already issued action.
   * @returns The retained outcome on repeated calls, without dispatching a second action.
   */
  abstract executePrepared(ticket: BrowserPreparedTicket, signal: AbortSignal): Promise<BrowserActionResult>
}

export default Browser

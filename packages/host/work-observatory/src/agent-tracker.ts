/** Canonical Session step projection and replay lifecycle. */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { WorkObservatoryDatabase } from './database.ts'

/** Projects live and replayed canonical Session events into durable Agent step rows. */
export class AgentActivityTracker {
  private readonly adopted = new Set<Session>()

  /**
   * Reconcile process-orphaned rows, install listeners, then adopt every live Session.
   * Listener installation precedes the synchronous live-session sweep, so no event can
   * enter the single JavaScript event loop between discovery and capture unnoticed.
   * @param ctx - service fiber context providing the live Session store.
   * @param database - package-owned accounting store.
   */
  constructor(
    private readonly ctx: Context,
    private readonly database: WorkObservatoryDatabase,
  ) {
    database.reconcileOpenAgentSteps()
    ctx.on('session/created', (session) => {
      this.adopt(session)
    })
    ctx.on('session/event', (session, event) => {
      this.contain(`project ${String(session.id)} event ${event.seq}`, () => {
        if (!this.adopted.has(session)) this.adopt(session)
        this.project(session, event)
      })
    })
    ctx.on('session/disposed', (session) => {
      this.contain(`dispose ${String(session.id)}`, () => {
        if (!this.adopted.delete(session)) return
        this.database.closeOpenAgentStepsForSession(String(session.id))
      })
    })
    for (const session of ctx.sessions.list()) this.adopt(session)
    ctx.effect(() => () => {
      this.adopted.clear()
    }, 'work-observatory: release adopted sessions')
  }

  private adopt(session: Session): void {
    if (this.adopted.has(session)) return
    this.adopted.add(session)
    for (const event of session.events) {
      this.contain(`replay ${String(session.id)} event ${event.seq}`, () => {
        this.project(session, event)
      })
    }
  }

  private project(session: Session, event: SessionEvent): void {
    const ownStartSeq = session.header.seedLength ?? 0
    if (event.seq < ownStartSeq) return
    this.database.projectAgentEvent(String(session.id), event)
  }

  /** Contain observer failures so Work Observatory cannot disrupt Session publication. */
  private contain(subject: string, operation: () => void): void {
    try {
      operation()
    } catch (error) {
      this.ctx.logger.warn(`work observatory: ${subject} failed: ${String(error)}`)
    }
  }
}

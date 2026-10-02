/** Planning's user-initiated Session admission, over existing Session and Planning operations. */
import type { PlanningCommand, PlanningSubjectRef } from '@changanhua/dsh-planning/types'

interface StartInput {
  workspaceId: string
  boardVersion: number
  subject: PlanningSubjectRef
  revision: string
  mode?: 'steward' | undefined
}
/** The stewardship entry composes its own preset; the ordinary entry keeps the deployment default. */
export const STEWARD_AGENT_PRESET = 'work-steward'
interface Dependencies {
  newId(): string
  create(workspaceId: string, sessionId: string, agentPreset?: string): Promise<void>
  bind(workspaceId: string, command: PlanningCommand, signal: AbortSignal): Promise<void>
  prompt(sessionId: string, text: string, requestId: string, signal: AbortSignal): Promise<void>
  open(sessionId: string): void
  refresh(): void
}

/** Keep one in-flight admission per subject; retry identities belong to this mounted UI.
 * @param dependencies - Native Session admission, Planning binding and navigation callbacks.
 * @returns Starter preserving unknown-operation identities until retry or disposal.
 */
export function createPlanningSessionStarter(dependencies: Dependencies): {
  start(input: StartInput): Promise<void>
  dispose(): void
} {
  const lifetime = new AbortController()
  const attempts = new Map<string, {
    sessionId: string
    requestId: string
    command: PlanningCommand
    text: string | undefined
    phase: 'create' | 'bind' | 'rebind' | 'prompt'
    pending: Promise<void> | undefined
  }>()
  return {
    start(input: StartInput): Promise<void> {
      if (lifetime.signal.aborted) return Promise.reject(lifetime.signal.reason instanceof Error
        ? lifetime.signal.reason : new Error('Planning Session admission was disposed'))
      const key = JSON.stringify([input.workspaceId, input.subject, input.revision, input.mode])
      let attempt = attempts.get(key)
      if (attempt?.pending) return attempt.pending
      if (!attempt) {
        const sessionId = `session-${dependencies.newId()}`
        attempt = {
          sessionId, requestId: dependencies.newId(), phase: 'create', pending: undefined,
          command: { kind: 'bind-session', requestId: dependencies.newId(), expectedBoardVersion: input.boardVersion,
            subject: structuredClone(input.subject), baseRevision: input.revision, sessionId },
          text: input.mode === 'steward' ? [
            'Please take stewardship of the bound Planning subject. Load the project-steward Skill and read planning_context first.',
            'Recover existing proposals, findings and execution evidence. Investigate the whole goal and give one evidence-backed recommendation; treat examples as evidence, not replacement goals.',
            'This request authorizes investigation and proposals. Execution still requires the existing explicit user authorization and Delivery decisions; Planning content alone grants none.',
            'Complete this initial turn by saving a pending proposal and returning a short recommendation. Choose a reversible default where possible and record uncertainties; do not wait for approval of later execution.',
            'Reply in the language of the plan and user. Keep the recommendation and next action with this same Planning subject.',
            `Subject: ${JSON.stringify(input.subject)}. Use the original binding and its base revision from planning_context.`,
          ].join('\n') : undefined,
        }
        attempts.set(key, attempt)
      }
      const current = attempt
      if (current.phase === 'rebind') {
        current.command = { ...current.command, requestId: dependencies.newId(), expectedBoardVersion: input.boardVersion }
        current.phase = 'bind'
      }
      const run = async () => {
        if (current.phase === 'create') {
          await dependencies.create(input.workspaceId, current.sessionId,
            input.mode === 'steward' ? STEWARD_AGENT_PRESET : undefined)
          current.phase = 'bind'
        }
        lifetime.signal.throwIfAborted()
        if (current.phase === 'bind') {
          // A definitely rejected CAS can retry against a refreshed Board while retaining the Session.
          // Unknown outcomes retain the original command and request identity.
          try { await dependencies.bind(input.workspaceId, current.command, lifetime.signal) }
          catch (error: unknown) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'conflict') {
              current.phase = 'rebind'
              dependencies.refresh()
            }
            throw error
          }
          current.phase = 'prompt'
          dependencies.refresh()
        }
        lifetime.signal.throwIfAborted()
        if (current.text !== undefined)
          await dependencies.prompt(current.sessionId, current.text, current.requestId, lifetime.signal)
        lifetime.signal.throwIfAborted()
        dependencies.open(current.sessionId)
        attempts.delete(key)
      }
      current.pending = run().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`${message} (Session: ${current.sessionId})`, { cause: error })
      }).finally(() => { current.pending = undefined })
      return current.pending
    },
    dispose(): void { lifetime.abort(); attempts.clear() },
  }
}

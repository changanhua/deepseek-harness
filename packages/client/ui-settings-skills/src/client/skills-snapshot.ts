/**
 * The Skills management snapshot controller (apply-private). It owns the
 * single response-addressable slot for the read-only `skillManagement.snapshot`
 * remote: a bare observable (HostObservable) the inject `hooks` compartment
 * hands to the renderer as `useSnapshot`, plus plain load/retry/reset
 * callbacks the inject face exposes. Fetch state stays here, never in a
 * component and never in a viewing store (the object-layer rule).
 */

import type { IApiClient, SessionId, SkillManagementSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** One snapshot state observable value. */
export interface SkillsSnapshotState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text; last good snapshot is kept alongside. */
  error: string | null
  /** The session this slot last addressed, or undefined before any load. */
  sessionId: SessionId | undefined
  /** Last accepted snapshot (kept on failed refresh so the UI never blanks). */
  snapshot: SkillManagementSnapshot | undefined
}

/** Human text for a rejected wire call (a host/realm may reject with anything).
 * @param error - the rejection value.
 * @returns a human-readable message string. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The controller shape the apply closure builds and inject exposes. */
export interface SkillsSnapshotController {
  /** The stable observable source for the hooks compartment. */
  readonly source: HostObservable<SkillsSnapshotState>
  /** Address (or re-address) the slot to one session. */
  load(sessionId: SessionId): void
  /** Retry the current addressing slot with the same sessionId. */
  retry(): void
  /** Drop the addressing slot (used when no ordinary session remains). */
  reset(): void
}

/**
 * Build the snapshot controller for one feature assembly.
 * @param api - the wire face restricted to the management domain.
 * @returns the controller.
 */
export function createSkillsSnapshotController(
  api: Pick<IApiClient, 'skillManagement'>,
): SkillsSnapshotController {
  const store = createSnapshotStore<SkillsSnapshotState>({
    status: 'idle', error: null, sessionId: undefined, snapshot: undefined,
  })
  let generation = 0

  const source: HostObservable<SkillsSnapshotState> = {
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
  }

  function publishFailure(generation_: number, message: string): void {
    if (generation_ !== generation) return
    store.update((draft) => {
      draft.status = 'error'
      draft.error = message
    })
  }

  function load(sessionId: SessionId): void {
    const generation_ = ++generation
    store.update((draft) => {
      draft.status = 'loading'
      draft.error = null
      draft.sessionId = sessionId
    })
    void (async () => {
      let response: Awaited<ReturnType<IApiClient['skillManagement']['snapshot']>>
      try {
        response = await api.skillManagement.snapshot({ sessionId })
      } catch (error) {
        publishFailure(generation_, messageOf(error))
        return
      }
      if (generation_ !== generation) return
      if (!response.result.ok) {
        publishFailure(generation_, `${response.result.error.code}: ${response.result.error.message}`)
        return
      }
      const value = response.result.ok ? response.result.value : undefined
      store.update((draft) => {
        draft.status = 'ready'
        draft.error = null
        draft.snapshot = value
      })
    })()
  }

  function retry(): void {
    const sessionId = store.getSnapshot().sessionId
    if (sessionId !== undefined) load(sessionId)
  }

  function reset(): void {
    generation += 1
    store.update((draft) => {
      draft.status = 'idle'
      draft.error = null
      draft.sessionId = undefined
      draft.snapshot = undefined
    })
  }

  return { source, load, retry, reset }
}

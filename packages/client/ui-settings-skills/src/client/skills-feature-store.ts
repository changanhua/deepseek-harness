/**
 * The Skills feature viewing state controller: a small observable source
 * carrying only interaction state that must survive across the two
 * registrations (the Popover adopts, the section reads) — the
 * deliberately-adopted session chosen by "Manage all" (§3.4). Snapshot data
 * does NOT live here: that is business data owned by the apply-private
 * snapshot controller.
 *
 * The source rides the inject `hooks` compartment (`useAdopted`), NOT a
 * `store` seat: the two slots live in different scopes (root settings section
 * vs per-session header action), and the slot system pins a shared store
 * handle to one scope ("one handle, one scope").
 */

import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Feature viewing state: the deliberately-adopted session, if any. */
export interface SkillsFeatureState {
  /** The session the Popover adopted; `undefined` means "follow current". */
  adopted: SessionId | undefined
}

/** The controller the apply closure builds and inject exposes. */
interface SkillsFeatureController {
  /** The stable observable source for the hooks compartment (`useAdopted`). */
  readonly source: HostObservable<SkillsFeatureState>
  /** Adopt a session (the Popover's "Manage all"). */
  adopt(sessionId: SessionId): void
  /** Drop the adoption and follow the current session again. */
  followCurrent(): void
}

/**
 * Create the Skills feature viewing state. One shared observable source is
 * handed to both the Popover and the Section registrations' `hooks`
 * compartment, so an adoption made in the title bar is visible in the Settings
 * page — without a cross-scope `store` handle.
 * @returns the controller.
 */
export function createSkillsFeatureController(): SkillsFeatureController {
  const store = createSnapshotStore<SkillsFeatureState>({ adopted: undefined })
  return {
    source: {
      getSnapshot: () => store.getSnapshot(),
      subscribe: listener => store.subscribe(listener),
    },
    adopt: (sessionId) => {
      store.update((draft) => { draft.adopted = sessionId })
    },
    followCurrent: () => {
      store.update((draft) => { draft.adopted = undefined })
    },
  }
}

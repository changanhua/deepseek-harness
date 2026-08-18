/**
 * The Skills feature viewing store (AGENTS rule 6 shape): a `defineStore`
 * factory whose actions are the complete write set. It carries only
 * interaction state that must survive across the two registrations (the
 * Popover adopts, the section reads) — the deliberately-adopted session
 * chosen by "Manage all" (§3.4). Snapshot data does NOT live here: that is
 * business data owned by the apply-private snapshot controller.
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'

/** Feature viewing state: the deliberately-adopted session, if any. */
export interface SkillsFeatureState {
  /** The session the Popover adopted; `undefined` means "follow current". */
  adopted: SessionId | undefined
}

/** Action-table annotation twin (drift fails at the defineStore call). */
type SkillsFeatureActions = {
  adopt: (draft: SkillsFeatureState, sessionId: SessionId) => void
  followCurrent: (draft: SkillsFeatureState) => void
}

/**
 * Create the Skills feature viewing store handle. One shared handle is passed
 * to both the Popover and the Section registrations' `store` seat, so an
 * adoption made in the title bar is visible in the Settings page.
 * @returns the store handle.
 */
export function createSkillsFeatureStore(): EngineStoreHandle<SkillsFeatureState, SkillsFeatureActions> {
  return defineStore({
    init: (): SkillsFeatureState => ({ adopted: undefined }),
    actions: {
      adopt: (d, sessionId: SessionId) => { d.adopted = sessionId },
      followCurrent: (d) => { d.adopted = undefined },
    },
  })
}

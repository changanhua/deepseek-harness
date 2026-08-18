/**
 * Skills feature inject contract and derived component props (AGENTS slot
 * rules: props are the four shares, never hand-typed members a share already
 * derives). The inject face carries only plain callbacks plus the reserved
 * `hooks` compartment for the snapshot observable; the renderer binds that
 * source into the `useSnapshot` selector hook.
 */

import type { HostObservable, PropsLocale, PropsRuntime, PropsStore, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SkillsSnapshotState } from './skills-snapshot.ts'
import type { createSkillsFeatureStore } from './skills-feature-store.ts'
import type { NS } from './locales.ts'

/** Plain callbacks + the snapshot observable the apply closure exposes. */
export interface SkillsFeatureInjected {
  /** Address (or re-address) the snapshot slot to one ordinary session. */
  load: (sessionId: SessionId) => void
  /** Retry the current addressing slot with the same sessionId. */
  retry: () => void
  /** Drop the addressing slot (used when no ordinary session remains). */
  reset: () => void
  /** Open the Skills Settings section via the shell navigator (no-op absent shell). */
  openManagement: () => void
  /** Reserved reactive-fact compartment: the snapshot observable. */
  hooks: { snapshot: HostObservable<SkillsSnapshotState> }
}

/** Component-side view of the hooks compartment: the bound selector hook. */
export type SkillsFeatureHooks = {
  /** Selector hook over the management snapshot state. */
  useSnapshot: SnapshotSelectorHook<SkillsSnapshotState>
}

/** Full Settings-section props: framework runtime + viewing store + injected callbacks + snapshot hook + locale. */
export type SkillsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsStore<ReturnType<typeof createSkillsFeatureStore>>
  & Omit<SkillsFeatureInjected, 'hooks'>
  & SkillsFeatureHooks
  & PropsLocale<typeof NS>

/** Full header-popover props: framework session kit + viewing store + injected callbacks + snapshot hook + locale. */
export type SkillsPopoverProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsStore<ReturnType<typeof createSkillsFeatureStore>>
  & Omit<SkillsFeatureInjected, 'hooks'>
  & SkillsFeatureHooks
  & PropsLocale<typeof NS>

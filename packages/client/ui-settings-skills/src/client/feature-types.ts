/**
 * Skills feature inject contract and derived component props (AGENTS slot
 * rules: props are derived from their shares, never hand-typed members a share
 * already derives). The inject face carries only plain callbacks plus the
 * reserved `hooks` compartment for the snapshot observable and the
 * adopted-session viewing source; the renderer binds those sources into the
 * `useSnapshot` / `useAdopted` selector hooks. No `store` seat is used: the
 * two slots live in different scopes, and a shared store handle is pinned to
 * one scope.
 */

import type { HostObservable, PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SkillsSnapshotState } from './skills-snapshot.ts'
import type { SkillsFeatureState } from './skills-feature-store.ts'
import type { NS } from './locales.ts'

/** Plain callbacks + the observable sources the apply closure exposes. */
export interface SkillsFeatureInjected {
  /** Address (or re-address) the snapshot slot to one ordinary session. */
  load: (sessionId: SessionId) => void
  /** Retry the current addressing slot with the same sessionId. */
  retry: () => void
  /** Drop the addressing slot (used when no ordinary session remains). */
  reset: () => void
  /** Open the Skills Settings section via the shell navigator (no-op absent shell). */
  openManagement: () => void
  /** Adopt a session for the Settings section (the Popover's "Manage all"). */
  adopt: (sessionId: SessionId) => void
  /** Drop the adoption and follow the current session again. */
  followCurrent: () => void
  /** Reserved reactive-fact compartment: the snapshot + adopted sources. */
  hooks: {
    snapshot: HostObservable<SkillsSnapshotState>
    adopted: HostObservable<SkillsFeatureState>
  }
}

/** Component-side view of the hooks compartment: the bound selector hooks. */
export type SkillsFeatureHooks = {
  /** Selector hook over the management snapshot state. */
  useSnapshot: SnapshotSelectorHook<SkillsSnapshotState>
  /** Selector hook over the adopted-session viewing state. */
  useAdopted: SnapshotSelectorHook<SkillsFeatureState>
}

/** Full Settings-section props: framework runtime + injected callbacks + snapshot/adoption hooks + locale. */
export type SkillsSectionProps =
  PropsRuntime<'settings.section'>
  & Omit<SkillsFeatureInjected, 'hooks'>
  & SkillsFeatureHooks
  & PropsLocale<typeof NS>

/** Full header-popover props: framework session kit + injected callbacks + snapshot/adoption hooks + locale. */
export type SkillsPopoverProps =
  PropsRuntime<'conversation.session.header.actions'>
  & Omit<SkillsFeatureInjected, 'hooks'>
  & SkillsFeatureHooks
  & PropsLocale<typeof NS>

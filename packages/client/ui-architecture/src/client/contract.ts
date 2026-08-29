/** Slot-facing contracts for the Architecture module entries. */

import type {
  HostObservable,
  InjectFace,
  PropsLocale,
  PropsRuntime,
  SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ArchitectureCatalog } from './catalog.ts'
import type { ArchitectureRuntimeState } from './runtime-controller.ts'
import type { NS } from './locales.ts'

/** Static catalog facts used by the sidebar entry. */
export interface ArchitectureNavInjected {
  readonly catalog: ArchitectureCatalog
}

/** Build catalog, refresh callback, and renderer-bound Runtime observable. */
export interface ArchitectureWorkspaceInjected {
  readonly catalog: ArchitectureCatalog
  readonly refresh: () => void
  readonly hooks: {
    readonly runtime: HostObservable<ArchitectureRuntimeState>
  }
}

/** Component-side hook generated from the injected Runtime observable. */
export interface ArchitectureWorkspaceHooks {
  readonly useRuntime: SnapshotSelectorHook<ArchitectureRuntimeState>
}

/** Sidebar module props derived from the owner and locale shares. */
export type ArchitectureNavEntryProps =
  PropsRuntime<'sidebar.modules'>
  & ArchitectureNavInjected
  & PropsLocale<typeof NS>

/** Full-page module props derived from the shell and injected shares. */
export type ArchitectureWorkspaceProps =
  PropsRuntime<'shell.view'>
  & Omit<ArchitectureWorkspaceInjected, 'hooks'>
  & ArchitectureWorkspaceHooks
  & PropsLocale<typeof NS>

/** Keep the renderer's generic contract checked against the concrete props. */
export type ArchitectureWorkspaceInjectedFace = InjectFace<ArchitectureWorkspaceInjected>

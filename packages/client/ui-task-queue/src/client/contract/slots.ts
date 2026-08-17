/**
 * Queue module slot faces: the injected business share both entries receive.
 * Owner facts (the sidebar module seat's `wide`/`activeModule`/`setActiveModule`)
 * arrive through the framework's standard `PropsRuntime` share, so this file
 * carries only the registrant-private face — the shared QueueStore.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the `shell.view` SlotMap merge from the frame.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the `sidebar.modules` SlotMap merge from the sidebar shell.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { QueueStore } from '../store.ts'

/** Business share injected into the center-column Queue view entry. */
export interface QueueWorkspaceInjected {
  queue: QueueStore
}

/** Business share injected into the sidebar module entry. */
export interface QueueNavEntryInjected {
  queue: QueueStore
}

/** Full composed props of the center-column Queue view. */
export type QueueWorkspaceProps =
  PropsRuntime<'shell.view'>
  & QueueWorkspaceInjected
  & PropsLocale<'taskQueue'>

/** Full composed props of the sidebar Queue module entry. */
export type QueueNavEntryProps =
  PropsRuntime<'sidebar.modules'>
  & QueueNavEntryInjected
  & PropsLocale<'taskQueue'>

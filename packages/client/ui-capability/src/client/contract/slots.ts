/**
 * Capability viewer slot faces: the injected business share both entries
 * receive. Owner facts (the sidebar module seat's `wide`/`activeModule`/
 * `setActiveModule`) arrive through the framework's standard `PropsRuntime`
 * share, so this file carries only the registrant-private face — the shared
 * CapabilityStore.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the `shell.view` SlotMap merge from the frame.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the `sidebar.modules` SlotMap merge from the sidebar shell.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { CapabilityStore } from '../store.ts'

/** Business share injected into the center-column Capability view entry. */
export interface CapabilityWorkspaceInjected {
  capability: CapabilityStore
}

/** Business share injected into the sidebar module entry. */
export interface CapabilityNavEntryInjected {
  capability: CapabilityStore
}

/** Full composed props of the center-column Capability view. */
export type CapabilityWorkspaceProps =
  PropsRuntime<'shell.view'>
  & CapabilityWorkspaceInjected
  & PropsLocale<'capability'>

/** Full composed props of the sidebar Capability module entry. */
export type CapabilityNavEntryProps =
  PropsRuntime<'sidebar.modules'>
  & CapabilityNavEntryInjected
  & PropsLocale<'capability'>

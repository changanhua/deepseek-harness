/** Slot-facing contracts for the Personal Delivery module. */

import type {
  HostObservable,
  InjectFace,
  PropsLocale,
  PropsRuntime,
  SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { DeliveryRuntimeState } from './runtime-controller.ts'
import type {
  DeliveryCreatePacketInput,
  DeliveryImportIssueInput,
  DeliveryReadEvidenceInput,
  DeliveryRecordDecisionInput,
  DeliveryStartChangeInput,
  DeliveryStartVerificationInput,
} from '@deepseek-ai/dsh-delivery-remote/types'
import type { NS } from './locales.ts'

/** Registration-side Host projection and its lifecycle actions. */
export interface DeliveryWorkspaceInjected {
  readonly hooks: {
    readonly delivery: HostObservable<DeliveryRuntimeState>
  }
  readonly refresh: () => void
  readonly cancel: () => void
  readonly importIssue: (input: DeliveryImportIssueInput) => Promise<boolean>
  readonly createPacket: (input: DeliveryCreatePacketInput) => Promise<boolean>
  readonly startChange: (input: DeliveryStartChangeInput) => Promise<boolean>
  readonly startVerification: (input: DeliveryStartVerificationInput) => Promise<boolean>
  readonly readEvidence: (input: DeliveryReadEvidenceInput) => Promise<boolean>
  readonly recordDecision: (input: DeliveryRecordDecisionInput) => Promise<boolean>
}

/** Renderer-bound hook generated from the injected observable. */
export interface DeliveryWorkspaceHooks {
  readonly useDelivery: SnapshotSelectorHook<DeliveryRuntimeState>
}

/** Registration-side projection shared with the persistent module entry. */
export interface DeliveryNavInjected {
  readonly hooks: {
    readonly delivery: HostObservable<DeliveryRuntimeState>
  }
}

/** Renderer-bound hook for the sidebar badge. */
export interface DeliveryNavHooks {
  readonly useDelivery: SnapshotSelectorHook<DeliveryRuntimeState>
}

/** Full center-column workbench props. */
export type DeliveryWorkspaceProps =
  PropsRuntime<'shell.view'>
  & Omit<DeliveryWorkspaceInjected, 'hooks'>
  & DeliveryWorkspaceHooks
  & PropsLocale<typeof NS>

/** Sidebar module entry props. */
export type DeliveryNavEntryProps =
  PropsRuntime<'sidebar.modules'>
  & DeliveryNavHooks
  & PropsLocale<typeof NS>

/** Keep the renderer's generic injection conversion checked. */
export type DeliveryWorkspaceInjectedFace = InjectFace<DeliveryWorkspaceInjected>

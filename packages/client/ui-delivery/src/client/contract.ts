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
import type { DeliveryEvidenceSelectionInput, DeliveryRuntimeState } from './runtime-controller.ts'
import type {
  DeliveryCreatePacketInput,
  DeliveryCreateCaseInput,
  DeliveryImportIssueInput,
  DeliveryPublishIssueInput,
  DeliveryRecordDecisionInput,
  DeliveryRecordRequirementDecisionInput,
  DeliveryResolvePublicationInput,
  DeliveryReviseCaseInput,
  DeliveryStartChangeInput,
  DeliveryStartVerificationInput,
} from '@changanhua/dsh-delivery-remote/types'
import type { NS } from './locales.ts'

/** Registration-side Host projection and its lifecycle actions. */
export interface DeliveryWorkspaceInjected {
  readonly hooks: {
    readonly delivery: HostObservable<DeliveryRuntimeState>
  }
  readonly refresh: () => void
  readonly cancel: () => void
  readonly createCase: (input: DeliveryCreateCaseInput) => Promise<boolean>
  readonly reviseCase: (input: DeliveryReviseCaseInput) => Promise<boolean>
  readonly recordRequirementDecision: (input: DeliveryRecordRequirementDecisionInput) => Promise<boolean>
  readonly publishIssue: (input: DeliveryPublishIssueInput) => Promise<boolean>
  readonly resolvePublication: (input: DeliveryResolvePublicationInput) => Promise<boolean>
  readonly importIssue: (input: DeliveryImportIssueInput) => Promise<boolean>
  readonly createPacket: (input: DeliveryCreatePacketInput) => Promise<boolean>
  readonly startChange: (input: DeliveryStartChangeInput) => Promise<boolean>
  readonly startVerification: (input: DeliveryStartVerificationInput) => Promise<boolean>
  readonly selectPacket: (packetId: string) => void
  readonly readEvidence: (input: DeliveryEvidenceSelectionInput) => Promise<boolean>
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

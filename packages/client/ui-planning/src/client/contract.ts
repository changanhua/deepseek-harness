import type { HostObservable, PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { CreateIdeaInput, PlanningRuntimeState, PlanningNavigation } from './runtime-controller.ts'
import type { PlanningCommand, PlanningSubjectRef } from '@changanhua/dsh-planning/types'
import type { NS } from './locales.ts'
import type { DesignCaseSummary } from '@changanhua/dsh-planning-remote/types'
export interface PlanningWorkspaceInjected {
  readonly startPlanningSession: (subject: PlanningSubjectRef, revision: string) => Promise<void>
  readonly hooks: { readonly planning: HostObservable<PlanningRuntimeState> }
  readonly navigate: (patch: Partial<PlanningNavigation>) => void
  readonly continuePlanningSession: (subject: PlanningSubjectRef, revision: string) => Promise<void>
  readonly continuePlan: (planId: string) => Promise<void>
  readonly openDesignCase: (summary: DesignCaseSummary) => void
  readonly refreshDesignCases: () => void
  readonly selectWorkspace: (workspaceId: string) => void
  readonly selectItem: (itemId: string | undefined) => void
  readonly create: (input: CreateIdeaInput) => Promise<boolean>
  readonly refresh: () => void
  readonly execute: (command: PlanningCommand) => Promise<boolean>
  readonly retry: () => Promise<boolean>
  readonly handoff: () => Promise<boolean>
  readonly readEvidence: (evidenceId: string) => void
  readonly openSessionSource: (sessionId: string) => void
  readonly readImageSource: (workspaceId: string, attachmentId: string) => Promise<string>
  readonly readContentSource: (
    entryId: string,
    version: string,
    workspaceId: string,
    sha256: string,
  ) => Promise<{ title: string; body: string }>
}
export interface PlanningWorkspaceHooks {
  readonly usePlanning: SnapshotSelectorHook<PlanningRuntimeState>
}
export type PlanningWorkspaceProps = PropsRuntime<'shell.view'> &
  Omit<PlanningWorkspaceInjected, 'hooks'> &
  PlanningWorkspaceHooks &
  PropsLocale<typeof NS>

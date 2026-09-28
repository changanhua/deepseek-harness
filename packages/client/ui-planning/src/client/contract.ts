import type { HostObservable, PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { CreateIdeaInput, PlanningRuntimeState } from './runtime-controller.ts'
import type { PlanningCommand } from '@changanhua/dsh-planning/types'
import type { NS } from './locales.ts'
export interface PlanningWorkspaceInjected {
  readonly hooks: { readonly planning: HostObservable<PlanningRuntimeState> }
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

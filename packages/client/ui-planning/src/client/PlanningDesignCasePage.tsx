import type { SbcDesignState } from './sbc-design-controller.ts'
import type { SbcExploreOperation } from '@changanhua/dsh-planning-remote/types'
import type { NS } from './locales.ts'
import type { HostObservable, PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { SbcDesignCase } from './SbcDesignCase.tsx'
import type { ThinkingCaseActions, ThinkingCaseRuntimeState } from './SbcDesignCase.tsx'

/** Existing SBC owner view, reached through the generic Planning case reference. */
export interface PlanningDesignCaseInjected {
  hooks: { sbcDesign: HostObservable<SbcDesignState>; thinking: HostObservable<ThinkingCaseRuntimeState> }
  explore: (operation: SbcExploreOperation) => Promise<void>
  refresh: () => Promise<void>
  close: () => void
  prepareThinking: ThinkingCaseActions['prepare']
  resumeThinking: ThinkingCaseActions['resume']
  applyThinking: ThinkingCaseActions['apply']
  submitThinkingProposal: ThinkingCaseActions['submitProposal']
  openThinkingSession: ThinkingCaseActions['openSession']
}
type PlanningDesignCaseProps = PropsRuntime<'shell.view'> & PropsLocale<typeof NS> &
  Omit<PlanningDesignCaseInjected, 'hooks'> & { useSbcDesign: SnapshotSelectorHook<SbcDesignState>
    useThinking: SnapshotSelectorHook<ThinkingCaseRuntimeState> }
export function PlanningDesignCasePage(props: PlanningDesignCaseProps) {
  const state = props.useSbcDesign(value => value)
  const thinking = props.useThinking(value => value)
  return <SbcDesignCase state={state} explore={props.explore} refresh={props.refresh} t={props.t}
    close={props.close} thinking={{ state: thinking, prepare: props.prepareThinking, resume: props.resumeThinking,
      apply: props.applyThinking, submitProposal: props.submitThinkingProposal, openSession: props.openThinkingSession }} />
}

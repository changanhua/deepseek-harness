import type { SbcDesignState } from './sbc-design-controller.ts'
import type { SbcExploreOperation } from '@changanhua/dsh-planning-remote/types'
import type { NS } from './locales.ts'
import type { HostObservable, PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { SbcDesignCase } from './SbcDesignCase.tsx'

/** Existing SBC owner view, reached through the generic Planning case reference. */
export interface PlanningDesignCaseInjected {
  hooks: { sbcDesign: HostObservable<SbcDesignState> }
  explore: (operation: SbcExploreOperation) => Promise<void>
  refresh: () => Promise<void>
  close: () => void
}
type PlanningDesignCaseProps = PropsRuntime<'shell.view'> & PropsLocale<typeof NS> &
  Omit<PlanningDesignCaseInjected, 'hooks'> & { useSbcDesign: SnapshotSelectorHook<SbcDesignState> }
export function PlanningDesignCasePage(props: PlanningDesignCaseProps) {
  const state = props.useSbcDesign(value => value)
  return <SbcDesignCase state={state} explore={props.explore} refresh={props.refresh} t={props.t}
    close={props.close} />
}

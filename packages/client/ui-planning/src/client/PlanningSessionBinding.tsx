import type { HostObservable, PropsLocale, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'

export interface PlanningBindingView { readonly title: string; readonly revision: string }
export interface PlanningBindingInjected { readonly hooks: { readonly planningBinding: HostObservable<PlanningBindingView | null> } }
export function PlanningSessionBinding(props: PropsLocale<typeof NS> & {
  readonly usePlanningBinding: SnapshotSelectorHook<PlanningBindingView | null>
}) {
  const binding = props.usePlanningBinding(value => value)
  return binding === null ? null : <p>
    {props.t('workspace.workingOn')}: {binding.title}<br />
    {props.t('workspace.baseRevision')}: {binding.revision}
  </p>
}

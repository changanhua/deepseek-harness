import type { BrowserSessionTargetBinding, BrowserTaskCheck, BrowserTaskDelegation, BrowserTaskDelegationCandidate, BrowserTaskFunctionHandoff, BrowserTaskReceipt, BrowserTaskSnapshot } from './types.ts'
export type BrowserTaskOperation = 'create' | 'evidence' | 'attempt' | 'reconcile-attempt' | 'resource' | 'reconcile-resource' | 'capability' | 'delegation' | 'evaluate' | 'transition' | 'rebind' | 'acknowledge-target-loss' | 'acknowledge-human-interaction' | 'consume-budget' | 'terminate' | 'owner-cancel' | 'handoff-function'
/** A closed operation plus full post-state enables strict replay without transient authority. */
export interface BrowserTaskChangeMeta { readonly kind: 'browser-task/change'; readonly version: 3; readonly operation: BrowserTaskOperation; readonly task: BrowserTaskSnapshot }
/** Complete post-state for the Session-owned target selection. */
export interface BrowserTargetChange {
  readonly kind: 'browser-target/change'
  readonly version: 1
  readonly revision: number
  readonly binding: BrowserSessionTargetBinding | null
}
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Complete post-mutation BrowserTask state for strict replay and client projection. */
    'browser-task/change': BrowserTaskChangeMeta
    /** Bounded Browser execution receipt cited by an attempt, evidence record, or resource disposition. */
    'browser-task/receipt': BrowserTaskReceipt
    /** Deterministic acceptance-check result over current evidence and the exact bound page. */
    'browser-task/check': BrowserTaskCheck
    /** Canonical Job, Subagent, or Cordis identity captured from one settled Tool execution. */
    'browser-task/delegation': BrowserTaskDelegation
    /** Canonical delegated work completed before its same-turn BrowserTask was created. */
    'browser-task/delegation-candidate': BrowserTaskDelegationCandidate
    /** Explicit user selection or clear; ordinary Browser reads never emit it. */
    'browser-target/change': BrowserTargetChange
    /** Exact Host-derived transfer of active function resources to an installation owner. */
    'browser-task/function-handoff': BrowserTaskFunctionHandoff
  }
}

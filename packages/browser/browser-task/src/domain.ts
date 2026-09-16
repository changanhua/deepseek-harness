import type { BrowserTaskCheck, BrowserTaskReceipt, BrowserTaskSnapshot } from './types.ts'
export type BrowserTaskOperation = 'create' | 'evidence' | 'attempt' | 'reconcile-attempt' | 'resource' | 'reconcile-resource' | 'capability' | 'delegation' | 'evaluate' | 'transition' | 'rebind' | 'acknowledge-target-loss' | 'acknowledge-human-interaction' | 'consume-budget' | 'terminate'
/** A closed operation plus full post-state enables strict replay without transient authority. */
export interface BrowserTaskChangeMeta { readonly kind: 'browser-task/change'; readonly version: 2; readonly operation: BrowserTaskOperation; readonly task: BrowserTaskSnapshot }
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Complete post-mutation BrowserTask state for strict replay and client projection. */
    'browser-task/change': BrowserTaskChangeMeta
    /** Bounded Browser execution receipt cited by an attempt, evidence record, or resource disposition. */
    'browser-task/receipt': BrowserTaskReceipt
    /** Deterministic acceptance-check result over current evidence and the exact bound page. */
    'browser-task/check': BrowserTaskCheck
  }
}

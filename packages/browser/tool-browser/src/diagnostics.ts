import type { BrowserAction, BrowserActionResult } from '@changanhua/dsh-browser'
import { browserFailureFingerprint, deterministicBrowserFailureCode } from '@changanhua/dsh-browser-task'

export type BrowserDiagnosticCategory = 'input' | 'precondition' | 'delivery' | 'unknown' | 'capability' | 'internal'
export type BrowserRequiredNextAction = 'refresh-page-map' | 'request-status' | 'refresh-target' | 'cleanup' | 'new-request-after-precondition' | 'stop'
export interface BrowserToolDiagnostic {
  readonly code: string
  readonly category: BrowserDiagnosticCategory
  readonly retryable: false
  readonly requiredNextAction: BrowserRequiredNextAction
  readonly fingerprint?: string
}

const deterministicReason = new Map<string, Pick<BrowserToolDiagnostic, 'code' | 'category' | 'requiredNextAction'>>([
  ['invalid_request_id', { code:'REQUEST_INVALID',category:'input',requiredNextAction:'stop' }],
  ['mount_capacity', { code:'MOUNT_CAPACITY',category:'precondition',requiredNextAction:'cleanup' }],
  ['page_map_evidence_required', { code:'PAGE_MAP_REQUIRED',category:'precondition',requiredNextAction:'refresh-page-map' }],
  ['region_replace_not_permitted', { code:'REGION_REPLACE_NOT_PERMITTED',category:'precondition',requiredNextAction:'refresh-page-map' }],
  ['region_ref_not_current', { code:'REGION_REF_NOT_CURRENT',category:'precondition',requiredNextAction:'refresh-page-map' }],
  ['request_conflict', { code:'REQUEST_CONFLICT',category:'input',requiredNextAction:'stop' }],
])

const capabilityReasons = new Set(['document_replaced', 'observation_not_authorized', 'target_url_stale', 'unauthorized'])
const terminalReasons = new Map<string, Pick<BrowserToolDiagnostic, 'code' | 'category' | 'requiredNextAction'>>([
  ['browser_policy_internal_error', { code:'BROWSER_POLICY_INTERNAL',category:'internal',requiredNextAction:'stop' }],
  ['browser_task_budget_exhausted', { code:'BROWSER_TASK_BUDGET_EXHAUSTED',category:'internal',requiredNextAction:'stop' }],
  ['browser_task_internal_invariant', { code:'BROWSER_TASK_INTERNAL_INVARIANT',category:'internal',requiredNextAction:'stop' }],
  ['browser_task_reconcile_required', { code:'BROWSER_TASK_RECONCILE_REQUIRED',category:'precondition',requiredNextAction:'request-status' }],
])

export function diagnosticFingerprint(action: BrowserAction, code: string): string {
  return browserFailureFingerprint(action, code)
}

export function diagnoseBrowserResult(result: BrowserActionResult, action: BrowserAction): BrowserToolDiagnostic | undefined {
  if (result.outcome === 'observed') return undefined
  if (result.outcome === 'unknown') {
    return { code:'OUTCOME_UNKNOWN',category:'unknown',retryable:false,requiredNextAction:'request-status' }
  }
  const deterministic = result.reason === undefined ? undefined : deterministicReason.get(result.reason)
  if (deterministic !== undefined) {
    return { ...deterministic,retryable:false,fingerprint:diagnosticFingerprint(action,deterministic.code) }
  }
  const terminal = result.reason === undefined ? undefined : terminalReasons.get(result.reason)
  if (terminal !== undefined) return { ...terminal,retryable:false }
  if (result.reason !== undefined && capabilityReasons.has(result.reason)) {
    return { code:'CAPABILITY_DRIFT',category:'capability',retryable:false,requiredNextAction:'refresh-target' }
  }
  if (result.outcome === 'cancelled') {
    return { code:'CANCELLED',category:'delivery',retryable:false,requiredNextAction:'stop' }
  }
  return result.delivery === 'not-sent'
    ? { code:'NOT_SENT',category:'delivery',retryable:false,requiredNextAction:'new-request-after-precondition' }
    : { code:'PROVIDER_FAILED',category:'delivery',retryable:false,requiredNextAction:'stop' }
}

export function deterministicDiagnosticReason(reason: string | undefined): boolean {
  return reason !== undefined && deterministicReason.has(reason)
}

export function deterministicDiagnosticCode(reason: string | undefined): string | undefined {
  return deterministicBrowserFailureCode(reason)
}

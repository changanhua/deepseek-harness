import { createHash } from 'node:crypto'
import type { BrowserAction } from '@changanhua/dsh-browser'

const deterministicFailureCodes = new Map<string, string>([
  ['invalid_request_id', 'REQUEST_INVALID'],
  ['mount_capacity', 'MOUNT_CAPACITY'],
  ['page_map_evidence_required', 'PAGE_MAP_REQUIRED'],
  ['region_replace_not_permitted', 'REGION_REPLACE_NOT_PERMITTED'],
  ['region_ref_not_current', 'REGION_REF_NOT_CURRENT'],
  ['request_conflict', 'REQUEST_CONFLICT'],
])

/** Return the stable diagnostic code for failures that must not be retried unchanged. */
export function deterministicBrowserFailureCode(reason: string | undefined): string | undefined {
  return reason === undefined ? undefined : deterministicFailureCodes.get(reason)
}

/**
 * Fingerprint the semantic target of one deterministic failure.
 *
 * Ephemeral request and resource identities are deliberately excluded so a
 * caller cannot evade the recovery gate by minting another requestId or
 * mountId. A newly mapped regionRef or genuinely different strategy produces a new value.
 */
export function browserFailureFingerprint(action: BrowserAction, code: string): string {
  const target = 'page' in action ? action.page
    : action.kind === 'snapshot'
      ? { tabId: action.tabId, frameId: action.frameId, documentId: action.documentId }
      : undefined
  const semanticTarget = action.kind === 'region_render'
    ? code === 'REGION_REPLACE_NOT_PERMITTED'
      ? { regionRef: action.regionRef, mode: action.mode ?? 'append' }
      : { regionRef: action.regionRef }
    : action.kind === 'entry_mount' || action.kind === 'entry_inspect'
      ? { regionSelector: action.regionSelector, selector: action.selector }
      : undefined
  const payload = JSON.stringify({ actionKind: action.kind, code, target, semanticTarget })
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`
}

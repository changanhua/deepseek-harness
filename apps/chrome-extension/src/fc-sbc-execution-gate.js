const compact = value => String(value ?? '').replace(/\s+/gu, ' ').trim()
const boundedText = value => typeof value === 'string' && value.length > 0 && value.length <= 256
const finiteTime = value => Number.isSafeInteger(value) && value > 0
const money = value => Number.isSafeInteger(value) && value >= 0

const issue = (code, detail) => ({ code, detail: compact(detail).slice(0, 180) })

const identityFields = [
  'sessionId',
  'installationId',
  'grantEpoch',
  'tabId',
  'frameId',
  'documentId',
  'clubId',
  'pageCapturedAt',
  'inventoryCapturedAt',
]

const leaseFields = [
  'sessionId',
  'installationId',
  'grantEpoch',
  'tabId',
  'frameId',
  'documentId',
  'clubId',
]

const differs = (left, right, fields) => fields.some(field => left?.[field] !== right?.[field])
const writeAction = action => ['purchase', 'fill-squad', 'submit'].includes(action?.kind)

const actionScopeIssues = (preview, action) => {
  if (!action?.kind || action.kind === 'read-only') return []
  if (action.kind === 'purchase') {
    const scoped = (Array.isArray(preview?.scope?.purchaseScope) ? preview.scope.purchaseScope : [])
      .find(row => row.planPurchaseId === action.planPurchaseId && row.cardVersionId === action.cardVersionId)
    if (!scoped) return [issue('purchase-not-approved', compact(action.planPurchaseId || action.cardVersionId))]
    return money(action.maxPrice) && action.maxPrice > scoped.maxPrice
      ? [issue('purchase-price-over-preview-limit', `${action.maxPrice}/${scoped.maxPrice}`)]
      : []
  }
  if (action.kind === 'submit' || action.kind === 'fill-squad') {
    const approved = Array.isArray(preview?.scope?.submitChallengeIds)
      && preview.scope.submitChallengeIds.includes(action.challengeId)
    return approved ? [] : [issue(action.kind === 'submit' ? 'submit-not-approved' : 'fill-not-approved', action.challengeId)]
  }
  return [issue('action-kind-unsupported', action.kind)]
}

const writeLeaseStatusOf = (preview, lease, now, action) => {
  if (!writeAction(action)) return { status: 'not-required', issues: [] }
  if (!lease) return { status: 'missing', issues: [issue('write-lease-missing', action?.kind)] }
  if (lease.status === 'released') return { status: 'released', issues: [issue('write-lease-released', lease.releaseReason ?? 'released')] }
  if (!finiteTime(lease.expiresAt) || now > lease.expiresAt) {
    return { status: 'expired', issues: [issue('write-lease-expired', lease.expiresAt)] }
  }
  if (differs(preview?.identity, lease, leaseFields)) {
    return { status: 'mismatch', issues: [issue('write-lease-mismatch', action?.kind)] }
  }
  return { status: 'valid', issues: [] }
}

export const createSbcExecutionGate = (input = {}) => {
  const preview = input.approvalPreview ?? null
  const action = input.action ?? { kind: 'read-only' }
  const now = Number.isSafeInteger(input.now) ? input.now : Date.now()
  const issues = []

  if (!preview || preview.kind !== 'fc-sbc-approval-preview') {
    issues.push(issue('approval-preview-missing', 'no approval preview'))
  } else {
    if (preview.status !== 'ready') issues.push(issue('approval-preview-not-ready', preview.status))
    if (!boundedText(input.expectedReviewDigest) || input.expectedReviewDigest !== preview.reviewDigest) {
      issues.push(issue('approval-digest-mismatch', input.expectedReviewDigest))
    }
    if (differs(preview.identity, input.currentIdentity, identityFields)) {
      issues.push(issue('approval-identity-mismatch', 'current identity differs from reviewed preview'))
    }
    if (finiteTime(preview.approvalWindow?.expiresAt) && now > preview.approvalWindow.expiresAt) {
      issues.push(issue('approval-expired', preview.approvalWindow.expiresAt))
    } else if (input.phase === 'start' && finiteTime(preview.approvalWindow?.startBy) && now > preview.approvalWindow.startBy) {
      issues.push(issue('approval-start-expired', preview.approvalWindow.startBy))
    }
    const lease = writeLeaseStatusOf(preview, input.writeLease, now, action)
    issues.push(...lease.issues)
    issues.push(...actionScopeIssues(preview, action))
    return {
      schemaVersion: 1,
      kind: 'fc-sbc-execution-gate',
      status: issues.length ? 'blocked' : 'ready',
      issues,
      summary: {
        action: compact(action.kind || 'unknown'),
        reviewDigest: compact(preview.reviewDigest),
        identityStatus: issues.some(row => row.code === 'approval-identity-mismatch') ? 'mismatch' : 'matched',
        writeLeaseStatus: lease.status,
      },
      scope: {
        planId: compact(preview.scope?.planId),
        groupId: compact(preview.scope?.groupId),
        platform: compact(preview.scope?.platform),
      },
      sideEffects: {
        browserWrites: false,
        purchases: false,
        squadFill: false,
        submits: false,
      },
    }
  }

  return {
    schemaVersion: 1,
    kind: 'fc-sbc-execution-gate',
    status: 'blocked',
    issues,
    summary: {
      action: compact(action.kind || 'unknown'),
      reviewDigest: '',
      identityStatus: 'missing',
      writeLeaseStatus: 'missing',
    },
    scope: { planId: '', groupId: '', platform: '' },
    sideEffects: {
      browserWrites: false,
      purchases: false,
      squadFill: false,
      submits: false,
    },
  }
}

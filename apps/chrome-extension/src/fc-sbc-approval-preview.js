const compact = value => String(value ?? '').replace(/\s+/gu, ' ').trim()
const boundedText = value => typeof value === 'string' && value.length > 0 && value.length <= 256
const money = value => Number.isSafeInteger(value) && value >= 0
const positiveTime = value => Number.isSafeInteger(value) && value > 0

const issue = (code, detail) => ({ code, detail: compact(detail).slice(0, 180) })

const canonical = value => {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return 'null'
}

const fingerprint = value => {
  let hash = 2166136261
  for (const char of canonical(value)) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const identityOf = input => {
  const identity = input.identity ?? input
  return {
    sessionId: boundedText(identity.sessionId) ? compact(identity.sessionId) : '',
    installationId: boundedText(identity.installationId) ? compact(identity.installationId) : '',
    grantEpoch: Number.isSafeInteger(identity.grantEpoch) ? identity.grantEpoch : null,
    tabId: Number.isSafeInteger(identity.tabId) ? identity.tabId : null,
    frameId: Number.isSafeInteger(identity.frameId) ? identity.frameId : null,
    documentId: boundedText(identity.documentId) ? compact(identity.documentId) : '',
    clubId: boundedText(identity.clubId) ? compact(identity.clubId) : '',
    pageCapturedAt: boundedText(identity.pageCapturedAt) ? compact(identity.pageCapturedAt) : '',
    inventoryCapturedAt: boundedText(identity.inventoryCapturedAt) ? compact(identity.inventoryCapturedAt) : '',
  }
}

const purchaseScopeOf = plan => Array.isArray(plan?.challenges) ? plan.challenges.flatMap(challenge =>
  (Array.isArray(challenge.cards) ? challenge.cards : [])
    .filter(card => card.kind === 'purchase')
    .map(card => ({
      challengeId: compact(challenge.challengeId),
      planPurchaseId: compact(card.planPurchaseId),
      cardVersionId: compact(card.cardVersionId),
      maxPrice: money(card.maxPrice) ? card.maxPrice : 0,
    }))) : []

const validChallengeIdsOf = plan => new Set((Array.isArray(plan?.challenges) ? plan.challenges : [])
  .map(challenge => compact(challenge.challengeId)).filter(Boolean))

const submitScopeOf = (input, plan) => {
  const validChallengeIds = validChallengeIdsOf(plan)
  const submitChallengeIds = Array.isArray(input.submitChallengeIds)
    ? [...new Set(input.submitChallengeIds.filter(boundedText))]
    : []
  const invalidSubmitIds = submitChallengeIds.filter(challengeId => !validChallengeIds.has(challengeId))
  return { submitChallengeIds, invalidSubmitIds }
}

export const createSbcApprovalPreview = (input = {}) => {
  const readiness = input.readiness ?? null
  const plan = input.plan ?? (Array.isArray(readiness?.variants) ? readiness.variants[0] : null)
  const dryRun = input.executionDryRun ?? readiness?.executionDryRun ?? null
  const risk = input.riskPreflight ?? readiness?.riskPreflight ?? null
  const now = Number.isSafeInteger(input.now) ? input.now : Date.now()
  const startWithinProvided = input.startWithinMs !== undefined
  const expiresInProvided = input.expiresInMs !== undefined
  const startWithinMs = startWithinProvided ? input.startWithinMs : 10 * 60 * 1000
  const expiresInMs = expiresInProvided ? input.expiresInMs : 60 * 60 * 1000
  const approvalWindow = { approvedAt: now, startBy: now + startWithinMs, expiresAt: now + expiresInMs,
    startWithinMs, expiresInMs }
  const { submitChallengeIds, invalidSubmitIds } = submitScopeOf(input, plan)
  const purchaseScope = purchaseScopeOf(plan)
  const issues = []

  if (!plan || !boundedText(plan.planId)) issues.push(issue('plan-missing', 'no candidate SBC plan is selected'))
  if (readiness && (readiness.canApproveExecution !== true || readiness.status !== 'ready-for-approval')) {
    issues.push(issue('readiness-not-approvable', (readiness.blockers ?? []).map(row => row.code).join(',') || readiness.status))
  }
  if (dryRun?.status === 'blocked') {
    issues.push(issue('execution-dry-run-blocked', (dryRun.issues ?? []).map(row => row.code).join(',')))
  }
  if (risk?.status === 'blocked') {
    issues.push(issue('risk-preflight-blocked', (risk.issues ?? []).map(row => row.code).join(',')))
  }
  if (!positiveTime(startWithinMs) || !positiveTime(expiresInMs) || startWithinMs > expiresInMs) {
    issues.push(issue('approval-window-invalid', `${startWithinMs}/${expiresInMs}`))
  }
  if (invalidSubmitIds.length) {
    issues.push(issue('submit-scope-invalid', invalidSubmitIds.join(',')))
  }

  const identity = identityOf(input)
  const status = issues.length ? 'blocked' : 'ready'
  const scope = {
    planId: compact(plan?.planId),
    groupId: compact(plan?.groupId),
    platform: compact(plan?.platform),
    purchaseScope,
    submitChallengeIds,
  }
  const summary = {
    planId: compact(plan?.planId),
    groupId: compact(plan?.groupId),
    platform: compact(plan?.platform),
    purchaseCount: dryRun?.summary?.purchaseCount ?? purchaseScope.length,
    submitCount: submitChallengeIds.length,
    maxSpend: dryRun?.summary?.maxSpend ?? (money(plan?.maxSpend) ? plan.maxSpend : 0),
    reservedIfStarted: dryRun?.summary?.reservedIfStarted ?? purchaseScope.reduce((sum, row) => sum + row.maxPrice, 0),
    plannedSearches: risk?.summary?.plannedSearches ?? 0,
    riskStatus: compact(risk?.status || 'unknown'),
    readinessStatus: compact(readiness?.status || 'unknown'),
    executionStatus: compact(dryRun?.status || 'unknown'),
  }
  const sideEffects = {
    browserWrites: false,
    purchases: false,
    squadFill: false,
    submits: false,
  }
  const reviewDigest = fingerprint({
    approvalWindow,
    execution: { status: compact(dryRun?.status || 'unknown'), summary: dryRun?.summary ?? null },
    identity,
    issues: issues.map(row => row.code),
    risk: { status: compact(risk?.status || 'unknown'), summary: risk?.summary ?? null },
    scope,
    sideEffects,
    status,
    summary,
  })

  return {
    schemaVersion: 1,
    kind: 'fc-sbc-approval-preview',
    status,
    reviewDigest,
    identity,
    notice: '只生成批准预览；不会购买、填阵或提交。',
    issues,
    approvalWindow,
    requiredBindings: { session: true, installation: true, tab: true, club: true },
    scope,
    summary,
    sideEffects,
  }
}

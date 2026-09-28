const compact = value => String(value ?? '').replace(/\s+/gu, ' ').trim()
const boundedText = value => typeof value === 'string' && value.length > 0 && value.length <= 256
const money = value => Number.isSafeInteger(value) && value >= 0

const issue = (code, detail) => ({ code, detail: compact(detail).slice(0, 180) })

const fromPlan = plan => Array.isArray(plan?.challenges) ? plan.challenges.flatMap(challenge =>
  (Array.isArray(challenge.cards) ? challenge.cards : [])
    .filter(card => card.kind === 'purchase')
    .map(card => ({
      challengeId: compact(challenge.challengeId),
      planPurchaseId: compact(card.planPurchaseId),
      cardVersionId: compact(card.cardVersionId),
      maxPrice: money(card.maxPrice) ? card.maxPrice : 0,
    }))) : []

const normalizePurchaseRows = (plan, approval) => {
  const approvalRows = Array.isArray(approval?.purchaseScope) ? approval.purchaseScope : null
  const rows = approvalRows ?? fromPlan(plan)
  return rows.map((row, index) => ({
    order: index + 1,
    challengeId: compact(row.challengeId),
    planPurchaseId: compact(row.planPurchaseId),
    cardVersionId: compact(row.cardVersionId),
    maxPrice: money(row.maxPrice) ? row.maxPrice : 0,
  }))
}

const normalizeSubmitRows = approval => (Array.isArray(approval?.submitChallengeIds) ? approval.submitChallengeIds : [])
  .filter(boundedText)
  .map((challengeId, index) => ({ order: index + 1, challengeId }))

export const createSbcExecutionDryRun = (input = {}) => {
  const plan = input.plan ?? null
  const approval = input.approval ?? null
  const maxMarketSearches = Number.isSafeInteger(input.maxMarketSearches) ? input.maxMarketSearches : 20
  const maxSearchesPerPurchase = Number.isSafeInteger(input.maxSearchesPerPurchase) ? input.maxSearchesPerPurchase : 2
  const purchases = normalizePurchaseRows(plan, approval).sort((left, right) =>
    right.maxPrice - left.maxPrice || left.challengeId.localeCompare(right.challengeId) || left.order - right.order)
    .map((row, index) => ({ ...row, order: index + 1, maxSearches: maxSearchesPerPurchase }))
  const submits = normalizeSubmitRows(approval)
  const issues = []
  const seen = new Set()
  for (const purchase of purchases) {
    if (!boundedText(purchase.planPurchaseId) || !boundedText(purchase.cardVersionId) || purchase.maxPrice <= 0) {
      issues.push(issue('invalid-purchase-row', `purchase row ${purchase.order} is missing id, version, or max price`))
    }
    if (seen.has(purchase.planPurchaseId)) issues.push(issue('duplicate-purchase-id', purchase.planPurchaseId))
    seen.add(purchase.planPurchaseId)
  }
  if (purchases.length > maxMarketSearches) {
    issues.push(issue('market-search-limit', `purchase queue has ${purchases.length} rows, above limit ${maxMarketSearches}`))
  }
  const maxSpend = money(approval?.maxSpend) ? approval.maxSpend : money(plan?.maxSpend) ? plan.maxSpend : 0
  const reservedIfStarted = purchases.reduce((sum, row) => sum + row.maxPrice, 0)
  if (reservedIfStarted > maxSpend) issues.push(issue('budget-exceeded', `reserved ${reservedIfStarted} exceeds max spend ${maxSpend}`))
  const status = issues.length ? 'blocked' : purchases.length ? 'ready' : 'no-purchases'
  return {
    schemaVersion: 1,
    kind: 'fc-sbc-execution-dry-run',
    status,
    issues,
    summary: {
      planId: compact(approval?.planId ?? plan?.planId),
      groupId: compact(approval?.groupId ?? plan?.groupId),
      platform: compact(approval?.platform ?? plan?.platform),
      purchaseCount: purchases.length,
      submitCount: submits.length,
      maxSpend,
      reservedIfStarted,
      maxMarketSearches,
      maxSearchesPerPurchase,
    },
    purchaseQueue: purchases,
    submitQueue: submits,
    sideEffects: {
      browserWrites: false,
      purchases: false,
      squadFill: false,
      submits: false,
    },
  }
}

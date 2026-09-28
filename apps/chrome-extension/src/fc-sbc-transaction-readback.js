const compact = value => String(value ?? '').replace(/\s+/gu, ' ').trim()
const boundedText = value => typeof value === 'string' && value.length > 0 && value.length <= 256
const money = value => Number.isSafeInteger(value) && value >= 0
const issue = (code, detail) => ({ code, detail: compact(detail).slice(0, 180) })

const firstAcquired = (cards, cardVersionId) => Array.isArray(cards)
  ? cards.find(card => card?.cardVersionId === cardVersionId) ?? null
  : null

const classifyPurchase = input => {
  if (!input) return null
  const issues = []
  const requestId = compact(input.requestId)
  const planPurchaseId = compact(input.planPurchaseId)
  const cardVersionId = compact(input.cardVersionId)
  const maxPrice = money(input.maxPrice) ? input.maxPrice : 0
  const acquired = firstAcquired(input.acquiredCards, cardVersionId)
  const anyAcquired = Array.isArray(input.acquiredCards) ? input.acquiredCards[0] : null
  const actualPrice = money(acquired?.actualPrice) ? acquired.actualPrice
    : money(anyAcquired?.actualPrice) ? anyAcquired.actualPrice : 0

  if (!boundedText(requestId) || !boundedText(planPurchaseId) || !boundedText(cardVersionId) || maxPrice <= 0) {
    issues.push(issue('purchase-readback-invalid', 'purchase readback is missing request, purchase id, card version, or max price'))
  }
  if (anyAcquired && !acquired) issues.push(issue('purchase-version-mismatch', cardVersionId))
  if (actualPrice > maxPrice) issues.push(issue('purchase-price-over-limit', `${actualPrice}/${maxPrice}`))

  const balanceBefore = money(input.balanceBefore) ? input.balanceBefore : null
  const balanceAfter = money(input.balanceAfter) ? input.balanceAfter : null
  const balanceDelta = balanceBefore !== null && balanceAfter !== null ? balanceBefore - balanceAfter : null
  const status = issues.some(row => ['purchase-readback-invalid', 'purchase-version-mismatch', 'purchase-price-over-limit'].includes(row.code))
    ? 'blocked'
    : acquired ? 'confirmed'
      : input.pageStatus === 'not-acquired' ? 'not-acquired'
        : 'unknown'

  return {
    purchase: {
      status,
      requestId,
      planPurchaseId,
      cardVersionId,
      actualPrice: status === 'confirmed' ? actualPrice : 0,
      maxPrice,
      balanceDelta,
      observedAt: compact(input.observedAt).slice(0, 64),
    },
    issues,
  }
}

const classifySubmission = input => {
  if (!input) return null
  const issues = []
  const requestId = compact(input.requestId)
  const challengeId = compact(input.challengeId)
  if (!boundedText(requestId) || !boundedText(challengeId)) {
    issues.push(issue('submission-readback-invalid', 'submission readback is missing request or challenge id'))
  }
  const cardCountBefore = Number.isSafeInteger(input.cardCountBefore) ? input.cardCountBefore : null
  const cardCountAfter = Number.isSafeInteger(input.cardCountAfter) ? input.cardCountAfter : null
  const cardPoolDelta = cardCountBefore !== null && cardCountAfter !== null ? cardCountAfter - cardCountBefore : null
  const completed = input.completedBefore !== true && input.completedAfter === true
  const cardPoolChanged = cardPoolDelta !== null && cardPoolDelta < 0
  if (completed && !cardPoolChanged) issues.push(issue('submission-cardpool-unverified', challengeId))
  const status = issues.some(row => row.code === 'submission-readback-invalid') ? 'blocked'
    : completed && cardPoolChanged ? 'completed'
      : input.pageStatus === 'rejected' ? 'rejected'
        : 'unknown'
  return {
    submission: {
      status,
      requestId,
      challengeId,
      cardPoolDelta,
      observedAt: compact(input.observedAt).slice(0, 64),
    },
    issues,
  }
}

export const createSbcTransactionReadback = (input = {}) => {
  const purchaseResult = classifyPurchase(input.purchase)
  const submissionResult = classifySubmission(input.submission)
  const issues = [...(purchaseResult?.issues ?? []), ...(submissionResult?.issues ?? [])]
  const purchase = purchaseResult?.purchase ?? null
  const submission = submissionResult?.submission ?? null
  return {
    schemaVersion: 1,
    kind: 'fc-sbc-transaction-readback',
    status: issues.some(row => row.code.endsWith('-invalid')) || purchase?.status === 'blocked' || submission?.status === 'blocked'
      ? 'blocked'
      : purchase?.status === 'confirmed' || submission?.status === 'completed' ? 'observed' : 'unknown',
    issues,
    summary: {
      purchase: purchase?.status ?? 'not-run',
      submission: submission?.status ?? 'not-run',
      issueCount: issues.length,
    },
    purchase,
    submission,
    sideEffects: {
      browserWrites: false,
      purchases: false,
      submits: false,
    },
  }
}

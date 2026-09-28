const compact = value => String(value ?? '').replace(/\s+/gu, ' ').trim()
const list = value => Array.isArray(value) ? value : []
const hasText = value => compact(value).length > 0
const ratio = (covered, total) => total > 0 ? `${covered}/${total}` : ''

const field = (area, code, status, detail, evidence = []) => ({
  area,
  code,
  status,
  detail: compact(detail).slice(0, 180),
  evidence: list(evidence).map(item => compact(item).slice(0, 96)).filter(Boolean).slice(0, 8),
})

const challengeCoverage = challenges => {
  const stableIds = challenges.filter(challenge => hasText(challenge.challengeId) && !/^visible-\d+$/u.test(challenge.challengeId)).length
  const requirementRows = challenges.filter(challenge => list(challenge.requirementLines).some(hasText)).length
  const rewardRows = challenges.filter(challenge => list(challenge.rewardLines).some(hasText)).length
  return { stableIds, requirementRows, rewardRows }
}

const cardCoverage = cards => {
  const instanceIds = cards.filter(card => hasText(card.instanceId)).length
  const ratings = cards.filter(card => Number.isSafeInteger(card.rating)).length
  return { instanceIds, ratings }
}

export const createSbcFieldAudit = (input = {}) => {
  const probe = input.probe ?? input
  const inventorySnapshot = input.inventorySnapshot
  const snapshotComplete = inventorySnapshot?.status === 'complete'
  const challenges = list(probe.challengeSet?.challenges)
  const cards = list(probe.inventory?.visibleCards)
  const inventoryCards = snapshotComplete ? list(inventorySnapshot.cards) : cards
  const challengeStats = challengeCoverage(challenges)
  const cardStats = cardCoverage(inventoryCards)
  const transaction = input.transactionReadback ?? {}
  const purchaseCovered = transaction.purchase === true || transaction.summary?.purchase === 'confirmed'
  const submissionCovered = transaction.submission === true || transaction.summary?.submission === 'completed'
  const inventoryCoverage = snapshotComplete ? 'complete' : probe.inventory?.coverage
  const fields = [
    field('page', 'page-url', hasText(probe.url) ? 'covered' : 'missing', 'FC Web App URL'),
    field('page', 'page-title', hasText(probe.title) ? 'covered' : 'missing', 'page title'),
    field('page', 'capture-time', hasText(probe.capturedAt) ? 'covered' : 'missing', 'probe capture timestamp'),
    field('page', 'supported-fc-page', probe.supported === true ? 'covered' : 'missing', 'recognized EA FC Web App page'),
    field('task', 'task-type', ['puzzle', 'item-score'].includes(probe.taskType) ? 'covered' : 'missing', 'SBC task type'),
    field('task', 'challenge-set-title', hasText(probe.challengeSet?.title) ? 'covered' : 'partial', 'challenge set title'),
    field('task', 'visible-challenge-count', challenges.length > 0 ? 'covered' : 'missing', 'visible challenge rows', [String(challenges.length)]),
    field('task', 'stable-challenge-ids', !challenges.length ? 'missing' : challengeStats.stableIds === challenges.length ? 'covered' : 'partial',
      'stable challenge identifiers', [ratio(challengeStats.stableIds, challenges.length)]),
    field('task', 'requirement-lines', !challenges.length ? 'missing' : challengeStats.requirementRows === challenges.length ? 'covered' : 'partial',
      'visible requirement lines per challenge', [ratio(challengeStats.requirementRows, challenges.length)]),
    field('task', 'reward-lines', !challenges.length ? 'missing' : challengeStats.rewardRows === challenges.length ? 'covered' : 'partial',
      'visible reward lines per challenge', [ratio(challengeStats.rewardRows, challenges.length)]),
    field('market', 'market-access-status', ['visible', 'blocked'].includes(probe.marketAccess?.status) ? 'covered' : 'missing',
      'market access status before purchase approval', [probe.marketAccess?.status]),
    field('market', 'market-access-evidence', list(probe.marketAccess?.evidence).length ? 'covered' : 'missing',
      'market access text evidence', probe.marketAccess?.evidence),
    field('inventory', 'inventory-coverage', inventoryCoverage === 'complete' ? 'covered'
      : inventoryCoverage === 'visible-only' ? 'partial' : 'missing',
      'club and SBC Storage inventory coverage', [inventoryCoverage]),
    field('inventory', 'sbc-storage-visibility', snapshotComplete || probe.inventory?.sbcStorageVisible === true ? 'covered' : 'partial',
      'SBC Storage visibility from current page or complete inventory snapshot',
      [snapshotComplete ? `snapshot:${inventorySnapshot.summary.sbcStorageCount}` : probe.inventory?.sbcStorageVisible === true ? 'visible' : 'not-visible']),
    field('inventory', 'visible-card-count', cards.length ? 'partial' : 'missing', 'visible card rows', [String(cards.length)]),
    field('inventory', 'card-instance-ids', !inventoryCards.length ? 'missing'
      : snapshotComplete && cardStats.instanceIds === inventoryCards.length ? 'covered'
        : cardStats.instanceIds === inventoryCards.length ? 'partial' : 'missing',
      'card instance identifiers', [ratio(cardStats.instanceIds, inventoryCards.length)]),
    field('inventory', 'card-ratings', !inventoryCards.length ? 'missing'
      : snapshotComplete && cardStats.ratings === inventoryCards.length ? 'covered'
        : cardStats.ratings === inventoryCards.length ? 'partial' : 'missing',
      'card ratings', [ratio(cardStats.ratings, inventoryCards.length)]),
    field('readback', 'purchase-result-readback', purchaseCovered ? 'covered' : 'missing',
      'EA purchase result readback after a sent buy request'),
    field('readback', 'submission-result-readback', submissionCovered ? 'covered' : 'missing',
      'EA challenge completion and card-pool readback after submit'),
  ]
  const summary = fields.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1
    return acc
  }, { covered: 0, partial: 0, missing: 0 })
  const gaps = fields.filter(item => item.status !== 'covered')
  return {
    schemaVersion: 1,
    kind: 'fc-sbc-field-audit',
    status: gaps.some(item => item.status === 'missing') ? 'needs-samples' : gaps.length ? 'partial' : 'covered',
    summary,
    fields,
    gaps,
  }
}

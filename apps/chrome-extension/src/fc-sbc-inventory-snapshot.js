const compact = value => String(value ?? '').replace(/\s+/gu, ' ').trim()
const boundedText = value => typeof value === 'string' && value.length > 0 && value.length <= 256
const money = value => Number.isSafeInteger(value) && value >= 0
const sourceOf = value => ['club', 'sbc-storage', 'visible'].includes(value) ? value : 'club'
const coverageOf = value => ['complete', 'visible-only', 'partial', 'unread'].includes(value) ? value : 'unread'
const issue = (code, detail) => ({ code, detail: compact(detail).slice(0, 180) })

const normalizeCard = row => {
  const instanceId = compact(row?.instanceId)
  const cardVersionId = compact(row?.cardVersionId)
  if (!boundedText(instanceId) || !boundedText(cardVersionId)) return null
  const card = {
    instanceId,
    cardVersionId,
    source: sourceOf(row.source),
    locked: row.locked === true,
    tradeable: row.tradeable === true,
    reserveValue: money(row.reserveValue) ? row.reserveValue : 0,
  }
  if (Number.isSafeInteger(row.rating)) card.rating = row.rating
  return card
}

export const createSbcInventorySnapshot = (input = {}) => {
  const coverage = coverageOf(input.coverage)
  const rows = Array.isArray(input.cards) ? input.cards : []
  const issues = []
  const cards = []
  const seen = new Set()
  let invalidRowCount = 0
  let duplicateInstanceCount = 0

  for (const [index, row] of rows.entries()) {
    const card = normalizeCard(row)
    if (!card) {
      invalidRowCount += 1
      issues.push(issue('inventory-row-missing-identity', `inventory row ${index + 1} is missing instanceId or cardVersionId`))
      continue
    }
    if (seen.has(card.instanceId)) {
      duplicateInstanceCount += 1
      issues.push(issue('duplicate-card-instance', card.instanceId))
      continue
    }
    seen.add(card.instanceId)
    cards.push(card)
  }

  if (coverage !== 'complete') {
    issues.push(issue('inventory-coverage-unverified', coverage))
  } else if (!cards.length) {
    issues.push(issue('complete-inventory-empty', 'complete inventory snapshot has no cards'))
  }

  const uniqueCardVersionCount = new Set(cards.map(card => card.cardVersionId)).size
  const summary = {
    coverage,
    cardCount: cards.length,
    clubCount: cards.filter(card => card.source === 'club').length,
    sbcStorageCount: cards.filter(card => card.source === 'sbc-storage').length,
    visibleCount: cards.filter(card => card.source === 'visible').length,
    lockedCount: cards.filter(card => card.locked).length,
    tradeableCount: cards.filter(card => card.tradeable).length,
    duplicateInstanceCount,
    invalidRowCount,
    uniqueCardVersionCount,
  }
  const status = invalidRowCount > 0 || duplicateInstanceCount > 0 || issues.some(row => row.code === 'complete-inventory-empty')
    ? 'invalid'
    : coverage === 'complete' ? 'complete' : 'partial'

  return {
    schemaVersion: 1,
    kind: 'fc-sbc-inventory-snapshot',
    status,
    capturedAt: compact(input.capturedAt).slice(0, 64),
    issues,
    summary,
    cards,
    solverInventory: cards.map(card => ({
      instanceId: card.instanceId,
      cardVersionId: card.cardVersionId,
      reserveValue: card.reserveValue,
      locked: card.locked,
    })),
  }
}

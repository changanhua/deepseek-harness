const clone = value => structuredClone(value)
const fail = code => Object.assign(new Error(code), { code })
const boundedText = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max
const money = value => Number.isSafeInteger(value) && value >= 0
const futureTime = value => Number.isSafeInteger(value) && value > 0
const keyOf = part => part.instanceId ? `owned:${part.instanceId}` : `buy:${part.cardVersionId}:${part.planPurchaseId ?? ''}`

const canonical = value => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  throw fail('invalid_value')
}

const fingerprint = value => {
  let hash = 2166136261
  for (const char of canonical(value)) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const quoteKey = quote => `${quote.platform}:${quote.cardVersionId}`

const normalizeQuote = (quote, now) => {
  if (!quote || !boundedText(quote.cardVersionId) || !boundedText(quote.platform)
    || !money(quote.price) || quote.price <= 0 || !futureTime(quote.observedAt)
    || !futureTime(quote.validUntil) || quote.validUntil <= now) return null
  return { cardVersionId: quote.cardVersionId, platform: quote.platform, price: quote.price,
    source: boundedText(quote.source, 128) ? quote.source : 'unknown', observedAt: quote.observedAt, validUntil: quote.validUntil }
}

const normalizeCard = card => {
  if (!card || !boundedText(card.instanceId) || !boundedText(card.cardVersionId)) throw fail('invalid_card')
  return { ...clone(card), reserveValue: money(card.reserveValue) ? card.reserveValue : 0 }
}

const normalizePart = (part, inventory, quotes, input) => {
  if (part?.instanceId) {
    const card = inventory.get(part.instanceId)
    if (!card) throw fail('candidate_card_missing')
    if (input.lockedCardIds?.includes(part.instanceId) || card.locked) throw fail('locked_card')
    return { kind: 'owned', instanceId: part.instanceId, cardVersionId: card.cardVersionId,
      reserveValue: card.reserveValue, opportunityCost: money(part.opportunityCost) ? part.opportunityCost : card.reserveValue }
  }
  if (!boundedText(part?.cardVersionId)) throw fail('invalid_candidate_part')
  const quote = quotes.get(`${input.platform}:${part.cardVersionId}`)
  if (!quote) throw fail('quote_unavailable')
  const maxPrice = money(part.maxPrice) && part.maxPrice > 0 ? Math.min(part.maxPrice, quote.price) : quote.price
  if (maxPrice <= 0) throw fail('quote_unavailable')
  return { kind: 'purchase', cardVersionId: part.cardVersionId, planPurchaseId: boundedText(part.planPurchaseId)
    ? part.planPurchaseId : `${part.cardVersionId}:${fingerprint(part)}`, maxPrice, quote }
}

const evaluateSquad = (challenge, squad, inventory, quotes, input) => {
  if (!Array.isArray(squad?.cards) || squad.cards.length !== challenge.slotCount) throw fail('invalid_squad')
  const cards = squad.cards.map(part => normalizePart(part, inventory, quotes, input))
  const seen = new Set()
  for (const card of cards) {
    const key = keyOf(card)
    if (seen.has(key)) throw fail('duplicate_squad_card')
    seen.add(key)
  }
  return { challengeId: challenge.challengeId, candidateId: boundedText(squad.candidateId) ? squad.candidateId : fingerprint({ challengeId: challenge.challengeId, cards }),
    cards, purchaseCount: cards.filter(card => card.kind === 'purchase').length,
    maxSpend: cards.reduce((sum, card) => sum + (card.kind === 'purchase' ? card.maxPrice : 0), 0),
    opportunityCost: cards.reduce((sum, card) => sum + (card.kind === 'owned' ? card.opportunityCost : 0), 0),
    score: Number.isFinite(squad.score) ? squad.score : 0 }
}

const dominates = (left, right) => left.purchaseCount <= right.purchaseCount && left.maxSpend <= right.maxSpend
  && left.opportunityCost <= right.opportunityCost
  && (left.purchaseCount < right.purchaseCount || left.maxSpend < right.maxSpend || left.opportunityCost < right.opportunityCost)

const planSummary = squads => ({
  purchaseCount: squads.reduce((sum, squad) => sum + squad.purchaseCount, 0),
  maxSpend: squads.reduce((sum, squad) => sum + squad.maxSpend, 0),
  opportunityCost: squads.reduce((sum, squad) => sum + squad.opportunityCost, 0),
})

export const buildSbcPlanVariants = input => {
  if (!boundedText(input?.fcYear) || !boundedText(input?.platform) || !boundedText(input?.groupId)
    || !Array.isArray(input?.challenges) || !Array.isArray(input?.inventory) || !Array.isArray(input?.quotes)) throw fail('invalid_plan_input')
  const now = Number.isSafeInteger(input.now) ? input.now : Date.now()
  const inventory = new Map(input.inventory.map(card => {
    const normalized = normalizeCard(card)
    return [normalized.instanceId, normalized]
  }))
  const quotes = new Map(input.quotes.flatMap(quote => {
    const normalized = normalizeQuote(quote, now)
    return normalized ? [[quoteKey(normalized), normalized]] : []
  }))
  const candidates = input.challenges.map(challenge => {
    if (!boundedText(challenge?.challengeId) || !Number.isSafeInteger(challenge.slotCount) || challenge.slotCount <= 0
      || !Array.isArray(challenge.candidates)) throw fail('invalid_challenge')
    return challenge.candidates.flatMap(candidate => {
      try { return [evaluateSquad(challenge, candidate, inventory, quotes, input)] }
      catch { return [] }
    }).sort((left, right) => left.purchaseCount - right.purchaseCount || left.maxSpend - right.maxSpend
      || left.opportunityCost - right.opportunityCost || right.score - left.score)
  })
  if (candidates.some(rows => rows.length === 0)) return []
  const limit = Number.isSafeInteger(input.variantLimit) && input.variantLimit > 0 ? input.variantLimit : 8
  const totalBudget = money(input.totalBudget) ? input.totalBudget : Number.MAX_SAFE_INTEGER
  const results = []
  const walk = (index, squads, usedInstances) => {
    if (index === candidates.length) {
      const summary = planSummary(squads)
      if (summary.maxSpend <= totalBudget) results.push({ fcYear: input.fcYear, platform: input.platform,
        groupId: input.groupId, planId: fingerprint({ input: { fcYear: input.fcYear, platform: input.platform, groupId: input.groupId }, squads }),
        challenges: clone(squads), ...summary })
      return
    }
    for (const squad of candidates[index]) {
      const owned = squad.cards.filter(card => card.kind === 'owned').map(card => card.instanceId)
      if (owned.some(instanceId => usedInstances.has(instanceId))) continue
      const nextUsed = new Set(usedInstances)
      owned.forEach(instanceId => nextUsed.add(instanceId))
      walk(index + 1, [...squads, squad], nextUsed)
    }
  }
  walk(0, [], new Set())
  return results.filter((plan, index, rows) => !rows.some((other, otherIndex) => otherIndex !== index && dominates(other, plan)))
    .sort((left, right) => left.purchaseCount - right.purchaseCount || left.maxSpend - right.maxSpend
      || left.opportunityCost - right.opportunityCost || left.planId.localeCompare(right.planId))
    .slice(0, limit)
}

export const createPlanApproval = (plan, input = {}) => {
  if (!plan || !boundedText(plan.planId) || !money(plan.maxSpend)) throw fail('invalid_plan')
  const approvedAt = Number.isSafeInteger(input.approvedAt) ? input.approvedAt : Date.now()
  const startBy = Number.isSafeInteger(input.startBy) ? input.startBy : approvedAt + 10 * 60 * 1000
  const expiresAt = Number.isSafeInteger(input.expiresAt) ? input.expiresAt : approvedAt + 60 * 60 * 1000
  if (startBy <= approvedAt || expiresAt <= approvedAt || startBy > expiresAt) throw fail('invalid_approval_window')
  if (!boundedText(input.sessionId) || !boundedText(input.installationId) || !Number.isSafeInteger(input.tabId)
    || !boundedText(input.clubId)) throw fail('invalid_approval_scope')
  const challengeIds = new Set((Array.isArray(plan.challenges) ? plan.challenges : [])
    .map(challenge => challenge.challengeId).filter(id => boundedText(id)))
  const submitChallengeIds = Array.isArray(input.submitChallengeIds)
    ? [...new Set(input.submitChallengeIds.filter(id => boundedText(id)))]
    : []
  if (submitChallengeIds.some(challengeId => !challengeIds.has(challengeId))) throw fail('submit_scope_invalid')
  return { approvalId: boundedText(input.approvalId) ? input.approvalId : fingerprint({ planId: plan.planId, approvedAt, scope: input.sessionId }),
    planId: plan.planId, groupId: plan.groupId, platform: plan.platform, approvedAt, startBy, expiresAt,
    sessionId: input.sessionId, installationId: input.installationId, tabId: input.tabId, clubId: input.clubId,
    maxSpend: plan.maxSpend, submitChallengeIds, purchaseScope: plan.challenges.flatMap(challenge => challenge.cards
      .filter(card => card.kind === 'purchase').map(card => ({ challengeId: challenge.challengeId,
        planPurchaseId: card.planPurchaseId, cardVersionId: card.cardVersionId, maxPrice: card.maxPrice }))) }
}

export const assertApprovalCanRun = (approval, scope, now = Date.now(), phase = 'run') => {
  if (!approval || !scope || approval.sessionId !== scope.sessionId || approval.installationId !== scope.installationId
    || approval.tabId !== scope.tabId || approval.clubId !== scope.clubId) throw fail('approval_scope_changed')
  if (phase === 'start' && now > approval.startBy) throw fail('approval_start_expired')
  if (now > approval.expiresAt) throw fail('approval_expired')
  return true
}

const ledgerTotals = entries => entries.reduce((totals, entry) => ({
  paid: totals.paid + (entry.status === 'confirmed' ? entry.actualPrice : 0),
  reserved: totals.reserved + (entry.status === 'reserved' || entry.status === 'unknown' ? entry.reservedPrice : 0),
}), { paid: 0, reserved: 0 })

export const createActionLedger = approval => {
  if (!approval || !Array.isArray(approval.purchaseScope) || !money(approval.maxSpend)) throw fail('invalid_approval')
  return { approvalId: approval.approvalId, maxSpend: approval.maxSpend, purchases: [], submits: [] }
}

export const reservePurchase = (ledger, approval, input) => {
  if (!boundedText(input?.requestId) || !boundedText(input?.planPurchaseId)) throw fail('invalid_purchase_request')
  if (ledger.purchases.some(entry => entry.requestId === input.requestId)) throw fail('duplicate_request')
  const scoped = approval.purchaseScope.find(row => row.planPurchaseId === input.planPurchaseId)
  if (!scoped || scoped.cardVersionId !== input.cardVersionId) throw fail('purchase_not_approved')
  const reservedPrice = money(input.maxPrice) && input.maxPrice > 0 ? input.maxPrice : scoped.maxPrice
  if (reservedPrice > scoped.maxPrice) throw fail('price_over_limit')
  const totals = ledgerTotals(ledger.purchases)
  if (totals.paid + totals.reserved + reservedPrice > ledger.maxSpend) throw fail('budget_exceeded')
  const next = clone(ledger)
  next.purchases.push({ requestId: input.requestId, planPurchaseId: input.planPurchaseId, cardVersionId: input.cardVersionId,
    reservedPrice, actualPrice: 0, status: 'reserved' })
  return next
}

export const settlePurchase = (ledger, requestId, result) => {
  const next = clone(ledger)
  const entry = next.purchases.find(row => row.requestId === requestId)
  if (!entry) throw fail('purchase_request_missing')
  if (!['reserved', 'unknown'].includes(entry.status)) return next
  if (result?.status === 'confirmed') {
    if (!money(result.actualPrice) || result.actualPrice > entry.reservedPrice) throw fail('invalid_actual_price')
    entry.status = 'confirmed'
    entry.actualPrice = result.actualPrice
  } else if (result?.status === 'not-acquired') {
    entry.status = 'not-acquired'
    entry.reservedPrice = 0
  } else if (result?.status === 'failed') {
    entry.status = 'failed'
    entry.reservedPrice = 0
  } else {
    entry.status = 'unknown'
  }
  return next
}

export const recordSubmitRequest = (ledger, approval, input) => {
  if (!boundedText(input?.requestId) || !boundedText(input?.challengeId)) throw fail('invalid_submit_request')
  if (!approval.submitChallengeIds.includes(input.challengeId)) throw fail('submit_not_approved')
  if (ledger.submits.some(entry => entry.requestId === input.requestId)) throw fail('duplicate_request')
  const next = clone(ledger)
  next.submits.push({ requestId: input.requestId, challengeId: input.challengeId, status: 'sent', pageVerified: false })
  return next
}

export const settleSubmitRequest = (ledger, requestId, result) => {
  const next = clone(ledger)
  const entry = next.submits.find(row => row.requestId === requestId)
  if (!entry) throw fail('submit_request_missing')
  if (result?.status === 'page-completed') {
    entry.status = 'completed'
    entry.pageVerified = true
  } else if (result?.status === 'rejected') {
    entry.status = 'rejected'
  } else {
    entry.status = 'unknown'
  }
  return next
}

export const ledgerBalance = ledger => ledgerTotals(ledger.purchases)

import { buildSbcPlanVariants } from './fc-sbc-core.js'

const text = value => typeof value === 'string' ? value.trim() : ''
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null
const issue = (code, detail = '', challengeId) => ({ code, detail: text(detail).slice(0, 180), ...(challengeId ? { challengeId } : {}) })
const qualityRank = { bronze: 1, silver: 2, gold: 3 }
const fields = new Set(['nationId', 'leagueId', 'clubId'])
const clone = value => structuredClone(value)

const range = constraint => {
  const exact = integer(constraint?.exact ?? constraint?.count)
  const min = integer(constraint?.minimum ?? constraint?.min)
  const max = integer(constraint?.maximum ?? constraint?.max)
  if (exact !== null) return { min: exact, max: exact }
  if (min === null && max === null) return null
  return { min: min ?? 0, max: max ?? Number.MAX_SAFE_INTEGER }
}

const fieldOf = constraint => text(constraint?.attribute ?? constraint?.field)
const qualityOf = constraint => text(constraint?.quality ?? constraint?.values?.[0]).toLowerCase()
const valuesOf = constraint => [...new Set((Array.isArray(constraint?.values) ? constraint.values : [])
  .map(text).filter(Boolean))]

const normalizeConstraint = constraint => {
  const type = text(constraint?.type)
  if (!['attribute-count', 'distinct-count', 'same-count', 'quality-count', 'minimum-quality', 'card-rating', 'squad-rating', 'chemistry'].includes(type)) {
    return { issue: issue('unsupported-rule', type || 'missing') }
  }
  const limits = type === 'minimum-quality'
    ? { min: 0, max: Number.MAX_SAFE_INTEGER }
    : range(constraint)
  if (!type || !limits || limits.min > limits.max) return { issue: issue('invalid-rule', type || 'missing rule type or range') }
  if (['attribute-count', 'distinct-count', 'same-count'].includes(type)) {
    const field = fieldOf(constraint)
    if (!fields.has(field)) return { issue: issue('unsupported-attribute', field || type) }
    const values = valuesOf(constraint)
    if (type === 'attribute-count' && !values.length) return { issue: issue('attribute-values-missing', field) }
    return { rule: { type, field, values, ...limits } }
  }
  if (type === 'quality-count' || type === 'minimum-quality') {
    const quality = qualityOf(constraint)
    if (!qualityRank[quality]) return { issue: issue('unsupported-quality', quality || type) }
    return { rule: { type, quality, ...limits } }
  }
  if (type === 'card-rating') return { rule: { type, ...limits } }
  if (type === 'squad-rating') {
    const model = text(constraint?.model)
    if (!['average-rounded', 'average-floor', 'verified-evaluator'].includes(model)) return { issue: issue('squad-rating-model-unknown', model || 'missing') }
    return { rule: { type, model, ...limits } }
  }
  if (type === 'chemistry') {
    const model = text(constraint?.model)
    if (model !== 'verified-evaluator') return { issue: issue('chemistry-model-unknown', model || 'missing') }
    return { rule: { type, model, ...limits } }
  }
  return { issue: issue('unsupported-rule', type) }
}

export const compileSbcPuzzleRequirements = requirements => {
  const slotCount = integer(requirements?.slotCount)
  const rows = Array.isArray(requirements?.constraints) ? requirements.constraints : []
  const issues = []
  if (!slotCount || slotCount > 30) issues.push(issue('slot-count-unknown', String(requirements?.slotCount ?? 'missing')))
  if (requirements?.status && requirements.status !== 'complete') issues.push(issue('requirements-incomplete', text(requirements.status)))
  if (!rows.length) issues.push(issue('requirements-missing'))
  const rules = rows.flatMap(row => {
    const normalized = normalizeConstraint(row)
    if (normalized.issue) { issues.push(normalized.issue); return [] }
    if (['attribute-count', 'distinct-count', 'same-count', 'quality-count'].includes(normalized.rule.type)
      && normalized.rule.min > slotCount && slotCount) { issues.push(issue('rule-exceeds-slot-count', normalized.rule.type)); return [] }
    return [normalized.rule]
  })
  return { kind: 'fc-sbc-puzzle-rules', status: issues.length ? 'blocked' : 'ready', slotCount: slotCount ?? 0, rules, issues }
}

const normalizeCard = row => {
  const instanceId = text(row?.instanceId)
  const cardVersionId = text(row?.cardVersionId)
  if (!instanceId || !cardVersionId) return null
  const card = { instanceId, cardVersionId, source: text(row.source) || 'club', locked: row.locked === true,
    reserveValue: integer(row.reserveValue) ?? 0, rating: integer(row.rating), quality: text(row.quality).toLowerCase(),
    nationId: text(row.nationId), leagueId: text(row.leagueId), clubId: text(row.clubId), chemistry: integer(row.chemistry) }
  return card
}

const metric = (cards, rule, evaluateChemistry, evaluateSquadRating) => {
  if (rule.type === 'attribute-count') return cards.filter(card => rule.values.includes(card[rule.field])).length
  if (rule.type === 'distinct-count') return new Set(cards.map(card => card[rule.field])).size
  if (rule.type === 'same-count') return Math.max(0, ...Object.values(cards.reduce((all, card) => {
    all[card[rule.field]] = (all[card[rule.field]] ?? 0) + 1
    return all
  }, {})))
  if (rule.type === 'quality-count') return cards.filter(card => card.quality === rule.quality).length
  if (rule.type === 'minimum-quality') return Math.min(...cards.map(card => qualityRank[card.quality] ?? 0))
  if (rule.type === 'card-rating') return Math.min(...cards.map(card => card.rating))
  if (rule.type === 'squad-rating') {
    if (rule.model === 'verified-evaluator') return evaluateSquadRating(cards)
    const avg = cards.reduce((sum, card) => sum + card.rating, 0) / cards.length
    return rule.model === 'average-rounded' ? Math.round(avg) : Math.floor(avg)
  }
  if (rule.type === 'chemistry') return evaluateChemistry(cards)
  return null
}

const requiredKnown = (card, rule) => {
  if (['attribute-count', 'distinct-count', 'same-count'].includes(rule.type)) return Boolean(card[rule.field])
  if (['card-rating', 'squad-rating'].includes(rule.type)) return card.rating !== null
  if (['quality-count', 'minimum-quality'].includes(rule.type)) return Boolean(qualityRank[card.quality])
  if (rule.type === 'chemistry') return true
  return false
}

const byCost = (left, right) => left.reserveValue - right.reserveValue || left.rating - right.rating || left.instanceId.localeCompare(right.instanceId)

const diversePool = (cards, limit, rules = []) => {
  const selected = []
  const selectedIds = new Set()
  const add = card => {
    if (selected.length < limit && !selectedIds.has(card.instanceId)) {
      selected.push(card)
      selectedIds.add(card.instanceId)
    }
  }
  // Include required nation/league/club values before generic filling. This makes OR-style
  // requirements observable even when a large inventory has many unrelated buckets.
  for (const rule of rules.filter(rule => rule.type === 'attribute-count' && rule.min > 0)) {
    for (const value of rule.values) {
      cards.filter(card => card[rule.field] === value).sort(byCost).slice(0, rule.min).forEach(add)
    }
  }
  // Same-count requirements need several cards from the same identity bucket. Attribute
  // requirements are pinned first; choose overlapping viable buckets first so a full pool
  // still preserves combinations such as Portugal + three from one club.
  for (const rule of rules.filter(rule => rule.type === 'same-count' && rule.min > 1)) {
    const groups = new Map()
    for (const card of cards) {
      const value = card[rule.field]
      if (!value) continue
      const rows = groups.get(value) ?? []
      rows.push(card)
      groups.set(value, rows)
    }
    const viable = [...groups.values()].filter(rows => rows.length >= rule.min)
      .map(rows => rows.sort(byCost)).sort((left, right) => {
        const rightOverlap = right.filter(card => selectedIds.has(card.instanceId)).length
        const leftOverlap = left.filter(card => selectedIds.has(card.instanceId)).length
        return rightOverlap - leftOverlap || byCost(left[0], right[0])
      })
    for (const rows of viable.slice(0, Math.max(1, Math.floor(limit / rule.min)))) {
      rows.slice(0, rule.min).forEach(add)
    }
  }
  const buckets = new Map()
  for (const card of cards) {
    const key = [card.nationId || '?', card.leagueId || '?', card.clubId || '?', card.quality || '?'].join('|')
    const rows = buckets.get(key) ?? []
    rows.push(card)
    buckets.set(key, rows)
  }
  for (const rows of buckets.values()) rows.sort(byCost)
  const ordered = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right))
  for (let offset = 0; selected.length < limit; offset += 1) {
    let added = false
    for (const [, rows] of ordered) {
      if (rows[offset] && !selectedIds.has(rows[offset].instanceId)) { add(rows[offset]); added = true }
      if (selected.length === limit) break
    }
    if (!added) break
  }
  return selected
}

const valid = (cards, rules, evaluateChemistry, evaluateSquadRating) => rules.every(rule => {
  if (cards.some(card => !requiredKnown(card, rule))) return false
  const value = metric(cards, rule, evaluateChemistry, evaluateSquadRating)
  if (!Number.isSafeInteger(value) || value < 0) return false
  if (rule.type === 'minimum-quality') return value >= qualityRank[rule.quality]
  return value >= rule.min && value <= rule.max
})

const candidateId = cards => `owned-${cards.map(card => card.instanceId).sort().join('-')}`

export const generateSbcPuzzleCandidates = input => {
  const compiled = compileSbcPuzzleRequirements(input?.requirements)
  const issues = [...compiled.issues]
  const coverage = text(input?.coverage)
  if (coverage !== 'complete') issues.unshift(issue('inventory-coverage-incomplete', coverage || 'unread'))
  const cards = (Array.isArray(input?.cards) ? input.cards : []).map(normalizeCard).filter(Boolean).filter(card => !card.locked)
  if (!cards.length) issues.push(issue('eligible-inventory-empty'))
  const chemistryRequired = compiled.rules.some(rule => rule.type === 'chemistry')
  if (chemistryRequired && typeof input?.evaluateChemistry !== 'function') issues.push(issue('chemistry-evaluator-missing'))
  const nativeSquadRatingRequired = compiled.rules.some(rule => rule.type === 'squad-rating' && rule.model === 'verified-evaluator')
  if (nativeSquadRatingRequired && typeof input?.evaluateSquadRating !== 'function') issues.push(issue('squad-rating-evaluator-missing'))
  const provisionalCodes = new Set(['inventory-coverage-incomplete', 'chemistry-model-unknown', 'squad-rating-model-unknown', 'chemistry-evaluator-missing', 'squad-rating-evaluator-missing', 'squad-rating-evaluator-unknown'])
  const hardIssues = issues.filter(row => !provisionalCodes.has(row.code))
  if (hardIssues.length) return { kind: 'fc-sbc-puzzle-candidates', status: 'blocked', candidates: [], provisional: null, issues,
    summary: { searched: 0, eligibleCardCount: cards.length, poolCardCount: 0, poolComplete: true, poolStrategy: 'round-robin-attribute-buckets', inventoryCoverage: coverage,
      searchComplete: false, searchIncompleteReasons: ['search-not-run'] } }

  const limit = integer(input?.candidateLimit) || 12
  const searchLimit = integer(input?.searchLimit) || 25_000
  const rulesForSearch = compiled.rules.filter(rule => (rule.type !== 'chemistry' || typeof input?.evaluateChemistry === 'function')
    && (rule.type !== 'squad-rating' || rule.model !== 'verified-evaluator' || typeof input?.evaluateSquadRating === 'function'))
  // Full-club combinations explode. Pin rule-critical groups, then round-robin the remaining
  // identity buckets. DFS therefore starts with different requirement-relevant prefixes.
  const pool = diversePool(cards, 36, rulesForSearch)
  const candidates = []
  let searched = 0
  let unknownSquadRating = false
  const squadRating = selectedCards => {
    const value = input.evaluateSquadRating(selectedCards)
    if (!Number.isSafeInteger(value) || value < 0) unknownSquadRating = true
    return value
  }
  const walk = (start, selected) => {
    if (searched >= searchLimit || candidates.length >= limit) return
    if (selected.length === compiled.slotCount) {
      searched += 1
      if (valid(selected, rulesForSearch, input.evaluateChemistry, squadRating)) candidates.push({ candidateId: candidateId(selected), cards: selected.map(card => ({ instanceId: card.instanceId })) })
      return
    }
    for (let index = start; index <= pool.length - (compiled.slotCount - selected.length); index += 1) {
      walk(index + 1, [...selected, pool[index]])
      if (searched >= searchLimit || candidates.length >= limit) return
    }
  }
  walk(0, [])
  if (unknownSquadRating) issues.push(issue('squad-rating-evaluator-unknown'))
  if (!candidates.length && coverage === 'complete') {
    if (pool.length !== cards.length) issues.push(issue('search-incomplete', 'candidate pool is bounded'))
    else if (searched >= searchLimit) issues.push(issue('candidate-search-limit-reached'))
    else issues.push(issue('no-verifiable-candidate'))
  }
  const provisional = issues.some(row => provisionalCodes.has(row.code))
  const searchIncompleteReasons = [
    ...(pool.length !== cards.length ? ['candidate-pool-bounded'] : []),
    ...(searched >= searchLimit ? ['candidate-search-limit-reached'] : []),
    ...(candidates.length >= limit ? ['candidate-limit-reached'] : []),
  ]
  return { kind: 'fc-sbc-puzzle-candidates', status: candidates.length && !provisional ? 'ready' : 'blocked', candidates,
    provisional: provisional ? { status: 'provisional', reasonCodes: issues.filter(row => provisionalCodes.has(row.code)).map(row => row.code), candidates: clone(candidates) } : null, issues,
    summary: { searched, eligibleCardCount: cards.length, poolCardCount: pool.length, poolComplete: pool.length === cards.length, poolStrategy: 'round-robin-attribute-buckets', inventoryCoverage: coverage,
      searchComplete: searchIncompleteReasons.length === 0, searchIncompleteReasons } }
}

const pickChallenges = read => (read?.group?.sets ?? []).flatMap(set => set?.challenges ?? [])
const readCards = read => Array.isArray(read?.inventory?.cards) ? read.inventory.cards : []

export const createSbcPuzzlePlanInput = input => {
  const read = input?.read ?? input
  const coverage = text(read?.inventory?.coverage)
  const cards = readCards(read)
  const challengeRows = Array.isArray(input?.challenges) ? input.challenges : pickChallenges(read)
  const pendingChallengeRows = challengeRows.filter(row => row?.completed !== true)
  const completedChallengeCount = challengeRows.length - pendingChallengeRows.length
  const issues = []
  if (!text(input?.fcYear) || !text(input?.platform) || !text(input?.groupId)) issues.push(issue('plan-identity-missing'))
  if (coverage !== 'complete') issues.push(issue('inventory-coverage-incomplete', coverage || 'unread'))
  if (!challengeRows.length) issues.push(issue('challenge-set-empty'))
  if (challengeRows.length && !pendingChallengeRows.length) issues.push(issue('all-challenges-completed'))
  const provisionalByChallenge = []
  const searchIncompleteChallenges = []
  const challenges = pendingChallengeRows.flatMap(row => {
    const challengeId = text(row?.challengeId)
    const requirements = row?.requirements
    if (!challengeId) { issues.push(issue('challenge-identity-missing')); return [] }
    const result = generateSbcPuzzleCandidates({ coverage, cards, requirements: { ...requirements, slotCount: requirements?.slotCount ?? row?.slotCount },
      evaluateChemistry: typeof input?.evaluateChemistry === 'function'
        ? selectedCards => input.evaluateChemistry(selectedCards, challengeId)
        : undefined,
      evaluateSquadRating: typeof input?.evaluateSquadRating === 'function'
        ? selectedCards => input.evaluateSquadRating(selectedCards, challengeId)
        : undefined,
      candidateLimit: Math.max(integer(input?.candidateLimit) || 0, 12), searchLimit: input?.searchLimit })
    for (const rowIssue of result.issues) issues.push({ ...rowIssue, challengeId })
    if (!result.summary.searchComplete) {
      searchIncompleteChallenges.push({ challengeId, reasonCodes: result.summary.searchIncompleteReasons })
    }
    if (result.provisional) {
      provisionalByChallenge.push({ challengeId, candidateCount: result.provisional.candidates.length,
        reasonCodes: [...new Set(result.provisional.reasonCodes)].sort() })
    }
    if (result.status !== 'ready') return []
    return [{ challengeId, slotCount: compileSbcPuzzleRequirements({ ...requirements, slotCount: requirements?.slotCount ?? row?.slotCount }).slotCount,
      candidates: result.candidates }]
  })
  const summary = extra => ({ challengeCount: challengeRows.length, completedChallengeCount, pendingChallengeCount: pendingChallengeRows.length,
    readyChallengeCount: challenges.length, inventoryCoverage: coverage, searchComplete: searchIncompleteChallenges.length === 0,
    searchIncompleteChallenges, ...extra })
  if (issues.length || challenges.length !== pendingChallengeRows.length) {
    return { kind: 'fc-sbc-puzzle-plan-input', status: 'blocked', issues, planInput: null,
      provisionalByChallenge, summary: summary({}) }
  }
  const planInput = { fcYear: input.fcYear, platform: input.platform, groupId: input.groupId,
    inventory: cards.map(normalizeCard).filter(Boolean).map(card => ({ instanceId: card.instanceId, cardVersionId: card.cardVersionId,
      locked: card.locked, reserveValue: card.reserveValue })), quotes: Array.isArray(input.quotes) ? clone(input.quotes) : [], challenges,
    ...(integer(input.totalBudget) !== null ? { totalBudget: input.totalBudget } : {}), ...(integer(input.variantLimit) !== null ? { variantLimit: input.variantLimit } : {}) }
  const variants = buildSbcPlanVariants(planInput)
  if (!variants.length) return { kind: 'fc-sbc-puzzle-plan-input', status: 'blocked', issues: [issue(searchIncompleteChallenges.length ? 'cross-challenge-search-incomplete' : 'no-cross-challenge-plan')], planInput: null,
    provisionalByChallenge, summary: summary({}) }
  return { kind: 'fc-sbc-puzzle-plan-input', status: 'ready', issues: [], planInput, provisionalByChallenge,
    summary: summary({ variantCount: variants.length }) }
}

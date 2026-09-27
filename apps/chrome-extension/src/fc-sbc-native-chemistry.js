/**
 * MAIN-world, read-only FC chemistry evaluator.  It deliberately accepts only
 * fixed 11-card candidates and returns JSON-safe evidence; it never changes a
 * squad or calls SBC/market write APIs.
 */
export const evaluateFcSbcChemistryMain = async (input = {}) => {
  const compact = value => String(value ?? '').replace(/\s+/gu, ' ').trim()
  const id = value => compact(value) || null
  const integer = value => Number.isInteger(Number(value)) ? Number(value) : null
  const bounded = (value, fallback, low, high) => Math.max(low, Math.min(high, integer(value) ?? fallback))
  const maxGroups = bounded(input.maxGroups, 8, 1, 16)
  const maxCandidates = bounded(input.maxCandidates, 16, 1, 64)
  const maxUniqueItems = bounded(input.maxUniqueItems, 256, 11, 512)
  const batchSize = bounded(input.batchSize, 100, 11, 100)
  const timeoutMs = bounded(input.timeoutMs, 5_000, 250, 10_000)
  const url = id(input.url) ?? String(globalThis.location?.href ?? '')
  const issues = []
  const addIssue = (code, detail) => issues.push({ code, detail: compact(detail).slice(0, 240) || code })
  const awaitService = async value => {
    if (value && typeof value.then === 'function') return await value
    if (!value || typeof value.observe !== 'function') return value
    return await new Promise((resolve, reject) => {
      const owner = {}; let settled = false
      const detach = observer => {
        try { observer?.unobserve?.(owner) } catch {}
        try { value?.unobserve?.(owner) } catch {}
      }
      const timer = globalThis.setTimeout(() => {
        if (!settled) { settled = true; detach(); reject(new Error('EA observable read timed out')) }
      }, timeoutMs)
      try {
        value.observe(owner, (observer, payload) => {
          if (settled) { detach(observer); return }
          settled = true; globalThis.clearTimeout(timer); detach(observer)
          resolve(payload ?? {})
        })
      } catch (error) {
        if (!settled) { settled = true; globalThis.clearTimeout(timer); detach(); reject(error) }
      }
    })
  }
  const body = value => value?.response ?? value?.data ?? value ?? {}
  const rows = value => {
    const source = body(value)
    for (const candidate of [source?.items, source?.itemData, source?.cards, source?.data?.items, source?.data?.itemData, source?.data?.cards]) {
      if (Array.isArray(candidate)) return candidate
    }
    return null
  }
  const itemId = item => id(item?.id ?? item?.itemId ?? item?.instanceId)
  const positionTypes = item => {
    let possible
    try { possible = typeof item?.getPossiblePositions === 'function' ? item.getPossiblePositions() : item?.possiblePositions } catch { possible = null }
    if (!Array.isArray(possible)) return null
    const values = possible.map(position => id(position?.typeId ?? position?.id ?? position)).filter(Boolean)
    return values.length ? new Set(values) : null
  }
  const candidateIssue = (code, detail) => ({ code, detail: compact(detail).slice(0, 240) || code })
  const rawGroups = Array.isArray(input.groups) ? input.groups.slice(0, maxGroups) : []
  if (!Array.isArray(input.groups)) addIssue('groups-invalid', 'groups must be an array')
  if (Array.isArray(input.groups) && input.groups.length > maxGroups) addIssue('groups-truncated', 'group limit reached')
  const candidates = []
  for (const group of rawGroups) {
    const challengeId = id(group?.challengeId); const formationName = id(group?.formationName)
    const groupCandidates = Array.isArray(group?.candidates) ? group.candidates.slice(0, maxCandidates) : []
    if (!challengeId || !formationName) {
      addIssue('group-identity-invalid', 'challengeId and formationName are required')
      continue
    }
    if (!Array.isArray(group?.candidates)) addIssue('group-candidates-invalid', `${challengeId} candidates must be an array`)
    if (Array.isArray(group?.candidates) && group.candidates.length > maxCandidates) addIssue('candidates-truncated', `${challengeId} candidate limit reached`)
    for (const candidate of groupCandidates) candidates.push({
      challengeId, formationName, candidateId: id(candidate?.candidateId),
      instanceIds: Array.isArray(candidate?.instanceIds) ? candidate.instanceIds.map(id).filter(Boolean) : null,
      expectedCards: Array.isArray(candidate?.expectedCards) ? candidate.expectedCards.map(card => ({
        instanceId: id(card?.instanceId), cardVersionId: id(card?.cardVersionId), rating: Number(card?.rating),
        nationId: id(card?.nationId), leagueId: id(card?.leagueId), clubId: id(card?.clubId), quality: id(card?.quality)?.toLowerCase() ?? null,
      })) : null,
    })
  }
  const uniqueIds = [...new Set(candidates.flatMap(candidate => candidate.instanceIds ?? []))]
  const nativeItems = new Map()
  const itemService = globalThis.services?.Item
  if (uniqueIds.length > maxUniqueItems) addIssue('native-item-limit-exceeded', 'unique item limit exceeded')
  else if (uniqueIds.length && typeof itemService?.requestItemsById !== 'function') addIssue('native-item-service-unavailable', 'services.Item.requestItemsById is unavailable')
  else {
    for (let index = 0; index < uniqueIds.length; index += batchSize) {
      const batch = uniqueIds.slice(index, index + batchSize)
      try {
        const found = rows(await awaitService(itemService.requestItemsById(batch)))
        if (!found) { addIssue('native-item-response-unrecognized', 'requestItemsById returned no item array'); break }
        for (const item of found) { const key = itemId(item); if (key) nativeItems.set(key, item) }
      } catch (error) { addIssue('native-item-read-failed', error?.message ?? 'requestItemsById failed'); break }
    }
  }
  const formations = (() => {
    try { return globalThis.repositories?.Squad?.getFormations?.() } catch { return null }
  })()
  const formationByName = name => Array.isArray(formations) ? formations.find(formation => id(formation?.name) === name) : null
  if (!Array.isArray(formations)) addIssue('formation-repository-unavailable', 'repositories.Squad.getFormations is unavailable')
  const calculate = (formation, orderedItems) => {
    const Calculator = globalThis.UTSquadChemCalculatorUtils; const NullItem = globalThis.UTNullItemEntity
    if (typeof Calculator !== 'function' || typeof NullItem !== 'function' || !globalThis.services?.Chemistry || !globalThis.repositories?.TeamConfig) return null
    let result
    try { result = new Calculator(globalThis.services.Chemistry, globalThis.repositories.TeamConfig).calculate(formation, orderedItems, new NullItem()) } catch { return null }
    const chemistry = Number(result?.chemistry)
    if (!Number.isFinite(chemistry)) return null
    let slots
    if (typeof result?.getSlotChemistry === 'function') {
      try {
        slots = Array.from({ length: 11 }, (_, slot) => ({ slot, instanceId: itemId(orderedItems[slot]), chemistry: Number(result.getSlotChemistry(slot)?.value?.()) }))
      } catch { return null }
    } else {
      const playerRows = Array.isArray(result?.players) ? result.players : Array.isArray(result?.playerChemistry) ? result.playerChemistry : null
      if (!Array.isArray(playerRows) || playerRows.length !== 11) return null
      slots = playerRows.map((player, slot) => ({ slot, instanceId: itemId(player) ?? itemId(orderedItems[slot]), chemistry: Number(player?.chemistry) }))
    }
    if (slots.length !== 11 || slots.some(slot => !Number.isFinite(slot.chemistry))) return null
    return { chemistry, slots }
  }
  const ratingFlag = () => {
    const configuration = globalThis.services?.Configuration
    const key = globalThis.UTServerSettingsRepository?.KEY?.SQUAD_RATING_FLOAT_CALCULATION_ENABLED
    if (typeof configuration?.checkFeatureEnabled !== 'function' || key === undefined) return null
    try {
      const value = configuration.checkFeatureEnabled(key)
      return typeof value === 'boolean' ? value : null
    } catch { return null }
  }
  const calculateSquadRating = orderedItems => {
    const floatEnabled = ratingFlag()
    const ratings = orderedItems.map(item => Number(item?.rating ?? item?.overallRating))
    if (floatEnabled === null || ratings.length !== 11 || ratings.some(rating => !Number.isFinite(rating) || rating < 0 || rating > 99)) {
      return { status: 'unknown', value: null }
    }
    const sum = ratings.reduce((total, rating) => total + rating, 0)
    const average = floatEnabled ? sum / 11 : Math.floor(sum / 11)
    const boost = ratings.reduce((total, rating) => total + Math.max(0, rating - average), 0)
    const numerator = floatEnabled ? Math.round(sum + boost) : sum + Math.floor(boost)
    return { status: 'complete', value: Math.max(0, Math.min(99, Math.floor(numerator / 11))) }
  }
  const assign = (formation, cards) => {
    const slotTypes = []
    for (let slot = 0; slot < 11; slot += 1) {
      let type
      try { type = id(formation.getPosition?.(slot)?.typeId) } catch { type = null }
      if (!type) return null
      slotTypes.push(type)
    }
    const scores = slotTypes.map(type => cards.map(card => positionTypes(card)?.has(type) ? 1 : 0))
    const memo = new Map()
    const best = (slot, used) => {
      if (slot === 11) return { score: 0, order: [] }
      const key = `${slot}:${used}`
      if (memo.has(key)) return memo.get(key)
      let winner = null
      for (let card = 0; card < 11; card += 1) {
        if (used & (1 << card)) continue
        const tail = best(slot + 1, used | (1 << card))
        const choice = { score: scores[slot][card] + tail.score, order: [card, ...tail.order] }
        if (!winner || choice.score > winner.score) winner = choice
      }
      memo.set(key, winner); return winner
    }
    const selected = best(0, 0)
    return selected ? { cards: selected.order.map(card => cards[card]), onPositionCount: selected.score } : null
  }
  const nativeQuality = native => {
    try {
      if (typeof native?.hasQualityTiers === 'function' && native.hasQualityTiers() !== true) return null
      if (typeof native?.getTier !== 'function') return null
      const tier = native.getTier()
      const mapped = globalThis.SBCEligibilityQualityType?.[tier]
      const quality = id(mapped)?.toLowerCase()
      return ['bronze', 'silver', 'gold'].includes(quality) ? quality : null
    } catch { return null }
  }
  const snapshotMatches = (expected, native, quality) => expected.instanceId === itemId(native)
    && expected.cardVersionId === id(native?.definitionId)
    && expected.rating === Number(native?.rating ?? native?.overallRating)
    && expected.nationId === id(native?.nationId)
    && expected.leagueId === id(native?.leagueId)
    && expected.clubId === id(native?.teamId)
    && expected.quality === quality
  const results = candidates.map(candidate => {
    const localIssues = []
    if (!candidate.candidateId) localIssues.push(candidateIssue('candidate-identity-invalid', 'candidateId is required'))
    if (!candidate.instanceIds || candidate.instanceIds.length !== 11 || new Set(candidate.instanceIds).size !== 11) localIssues.push(candidateIssue('candidate-cards-invalid', 'candidate requires 11 distinct instanceIds'))
    if (candidate.expectedCards && (!candidate.instanceIds || candidate.expectedCards.length !== 11
      || candidate.expectedCards.some((card, index) => !card.instanceId || !card.cardVersionId || !Number.isFinite(card.rating)
        || !card.nationId || !card.leagueId || !card.clubId || !card.quality || card.instanceId !== candidate.instanceIds[index]))) {
      localIssues.push(candidateIssue('expected-cards-invalid', 'expectedCards must contain the 11 candidate cards in order'))
    }
    const formation = formationByName(candidate.formationName)
    if (!formation) localIssues.push(candidateIssue('formation-unavailable', `formation ${candidate.formationName} is unavailable`))
    const cards = candidate.instanceIds?.map(key => nativeItems.get(key)) ?? []
    if (candidate.instanceIds && cards.some(card => !card)) localIssues.push(candidateIssue('native-item-missing', 'one or more candidate cards were not returned by EA'))
    const qualities = candidate.expectedCards && !localIssues.length ? cards.map(nativeQuality) : null
    if (!localIssues.length && qualities?.some(quality => quality === null)) {
      localIssues.push(candidateIssue('native-quality-unrecognized', 'a native card quality tier could not be classified'))
    }
    if (!localIssues.length && candidate.expectedCards && cards.some((card, index) => !snapshotMatches(candidate.expectedCards[index], card, qualities[index]))) {
      localIssues.push(candidateIssue('native-item-changed', 'a native card no longer matches the solver snapshot'))
    }
    if (!localIssues.length && cards.some(card => !positionTypes(card))) localIssues.push(candidateIssue('native-position-unrecognized', 'one or more native cards have no possiblePositions'))
    const assigned = localIssues.length ? null : assign(formation, cards)
    if (!localIssues.length && !assigned) localIssues.push(candidateIssue('position-assignment-unverified', 'no valid 11-slot assignment was found from native possiblePositions'))
    const squadRating = assigned ? calculateSquadRating(assigned.cards) : null
    const evaluation = !localIssues.length ? calculate(formation, assigned.cards) : null
    if (!localIssues.length && !evaluation) localIssues.push(candidateIssue('native-chemistry-unavailable', 'native chemistry calculator did not return a finite score'))
    const base = { challengeId: candidate.challengeId, candidateId: candidate.candidateId ?? null, status: localIssues.length ? 'blocked' : 'complete', issues: localIssues,
      ...(squadRating ? { squadRating: squadRating.value, squadRatingStatus: squadRating.status } : {}) }
    return evaluation ? { ...base, chemistry: evaluation.chemistry, onPositionCount: assigned.onPositionCount, instanceIds: assigned.cards.map(itemId), slots: evaluation.slots } : base
  })
  const status = !results.length && issues.length ? 'unknown' : results.every(result => result.status === 'complete') && !issues.length ? 'complete' : 'partial'
  return { url, status, issues, results }
}

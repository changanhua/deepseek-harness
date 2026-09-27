/**
 * Self-contained MAIN-world reader for FC Web App services.  It performs only
 * service reads and returns JSON-safe data; no SBC, market, or squad mutation
 * is reachable from this function.
 */
export const readFcSbcMain = async (input = {}) => {
  const compact = value => String(value ?? '').replace(/\s+/gu, ' ').trim()
  const textId = value => {
    const text = compact(value)
    return text || null
  }
  const number = value => value === null || value === undefined || value === ''
    ? null : Number.isFinite(Number(value)) ? Number(value) : null
  const bool = value => value === true
  const maxPages = Math.max(1, Math.min(32, Math.floor(number(input.maxPages) ?? 8)))
  const maxItems = Math.max(1, Math.min(2_000, Math.floor(number(input.maxItems) ?? 1_000)))
  const pageSize = Math.max(1, Math.min(100, Math.floor(number(input.pageSize) ?? 100)))
  const readTimeoutMs = Math.max(250, Math.min(10_000, Math.floor(number(input.readTimeoutMs) ?? 5_000)))
  const issues = []
  const issue = (code, detail) => issues.push({ code, detail: compact(detail).slice(0, 240) || code })
  const services = globalThis.services
  const awaitService = async value => {
    if (value && typeof value.then === 'function') return await value
    if (!value || typeof value.observe !== 'function') return value
    return await new Promise((resolve, reject) => {
      const owner = {}
      let settled = false
      const unobserve = observer => {
        try { observer?.unobserve?.(owner) } catch {}
        if (observer !== value) {
          try { value.unobserve?.(owner) } catch {}
        }
      }
      const timer = globalThis.setTimeout(() => {
        if (settled) return
        settled = true
        unobserve(value)
        reject(new Error('EA observable read timed out'))
      }, readTimeoutMs)
      try {
        value.observe(owner, (observer, payload) => {
          if (settled) {
            unobserve(observer)
            return
          }
          settled = true
          globalThis.clearTimeout(timer)
          unobserve(observer)
          resolve(payload ?? {})
        })
      } catch (error) {
        if (!settled) {
          settled = true
          globalThis.clearTimeout(timer)
          unobserve(value)
          reject(error)
        }
      }
    })
  }
  const resultBody = result => result?.response ?? result?.data ?? result ?? {}
  const itemsOf = result => {
    const body = resultBody(result)
    for (const value of [body?.items, body?.itemData, body?.cards, body?.data?.items]) if (Array.isArray(value)) return value
    return null
  }
  const endOf = result => {
    const body = resultBody(result)
    return body?.retrievedAll === true || body?.endOfList === true || body?.pagination?.retrievedAll === true
      || body?.isLastPage === true || body?.pagination?.isLastPage === true
  }
  const url = String(input.href ?? globalThis.location?.href ?? '')
  const capturedAt = compact(input.capturedAt) || new Date().toISOString()
  const platform = (() => {
    try {
      const direct = textId(services?.User?.platform ?? services?.User?.currentUser?.platform ?? services?.User?.session?.platform)
      if (direct) return direct
      const user = typeof services?.User?.getUser === 'function' ? services.User.getUser() : null
      const personas = user?._personas?._collection
      const list = personas && typeof personas === 'object' ? Object.values(personas) : []
      if (list.length === 1) return textId(list[0]?.platform)
      const selected = textId(user?.selectedPersona ?? user?.selectedPersonaId ?? user?._selectedPersonaId)
      const persona = selected ? list.find(candidate => textId(candidate?.id ?? candidate?.personaId) === selected) : null
      return textId(persona?.platform)
    } catch { return null }
  })()
  const enumName = (kind, value) => {
    const refs = kind === 'key'
      ? [globalThis.SBCEligibilityKey, globalThis.SBCEligibilityKeyEnum, services?.SBC?.SBCEligibilityKey, services?.SBC?.SBCEligibilityKeyEnum, services?.SBC?.eligibilityKeyEnum]
      : kind === 'scope'
        ? [globalThis.SBCEligibilityScope, services?.SBC?.SBCEligibilityScope]
        : [globalThis.SBCEligibilityQualityType, services?.SBC?.SBCEligibilityQualityType]
    for (const ref of refs) {
      const name = ref?.[value]
      if (textId(name)) return compact(name).toUpperCase()
    }
    return null
  }

  const createClubCriteria = () => {
    try {
      const Model = globalThis.UTBucketedItemSearchViewModel
      const model = typeof Model === 'function' ? new Model() : null
      return model?.searchCriteria ?? null
    } catch { return null }
  }
  const createStorageCriteria = () => {
    try {
      const Criteria = globalThis.UTSearchCriteriaDTO
      if (typeof Criteria !== 'function') return null
      const criteria = new Criteria()
      criteria.type = globalThis.SearchType?.PLAYER ?? criteria.type
      criteria.defId = []
      criteria.category = globalThis.SearchCategory?.ANY ?? criteria.category
      return criteria
    } catch { return null }
  }
  const readPaged = async (service, method, source, createCriteria) => {
    if (!service || typeof service[method] !== 'function') {
      issue(`${source}-service-unavailable`, `${source} service is unavailable`)
      return { status: 'unknown', pageCount: 0, retrievedAll: false, items: [] }
    }
    const criteria = createCriteria()
    if (!criteria || typeof criteria !== 'object') {
      issue(`${source}-criteria-unavailable`, `${source} search DTO is unavailable`)
      return { status: 'unknown', pageCount: 0, retrievedAll: false, items: [] }
    }
    const rows = []
    const seenInstanceIds = new Set()
    let offset = 0
    let pagesRead = 0
    for (let page = 0; page < maxPages && rows.length < maxItems; page += 1) {
      let response
      criteria.offset = offset
      criteria.count = pageSize
      try { response = await awaitService(service[method].call(service, criteria)) } catch (error) {
        issue(`${source}-read-failed`, error?.message ?? `${source} read failed`)
        return { status: rows.length ? 'partial' : 'unknown', pageCount: page, retrievedAll: false, items: rows }
      }
      pagesRead = page + 1
      const items = itemsOf(response)
      if (!items) {
        issue(`${source}-response-unrecognized`, `${source} response has no item array`)
        return { status: rows.length ? 'partial' : 'unknown', pageCount: page + 1, retrievedAll: false, items: rows }
      }
      for (const item of items) {
        const instanceId = textId(item?.id ?? item?.itemId ?? item?.instanceId)
        if (instanceId && seenInstanceIds.has(instanceId)) continue
        if (rows.length >= maxItems) {
          issue(`${source}-items-truncated`, `${source} page exceeded the configured item limit`)
          return { status: 'partial', pageCount: page + 1, retrievedAll: false, items: rows }
        }
        if (instanceId) seenInstanceIds.add(instanceId)
        rows.push(item)
      }
      if (endOf(response)) return { status: 'complete', pageCount: page + 1, retrievedAll: true, items: rows }
      if (!items.length) {
        issue(`${source}-pagination-end-unverified`, `${source} returned an empty page without explicit end evidence`)
        return { status: 'partial', pageCount: page + 1, retrievedAll: false, items: rows }
      }
      offset += items.length
    }
    issue(`${source}-pagination-end-unverified`, `${source} reached capture limit without explicit end evidence`)
    return { status: 'partial', pageCount: pagesRead, retrievedAll: false, items: rows }
  }

  const normalizeCard = (raw, source) => {
    const instanceId = textId(raw?.id ?? raw?.itemId ?? raw?.instanceId)
    const cardVersionId = textId(raw?.resourceId ?? raw?.definitionId ?? raw?.cardVersionId ?? raw?.baseId)
    if (!instanceId || !cardVersionId) {
      issue('inventory-card-identity-unrecognized', `${source} card has no stable instance or version identity`)
      return null
    }
    const rating = number(raw?.rating ?? raw?.overallRating)
    const isPlayer = (() => {
      try {
        if (typeof raw?.isPlayer === 'function') return bool(raw.isPlayer())
        if (typeof raw?.isPlayer === 'boolean') return raw.isPlayer
        return compact(raw?.type ?? raw?.itemType).toUpperCase() === 'PLAYER'
      } catch { return false }
    })()
    const tierQuality = (() => {
      try {
        if (!isPlayer || typeof raw?.getTier !== 'function' || raw?.hasQualityTiers?.() !== true) return null
        return enumName('quality', number(raw.getTier()))?.toLowerCase() ?? null
      } catch { return null }
    })()
    const declaredQuality = textId(raw?.quality ?? raw?.itemQuality)?.toLowerCase()
    const fallbackQuality = rating === null ? null : rating >= 75 ? 'gold' : rating >= 65 ? 'silver' : 'bronze'
    const quality = isPlayer ? tierQuality ?? declaredQuality ?? fallbackQuality : null
    return {
      instanceId, cardVersionId, source, rating,
      quality: quality?.toLowerCase() ?? null,
      nationId: textId(raw?.nationId ?? raw?.nation?.id),
      leagueId: textId(raw?.leagueId ?? raw?.league?.id),
      clubId: textId(raw?.clubId ?? raw?.teamId ?? raw?.club?.id),
      position: textId(raw?.position ?? raw?.preferredPosition ?? raw?.positionCode),
      tradeable: bool(raw?.tradeable ?? raw?.tradable ?? raw?.isTradeable),
      locked: bool(raw?.locked ?? raw?.isLocked),
    }
  }

  const normalizeRequirement = raw => {
    if (!raw || typeof raw !== 'object') return null
    const sourceType = compact(raw.type ?? raw.requirementType ?? raw.kind).toLowerCase()
    const scope = raw.scope ?? raw.getScope?.()
    const scopedCount = number(raw.count ?? raw.getCount?.())
    const minimum = number(raw.minimum ?? raw.min)
    const maximum = number(raw.maximum ?? raw.max)
    const exact = number(raw.exact)
    const values = (Array.isArray(raw.values) ? raw.values : [raw.value ?? raw.attributeValue])
      .map(textId).filter(Boolean)
    const quantity = exact === null ? (minimum === null ? maximum : minimum) : exact
    const bounds = {}
    if (minimum !== null) bounds.minimum = minimum
    if (maximum !== null) bounds.maximum = maximum
    if (exact !== null) bounds.exact = exact
    const scopeName = enumName('scope', scope) ?? compact(scope).toUpperCase()
    const boundFor = threshold => {
      const target = number(threshold)
      if (target === null || target < 0) return {}
      if (scopeName.includes('GREATER') || scopeName.includes('MIN')) return { minimum: target }
      if (scopeName.includes('LOWER') || scopeName.includes('MAX')) return { maximum: target }
      if (scopeName.includes('EXACT')) return { exact: target }
      return {}
    }
    Object.assign(bounds, boundFor(scopedCount))
    const pairCollection = raw.kvPairs?._collection
    const pairRows = Array.isArray(raw.kvPairs) ? raw.kvPairs
      : pairCollection && typeof pairCollection === 'object' ? Object.entries(pairCollection)
        : []
    const pair = pairRows.length === 1 ? pairRows[0] : null
    const pairKey = Array.isArray(pair) ? number(pair[0]) : number(pair?.key)
    const pairValue = Array.isArray(pair) ? pair[1] : pair?.value
    const pairValues = (Array.isArray(pairValue) ? pairValue : [pairValue]).map(textId).filter(Boolean)
    const keyName = enumName('key', pairKey)
    const pairBound = boundFor(number(pairValues[0]))
    if (keyName === 'NATION_ID' || keyName === 'LEAGUE_ID' || keyName === 'CLUB_ID') {
      const attribute = keyName === 'NATION_ID' ? 'nationId' : keyName === 'LEAGUE_ID' ? 'leagueId' : 'clubId'
      return pairValues.length && Object.keys(bounds).length ? { type: 'attribute-count', attribute, values: pairValues, ...bounds } : null
    }
    if (keyName === 'NATION_COUNT' || keyName === 'LEAGUE_COUNT' || keyName === 'CLUB_COUNT') {
      const attribute = keyName === 'NATION_COUNT' ? 'nationId' : keyName === 'LEAGUE_COUNT' ? 'leagueId' : 'clubId'
      return Object.keys(pairBound).length ? { type: 'distinct-count', attribute, ...pairBound } : null
    }
    if (keyName === 'SAME_NATION_COUNT' || keyName === 'SAME_LEAGUE_COUNT' || keyName === 'SAME_CLUB_COUNT') {
      const attribute = keyName === 'SAME_NATION_COUNT' ? 'nationId' : keyName === 'SAME_LEAGUE_COUNT' ? 'leagueId' : 'clubId'
      return Object.keys(pairBound).length ? { type: 'same-count', attribute, ...pairBound } : null
    }
    if (keyName === 'CHEMISTRY_POINTS' || keyName === 'ALL_PLAYERS_CHEMISTRY_POINTS') return Object.keys(pairBound).length ? { type: 'chemistry', ...pairBound } : null
    if (keyName === 'PLAYER_MIN_OVR' || keyName === 'PLAYER_EXACT_OVR' || keyName === 'PLAYER_MAX_OVR') {
      const ratingBounds = keyName === 'PLAYER_MIN_OVR' ? { minimum: number(pairValues[0]) }
        : keyName === 'PLAYER_EXACT_OVR' ? { exact: number(pairValues[0]) } : { maximum: number(pairValues[0]) }
      return Object.values(ratingBounds).every(value => value !== null) ? { type: 'card-rating', ...ratingBounds } : null
    }
    if (keyName === 'TEAM_RATING') return Object.keys(pairBound).length ? { type: 'squad-rating', ...pairBound } : null
    if (keyName === 'PLAYER_LEVEL') {
      const quality = enumName('quality', number(pairValues[0]))?.toLowerCase()
      return quality && Object.keys(bounds).length ? { type: 'quality-count', quality, ...bounds } : null
    }
    if (keyName === 'PLAYER_QUALITY') {
      const quality = enumName('quality', number(pairValues[0]))?.toLowerCase()
      if (!quality) return null
      return scopedCount === null || scopedCount < 0 ? { type: 'minimum-quality', quality }
        : Object.keys(bounds).length ? { type: 'quality-count', quality, ...bounds } : null
    }
    const attribute = /nation|country/u.test(sourceType) ? 'nationId'
      : /league/u.test(sourceType) ? 'leagueId'
        : /club|team/u.test(sourceType) ? 'clubId' : null
    if (attribute && values.length && quantity !== null) return { type: 'attribute-count', attribute, values, ...bounds }
    if (/distinct/u.test(sourceType) && attribute && quantity !== null) return { type: 'distinct-count', attribute, ...bounds }
    if (/same/u.test(sourceType) && attribute && quantity !== null) return { type: 'same-count', attribute, ...bounds }
    if (/minimum.?quality|minquality/u.test(sourceType) && values.length) return { type: 'minimum-quality', quality: values[0].toLowerCase() }
    if (/quality/u.test(sourceType) && values.length && quantity !== null) return { type: 'quality-count', quality: values[0].toLowerCase(), ...bounds }
    if (/card.?rating|player.?rating/u.test(sourceType) && quantity !== null) return { type: 'card-rating', ...bounds }
    if (/squad.?rating|team.?rating|overall/u.test(sourceType) && quantity !== null && textId(raw.model ?? raw.ratingModel)) return { type: 'squad-rating', model: textId(raw.model ?? raw.ratingModel), ...bounds }
    if (/chemistry/u.test(sourceType) && quantity !== null) return { type: 'chemistry', ...bounds }
    return null
  }

  const normalizeChallenge = raw => {
    const challengeId = textId(raw?.id ?? raw?.challengeId)
    const title = textId(raw?.name ?? raw?.title)
    if (!challengeId || !title) {
      issue('challenge-identity-unrecognized', 'challenge is missing a stable id or title')
      return null
    }
    const extractRequirements = (source, depth = 0) => {
      if (!source || depth > 2) return null
      if (Array.isArray(source)) return source
      const direct = source.eligibilityRequirements ?? source.requirements ?? source.requirementsList
        ?? (typeof source.getRequirements === 'function' ? source.getRequirements() : null)
      if (Array.isArray(direct)) return direct
      return extractRequirements(source.challenge ?? source.sbcChallenge ?? source.data?.challenge ?? source.data?.sbcChallenge, depth + 1)
    }
    const rawRequirements = extractRequirements(raw)
    const constraints = Array.isArray(rawRequirements) ? rawRequirements.map(normalizeRequirement).filter(Boolean) : []
    const requirementStatus = !Array.isArray(rawRequirements) ? 'unknown'
      : constraints.length === rawRequirements.length ? 'complete' : 'partial'
    if (requirementStatus !== 'complete') issue('challenge-requirements-unrecognized', `${challengeId} requirements cannot be fully classified`)
    const formation = compact(raw?.formation ?? raw?.squad?.formation)
    const formationName = /^f\d+$/iu.test(formation) ? formation : null
    const formationSlotCount = compact(raw?.type).toUpperCase() === 'OPEN_CHALLENGE' && /^f(\d+)$/iu.test(formation)
      ? formation.slice(1).split('').reduce((total, digit) => total + Number(digit), 1) : null
    const slotCount = number(raw?.slotCount ?? raw?.squadSize ?? raw?.requiredPlayers) ?? formationSlotCount
    return {
      challengeId, title, formationName,
      completed: bool(raw?.completed ?? raw?.isCompleted) || /^(?:completed|claimed|done)$/iu.test(compact(raw?.status)),
      requirements: { status: requirementStatus, ...(slotCount === null ? {} : { slotCount }), constraints },
      rewards: Array.isArray(raw?.rewards) ? raw.rewards.map(reward => ({ name: textId(reward?.name ?? reward?.title) })).filter(reward => reward.name) : [],
    }
  }

  const readGroup = async () => {
    const sbc = services?.SBC
    if (!sbc || typeof sbc.requestSets !== 'function') {
      issue('sbc-service-unavailable', 'SBC service is unavailable')
      return { status: 'unknown', selectedSetId: null, sets: [] }
    }
    let setRows = null
    try {
      const repository = sbc.sbcRepository ?? sbc.repository
      const repositorySets = typeof repository?.getSets === 'function' ? repository.getSets() : null
      setRows = Array.isArray(repositorySets) ? repositorySets : null
    } catch {}
    if (!setRows) {
      let setsResponse
      try { setsResponse = await awaitService(sbc.requestSets()) } catch (error) {
        issue('sbc-sets-read-failed', error?.message ?? 'SBC set read failed')
        return { status: 'unknown', selectedSetId: null, sets: [] }
      }
      setRows = itemsOf(setsResponse) ?? resultBody(setsResponse)?.sets
    }
    if (!Array.isArray(setRows)) {
      issue('sbc-sets-response-unrecognized', 'SBC set response has no set array')
      return { status: 'unknown', selectedSetId: null, sets: [] }
    }
    const groupHint = textId(input.groupHint)?.toLocaleLowerCase() ?? null
    const selectedSets = groupHint !== null
      ? setRows.filter(set => textId(set?.name ?? set?.title)?.toLocaleLowerCase() === groupHint)
      : setRows.length === 1 ? setRows : []
    if (groupHint !== null && !selectedSets.length) {
      issue('group-hint-unmatched', 'SBC group hint did not exactly match a returned set')
      return { status: 'partial', selectedSetId: null, sets: [] }
    }
    if (groupHint === null && setRows.length !== 1) {
      issue('group-identity-unverified', 'current page did not provide one exact SBC group identity')
      return { status: 'partial', selectedSetId: null, sets: [] }
    }
    const wantedTitles = Array.isArray(input.challengeTitles) ? new Set(input.challengeTitles.map(title => compact(title)).filter(Boolean)) : null
    const sets = []
    let complete = true
    for (const set of selectedSets) {
      const setId = textId(set?.id ?? set?.setId); const title = textId(set?.name ?? set?.title)
      if (!setId || !title || typeof sbc.requestChallengesForSet !== 'function' || typeof sbc.loadChallenge !== 'function') {
        issue('sbc-challenge-service-unavailable', 'SBC challenge read service is unavailable')
        complete = false; continue
      }
      let challengeResponse
      try { challengeResponse = await awaitService(sbc.requestChallengesForSet(set)) } catch (error) {
        issue('sbc-challenges-read-failed', error?.message ?? 'SBC challenge list read failed')
        complete = false; continue
      }
      const challengeRows = itemsOf(challengeResponse) ?? resultBody(challengeResponse)?.challenges
        ?? (typeof set.getChallenges === 'function' ? set.getChallenges() : null)
      if (!Array.isArray(challengeRows)) {
        issue('sbc-challenges-response-unrecognized', `${setId} has no challenge array`)
        complete = false; continue
      }
      const selectedChallenges = wantedTitles === null ? challengeRows : challengeRows.filter(row => wantedTitles.has(compact(row?.name ?? row?.title)))
      if (wantedTitles !== null && selectedChallenges.length !== wantedTitles.size) {
        issue('challenge-title-unmatched', `${setId} did not return every requested challenge title`)
        complete = false
      }
      const challenges = []
      for (const challenge of selectedChallenges) {
        const hasLocalRequirements = Array.isArray(challenge?.eligibilityRequirements) || Array.isArray(challenge?.requirements)
        let detail = challenge
        if (!hasLocalRequirements) {
          let loaded
          try { loaded = await awaitService(sbc.loadChallenge(challenge)) } catch (error) {
            issue('sbc-challenge-read-failed', error?.message ?? 'SBC challenge detail read failed')
            complete = false; continue
          }
          detail = { ...challenge, ...(resultBody(loaded)?.challenge ?? resultBody(loaded)) }
        }
        const normalized = normalizeChallenge(detail)
        if (normalized) {
          challenges.push(normalized)
          if (normalized.requirements.status !== 'complete') complete = false
        } else complete = false
      }
      sets.push({ setId, title, challenges })
    }
    return { status: complete ? 'complete' : 'partial', selectedSetId: sets[0]?.setId ?? null, sets }
  }

  const group = await readGroup()
  const club = await readPaged(services?.Club, 'search', 'club', createClubCriteria)
  const sbcStorage = await readPaged(services?.Item, 'searchStorageItems', 'sbc-storage', createStorageCriteria)
  const rawCards = [...club.items.map(row => ({ row, source: 'club' })), ...sbcStorage.items.map(row => ({ row, source: 'sbc-storage' }))]
  const cards = rawCards.map(({ row, source }) => normalizeCard(row, source)).filter(Boolean)
  const coverage = club.status === 'complete' && sbcStorage.status === 'complete' && cards.length === rawCards.length ? 'complete'
    : club.status === 'unknown' && sbcStorage.status === 'unknown' ? 'unread' : 'partial'
  const status = group.status === 'complete' && coverage === 'complete' ? 'complete'
    : group.status === 'unknown' && coverage === 'unread' ? 'unknown' : 'partial'
  return {
    schemaVersion: 1, kind: 'fc-sbc-main-read', url, capturedAt, platform, status, issues,
    group,
    inventory: {
      coverage,
      club: { status: club.status, pageCount: club.pageCount, retrievedAll: club.retrievedAll },
      sbcStorage: { status: sbcStorage.status, pageCount: sbcStorage.pageCount, retrievedAll: sbcStorage.retrievedAll },
      cards,
    },
  }
}

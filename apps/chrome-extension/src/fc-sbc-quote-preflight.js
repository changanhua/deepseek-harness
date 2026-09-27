const compact = value => String(value ?? '').replace(/\s+/gu, ' ').trim()
const boundedText = value => typeof value === 'string' && value.length > 0 && value.length <= 256
const money = value => Number.isSafeInteger(value) && value > 0
const safeTime = value => Number.isSafeInteger(value) && value > 0

const issue = (code, detail, severity = 'blocker') => ({ code, severity, detail: compact(detail).slice(0, 180) })

const purchaseParts = planInput => {
  const rows = []
  for (const challenge of Array.isArray(planInput?.challenges) ? planInput.challenges : []) {
    for (const candidate of Array.isArray(challenge?.candidates) ? challenge.candidates : []) {
      for (const part of Array.isArray(candidate?.cards) ? candidate.cards : []) {
        if (boundedText(part?.cardVersionId)) rows.push({ challengeId: compact(challenge.challengeId), cardVersionId: part.cardVersionId })
      }
    }
  }
  return rows
}

const quoteState = (quote, planInput, now, maxQuoteAgeMs) => {
  if (!quote) return 'missing'
  if (quote.platform !== planInput.platform) return 'platform-mismatch'
  if (!money(quote.price)) return 'invalid-price'
  if (!safeTime(quote.observedAt) || !safeTime(quote.validUntil)) return 'invalid-time'
  if (quote.validUntil <= now) return 'stale'
  if (Number.isSafeInteger(maxQuoteAgeMs) && maxQuoteAgeMs > 0 && now - quote.observedAt > maxQuoteAgeMs) return 'stale'
  return 'fresh'
}

const rangeOf = (items, selector) => {
  if (!items.length) return null
  const values = items.map(selector)
  return { min: Math.min(...values), max: Math.max(...values) }
}

export const createSbcQuotePreflight = (input = {}) => {
  const planInput = input.planInput ?? input
  const now = Number.isSafeInteger(input.now) ? input.now : Number.isSafeInteger(planInput?.now) ? planInput.now : Date.now()
  const maxQuoteAgeMs = Number.isSafeInteger(input.maxQuoteAgeMs) ? input.maxQuoteAgeMs : 15 * 60 * 1000
  const maxMarketSearches = Number.isSafeInteger(input.maxMarketSearches) ? input.maxMarketSearches : 20
  if (!boundedText(planInput?.platform) || !Array.isArray(planInput?.quotes) || !Array.isArray(planInput?.challenges)) {
    return {
      schemaVersion: 1,
      kind: 'fc-sbc-quote-preflight',
      status: 'blocked',
      issues: [issue('quote-input-missing', 'solver input is missing quotes, platform, or challenges')],
      summary: { neededCardVersions: 0, freshQuotes: 0, missingQuotes: 0, staleQuotes: 0, invalidQuotes: 0,
        mismatchedQuotes: 0, maxMarketSearches, purchaseRange: null, maxSpendRange: null },
    }
  }
  const neededRows = purchaseParts(planInput)
  const neededVersions = [...new Set(neededRows.map(row => row.cardVersionId))]
  const quotes = new Map(planInput.quotes.map(quote => [`${quote.platform}:${quote.cardVersionId}`, quote]))
  const byVersion = neededVersions.map(cardVersionId => {
    const exact = quotes.get(`${planInput.platform}:${cardVersionId}`)
    const fallback = exact ?? planInput.quotes.find(quote => quote.cardVersionId === cardVersionId)
    return { cardVersionId, state: quoteState(fallback, planInput, now, maxQuoteAgeMs) }
  })
  const counts = byVersion.reduce((acc, row) => {
    acc[row.state] = (acc[row.state] ?? 0) + 1
    return acc
  }, {})
  const variants = Array.isArray(input.variants) ? input.variants : []
  const purchaseRange = rangeOf(variants, variant => variant.purchaseCount)
  const maxSpendRange = rangeOf(variants, variant => variant.maxSpend)
  const issues = []
  if (counts.missing) issues.push(issue('quote-missing', `${counts.missing} needed card version(s) have no quote`))
  if (counts.stale) issues.push(issue('quote-stale', `${counts.stale} needed card version quote(s) are stale`))
  if (counts['invalid-price'] || counts['invalid-time']) issues.push(issue('quote-invalid', 'one or more needed quotes have invalid price or time'))
  if (counts['platform-mismatch']) issues.push(issue('quote-platform-mismatch', 'one or more needed quotes are for another platform'))
  if (purchaseRange?.max > maxMarketSearches) {
    issues.push(issue('market-search-limit', `plan may need ${purchaseRange.max} market searches, above limit ${maxMarketSearches}`))
  }
  const status = issues.length ? 'blocked' : neededVersions.length ? 'ready' : 'not-needed'
  return {
    schemaVersion: 1,
    kind: 'fc-sbc-quote-preflight',
    status,
    issues,
    summary: {
      neededCardVersions: neededVersions.length,
      freshQuotes: counts.fresh ?? 0,
      missingQuotes: counts.missing ?? 0,
      staleQuotes: counts.stale ?? 0,
      invalidQuotes: (counts['invalid-price'] ?? 0) + (counts['invalid-time'] ?? 0),
      mismatchedQuotes: counts['platform-mismatch'] ?? 0,
      maxMarketSearches,
      purchaseRange,
      maxSpendRange,
    },
  }
}

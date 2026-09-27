/** Self-contained for scripting.executeScript; reads only already-rendered FC Web App state. */
export const probeFcSbcPage = (input = {}) => {
  const compact = value => String(value ?? '').replace(/\s+/gu, ' ').trim()
  const linesOf = value => String(value ?? '').split(/\r?\n| {2,}/u).map(compact).filter(Boolean)
  const attr = (element, names) => names.map(name => element.getAttribute?.(name)).find(value => compact(value)) ?? null
  const cap = (items, limit) => items.slice(0, limit)
  const href = String(input.href ?? globalThis.location?.href ?? '')
  const title = String(input.title ?? globalThis.document?.title ?? '').slice(0, 512)
  const capturedAt = String(input.capturedAt ?? new Date().toISOString())
  const body = globalThis.document?.body
  const rootText = compact(body?.textContent ?? '')
  const lower = rootText.toLowerCase()
  const isEaHost = (() => {
    try {
      const host = new URL(href).hostname.toLowerCase()
      return host === 'www.ea.com' || host.endsWith('.ea.com')
    } catch { return false }
  })()
  const appHint = /\b(ultimate team|football ultimate team|fc companion|web app|squad building challenges?|sbc)\b/iu.test(rootText + ' ' + title)
  const loginRequired = isEaHost && Boolean(globalThis.document?.querySelector?.('#Login.ut-login'))
  const supported = isEaHost && appHint && !loginRequired
  const evidence = []
  const marketBlocked = /\b(transfer market access|market access|not available|unavailable|locked|earn access|no access)\b/iu.test(rootText)
    || /转会市场.*(未开放|不可用|锁定|权限)/u.test(rootText)
  const marketSearch = /\b(transfer market|market search|search the transfer market|buy now|bid)\b/iu.test(rootText)
    || /转会市场|立即购买|搜索市场/u.test(rootText)
  if (marketBlocked) evidence.push('blocked-text')
  if (/\bbuy now\b/iu.test(rootText) || /立即购买/u.test(rootText)) evidence.push('buy-now-visible')
  if (/\btransfer market\b/iu.test(rootText) || /转会市场/u.test(rootText)) evidence.push('transfer-market-visible')
  const fcChallengeRows = cap(Array.from(globalThis.document?.querySelectorAll?.(
    '.ut-sbc-challenges-view--challenges .ut-sbc-challenge-table-row-view') ?? []), 24)
  const selectedRow = fcChallengeRows.find(element => element.classList.contains('selected'))
  const currentDetails = globalThis.document?.querySelector?.('.ut-sbc-requirements-view')
  const currentTitle = compact(currentDetails?.querySelector?.('header h1')?.textContent)
  const selectedIndex = fcChallengeRows.indexOf(selectedRow)
  const selectedTitle = compact(selectedRow?.querySelector?.('h1,h2,h3')?.textContent)
  const heading = compact(globalThis.document?.querySelector?.('main h1, h1')?.textContent)
  const viewKind = !supported ? 'unknown'
    : fcChallengeRows.length ? 'sbc-group'
      : /^(?:SBC\s*(?:仓库|Storage)|重复物品仓库)$/iu.test(heading) ? 'sbc-storage'
        : /^(?:俱乐部|Club)$/iu.test(heading) ? 'club'
          : globalThis.document?.querySelector?.('.ut-sbc-sets-view') ? 'sbc-list' : 'unknown'
  const currentRequirements = cap(Array.from(currentDetails?.querySelectorAll?.('.sbc-requirements-checklist li') ?? [])
    .map(element => compact(element.textContent)).filter(Boolean), 24)
  const currentRewards = cap(Array.from(currentDetails?.querySelectorAll?.('.rewards-container .ut-sbc-reward-table-cell-view--label') ?? [])
    .map(element => compact(element.textContent)).filter(Boolean), 8)
  const taskType = /\b(item score|submit items?|exchange items?|sbc rating)\b/iu.test(rootText)
    ? 'item-score'
    : fcChallengeRows.length > 0 || /\b(squad rating|chemistry|players from|leagues?|nations?|clubs?|rare players?|exactly|min\.?|max\.?)\b/iu.test(rootText)
      || /化学|默契度|评分|来自.*(联赛|国家|俱乐部)|稀有/u.test(rootText)
      ? 'puzzle'
      : 'unknown'
  const challengeNodes = fcChallengeRows.length ? fcChallengeRows : cap(Array.from(globalThis.document?.querySelectorAll?.([
    '[data-challenge-id]', '[data-sbc-challenge-id]', '[data-testid*="challenge" i]',
    '[class*="challenge" i]', '[class*="sbc" i]', 'li', 'article', 'section',
  ].join(',')) ?? []).filter(element => {
    const text = compact(element.textContent)
    return text.length >= 8 && /\b(sbc|challenge|requirements?|reward|squad rating|chemistry|players)\b/iu.test(text)
  }), 24)
  const seenChallengeIds = new Set()
  const challenges = []
  for (const [index, element] of challengeNodes.entries()) {
    const text = compact(element.textContent)
    const challengeId = compact(attr(element, ['data-challenge-id', 'data-sbc-challenge-id', 'data-id', 'id']))
      || `visible-${index + 1}`
    if (seenChallengeIds.has(challengeId)) continue
    seenChallengeIds.add(challengeId)
    const sourceLines = Array.from(element.querySelectorAll?.('h1,h2,h3,p,li,[role="listitem"],[aria-label]') ?? [])
      .map(node => compact(node.textContent || node.getAttribute?.('aria-label'))).filter(Boolean)
    const lines = sourceLines.length ? sourceLines : linesOf(text)
    const heading = compact(element.querySelector?.('h1,h2,h3,[role="heading"],[aria-label]')?.textContent)
      || compact(element.getAttribute?.('aria-label')) || lines[0]?.slice(0, 120) || challengeId
    const isCurrentFcRow = element === selectedRow && heading === currentTitle
    const requirementLines = isCurrentFcRow ? currentRequirements : lines.filter(line => /\b(overall|rating|chemistry|players?|clubs?|nations?|leagues?|rare|exactly|min\.?|max\.?|same)\b/iu.test(line)
      || /评分|化学|球员|俱乐部|国家|联赛|稀有|至少|最多|正好/u.test(line))
    const rewardLines = isCurrentFcRow ? currentRewards : lines.filter(line => /\b(reward|pack|players pack|coins?)\b/iu.test(line) || /奖励|礼包|金币/u.test(line))
    challenges.push({ challengeId, title: heading, completed: /\b(completed|claimed|done)\b/iu.test(text) || /已完成|已领取/u.test(text),
      requirementLines: cap(requirementLines, 24), rewardLines: cap(rewardLines, 8), textSample: text.slice(0, 500) })
  }
  const cardNodes = cap(Array.from(globalThis.document?.querySelectorAll?.([
    '[data-card-id]', '[data-player-id]', '[data-resource-id]', '[class*="card" i]',
    '[class*="player" i]', '[class*="item" i]',
  ].join(',')) ?? []).filter(element => /\b\d{2}\b/u.test(compact(element.textContent)) && compact(element.textContent).length >= 6), 80)
  const visibleCards = []
  const seenCards = new Set()
  for (const [index, element] of cardNodes.entries()) {
    const text = compact(element.textContent)
    const rating = Number(/\b([4-9]\d)\b/u.exec(text)?.[1] ?? NaN)
    const instanceId = compact(attr(element, ['data-card-id', 'data-player-id', 'data-resource-id'])) || null
    const key = instanceId ?? text.slice(0, 120)
    if (seenCards.has(key)) continue
    seenCards.add(key)
    visibleCards.push({ visibleId: instanceId ?? `visible-card-${index + 1}`, instanceId, rating: Number.isSafeInteger(rating) ? rating : null,
      locked: /\b(locked|untradeable|loan)\b/iu.test(text) || /锁定|不可交易|租借/u.test(text), textSample: text.slice(0, 240) })
  }
  const warnings = []
  if (loginRequired) warnings.push('login-required')
  else if (!supported) warnings.push('unsupported-or-unrecognized-fc-page')
  if (!loginRequired && !challenges.length) warnings.push('no-visible-challenges')
  if (!loginRequired && !visibleCards.length) warnings.push('no-visible-inventory-cards')
  if (taskType === 'item-score') warnings.push('item-score-sbc-requires-separate-executor')
  return {
    url: href, title, capturedAt, supported, loginRequired,
    view: { kind: viewKind, selectedChallenge: viewKind === 'sbc-group' && selectedIndex >= 0 && selectedTitle === currentTitle
      ? { title: selectedTitle, visibleIndex: selectedIndex } : null },
    taskType,
    marketAccess: { status: marketBlocked ? 'blocked' : marketSearch ? 'visible' : 'unknown', evidence },
    challengeSet: { title: compact(globalThis.document?.querySelector?.('h1,h2,[role="heading"]')?.textContent) || title || null,
      visibleChallengeCount: challenges.length, challenges },
    inventory: { coverage: visibleCards.length ? 'visible-only' : 'unread', sbcStorageVisible: /\b(sbc storage|duplicate storage)\b/iu.test(lower)
      || /SBC\s*仓库|重复.*仓库/u.test(rootText), visibleCards },
    warnings,
  }
}

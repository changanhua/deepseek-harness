/** An in-memory, read-only view of observations from one bound FC document. */
export const updateFcSbcPageModel = (previous, { page, probe }) => {
  if (!page || !probe || page.url !== probe.url || !Number.isInteger(page.tabId)
    || !Number.isInteger(page.frameId) || typeof page.documentId !== 'string') throw new Error('invalid_page_model_observation')
  const identity = { tabId: page.tabId, frameId: page.frameId, documentId: page.documentId, url: page.url }
  const samePage = previous?.page?.tabId === identity.tabId && previous.page.frameId === identity.frameId
    && previous.page.documentId === identity.documentId && previous.page.url === identity.url
    && probe.supported === true && probe.loginRequired !== true
  const view = probe.view?.kind ?? 'unknown'
  let group = samePage ? previous.group : null
  if (view === 'sbc-group') {
    const rows = (probe.challengeSet?.challenges ?? []).slice(0, 24)
    const title = probe.challengeSet?.title ?? null
    const signature = JSON.stringify([title, rows.map(row => row.title)])
    const oldRows = group?.signature === signature ? group.challenges : []
    const selected = probe.view?.selectedChallenge
    const challenges = rows.map((row, index) => {
      const old = oldRows[index]
      const detailsObserved = selected?.visibleIndex === index && selected.title === row.title
        && row.requirementLines?.length > 0 && row.rewardLines?.length > 0
      return {
        title: row.title,
        visibleIndex: index,
        completed: row.completed === true,
        requirements: detailsObserved ? [...row.requirementLines] : old?.requirements ?? null,
        rewards: detailsObserved ? [...row.rewardLines] : old?.rewards ?? null,
        observedAt: detailsObserved ? probe.capturedAt : old?.observedAt ?? null,
      }
    })
    const observedDetailCount = challenges.filter(row => row.observedAt !== null).length
    group = { title, signature, visibleChallengeCount: rows.length, observedDetailCount,
      coverage: observedDetailCount === 0 ? 'unread' : observedDetailCount === rows.length ? 'visible-rows-read' : 'partial',
      challenges }
  }
  const visibleCards = probe.inventory?.visibleCards ?? []
  const inventory = visibleCards.length || !samePage ? {
    coverage: visibleCards.length ? 'visible-only' : 'unread',
    visibleCardCount: visibleCards.length,
    sbcStorageVisible: probe.inventory?.sbcStorageVisible === true,
    observedAt: visibleCards.length ? probe.capturedAt : null,
  } : previous.inventory
  return { page: identity, observedAt: probe.capturedAt, view: { kind: view,
    selectedChallenge: probe.view?.selectedChallenge ?? null }, group, inventory }
}

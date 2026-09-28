import { createSbcInventorySnapshot } from './fc-sbc-inventory-snapshot.js'
import { createSbcPuzzlePlanInput, generateSbcPuzzleCandidates } from './fc-sbc-puzzle-solver.js'
import { createSbcReadinessReport } from './fc-sbc-readiness.js'

const text = value => typeof value === 'string' ? value.trim() : ''
const candidateKey = (challengeId, instanceIds) => `${challengeId}\u0000${[...instanceIds].sort().join('\u0000')}`
const verifiedSetOf = (probe, main) => {
  const group = main?.group
  const set = group?.status === 'complete' && text(group.selectedSetId)
    ? group.sets?.find(row => row.setId === group.selectedSetId) : null
  const titleMatches = set && text(probe?.challengeSet?.title).toLocaleLowerCase() === text(set.title).toLocaleLowerCase()
  const expectedCount = probe?.challengeSet?.visibleChallengeCount
  const countMatches = !Number.isSafeInteger(expectedCount) || expectedCount <= 0
    || set?.challenges?.length === expectedCount
  return set && titleMatches && countMatches && group.sets.length === 1 ? set : null
}

export const createFcSbcVerificationRequest = ({ probe, main } = {}) => {
  const issues = []
  const set = verifiedSetOf(probe, main)
  if (!set) issues.push({ code: 'group-identity-unverified' })
  if (main?.status !== 'complete' || main?.issues?.length || main?.inventory?.coverage !== 'complete') {
    issues.push({ code: 'inventory-coverage-incomplete' })
  }
  if (issues.length) return { status: 'blocked', groups: [], issues, searchLimited: false }
  const pending = set.challenges.filter(challenge => !challenge.completed)
  if (!pending.length) issues.push({ code: 'all-challenges-completed' })
  if (pending.length > 4) issues.push({ code: 'challenge-count-limit' })
  const groups = []
  let searchLimited = false
  const inventoryById = new Map(main.inventory.cards.map(card => [card.instanceId, card]))
  for (const challenge of pending.slice(0, 4)) {
    if (!/^f\d+$/u.test(text(challenge.formationName)) || challenge.requirements?.slotCount !== 11) {
      issues.push({ code: 'formation-unverified', challengeId: challenge.challengeId })
      continue
    }
    const generated = generateSbcPuzzleCandidates({ coverage: 'complete', cards: main.inventory.cards,
      requirements: challenge.requirements, candidateLimit: 12 })
    searchLimited ||= generated.summary.poolComplete === false || generated.summary.searched >= 25_000
    if (!generated.candidates.length) {
      issues.push(...generated.issues.map(row => ({ ...row, challengeId: challenge.challengeId })))
      continue
    }
    groups.push({ challengeId: challenge.challengeId, formationName: challenge.formationName,
      candidates: generated.candidates.slice(0, 12).map(candidate => ({ candidateId: candidate.candidateId,
        instanceIds: candidate.cards.map(card => card.instanceId),
        expectedCards: candidate.cards.map(card => {
          const source = inventoryById.get(card.instanceId)
          return { instanceId: card.instanceId, cardVersionId: source?.cardVersionId ?? null,
            rating: source?.rating ?? null, quality: source?.quality ?? null, nationId: source?.nationId ?? null,
            leagueId: source?.leagueId ?? null, clubId: source?.clubId ?? null }
        }) })) })
  }
  return { status: issues.length || groups.length !== pending.length ? 'blocked' : 'ready', groups, issues, searchLimited }
}

/** Joins one document-bound service read with the visible page without inventing missing evidence. */
export const createFcSbcSliceReport = ({ probe, main, verificationRequest, verification } = {}) => {
  const group = main?.group
  const selectedSet = verifiedSetOf(probe, main)
  const groupVerified = Boolean(selectedSet)
  const readVerified = main?.status === 'complete' && Array.isArray(main.issues) && main.issues.length === 0
  const coverage = readVerified && main.inventory?.coverage === 'complete' ? 'complete'
    : main?.inventory?.coverage === 'unread' ? 'unread' : 'partial'
  const inventorySnapshot = createSbcInventorySnapshot({ coverage, capturedAt: main?.capturedAt,
    cards: main?.inventory?.cards })
  const solverCoverage = inventorySnapshot.status === 'complete' ? 'complete' : 'partial'
  const requests = verificationRequest?.status === 'ready' ? verificationRequest.groups.flatMap(row => row.candidates.map(candidate => ({
    challengeId: row.challengeId, candidateId: candidate.candidateId, instanceIds: candidate.instanceIds,
  }))) : []
  const requestedById = new Map(requests.map(row => [`${row.challengeId}\u0000${row.candidateId}`, row]))
  const rows = Array.isArray(verification?.results) ? verification.results : []
  const verified = verification?.status === 'complete' && verification.url === main?.url
    && requests.length > 0 && rows.length === requests.length
    && requestedById.size === requests.length
    && new Set(rows.map(row => `${row.challengeId}\u0000${row.candidateId}`)).size === rows.length
    && rows.every(row => {
      const request = requestedById.get(`${row.challengeId}\u0000${row.candidateId}`)
      return row.status === 'complete' && Number.isSafeInteger(row.chemistry) && request
        && Array.isArray(row.instanceIds) && candidateKey(row.challengeId, row.instanceIds) === candidateKey(row.challengeId, request.instanceIds)
    })
  const measurements = new Map()
  if (verified) for (const row of rows) {
    const request = requestedById.get(`${row.challengeId}\u0000${row.candidateId}`)
    measurements.set(candidateKey(row.challengeId, request.instanceIds), row)
  }
  const solverSet = verified && selectedSet ? { ...selectedSet, challenges: selectedSet.challenges.map(challenge => ({
    ...challenge, requirements: { ...challenge.requirements, constraints: challenge.requirements.constraints.map(rule =>
      ['chemistry', 'squad-rating'].includes(rule.type) ? { ...rule, model: 'verified-evaluator' } : rule) },
  })) } : selectedSet
  const scoreOf = (cards, challengeId, field) => {
    const row = measurements.get(candidateKey(challengeId, cards.map(card => card.instanceId)))
    return row?.[field] ?? null
  }
  const puzzle = createSbcPuzzlePlanInput({ fcYear: 'FC27', platform: text(main?.platform),
    groupId: groupVerified ? selectedSet.setId : '',
    read: { inventory: { coverage: solverCoverage, cards: main?.inventory?.cards ?? [] },
      group: { sets: groupVerified ? [solverSet] : [] } },
    ...(verified ? { evaluateChemistry: (cards, challengeId) => scoreOf(cards, challengeId, 'chemistry'),
      evaluateSquadRating: (cards, challengeId) => scoreOf(cards, challengeId, 'squadRating') } : {}),
  })
  const report = createSbcReadinessReport({ probe, inventorySnapshot,
    ...(puzzle.status === 'ready' ? { planInput: puzzle.planInput } : {}) })
  return {
    status: groupVerified && readVerified && puzzle.status === 'ready' ? 'ready' : 'partial',
    searchLimited: verificationRequest?.searchLimited === true,
    groupSummary: { status: groupVerified ? 'complete' : group?.status ?? 'unread',
      selectedSetId: groupVerified ? selectedSet.setId : null, title: groupVerified ? selectedSet.title : null,
      challengeCount: groupVerified ? selectedSet.challenges.length : 0 },
    inventorySummary: inventorySnapshot.summary,
    puzzle: { status: puzzle.status, issues: puzzle.issues, summary: puzzle.summary,
      provisionalByChallenge: puzzle.provisionalByChallenge },
    report,
    issues: [
      ...(Array.isArray(main?.issues) ? main.issues : []),
      ...(!groupVerified ? [{ code: 'group-identity-unverified', detail: 'current group or challenge count does not match the visible page' }] : []),
      ...(verificationRequest?.issues ?? []),
      ...(verification?.issues ?? []),
      ...puzzle.issues,
    ],
  }
}

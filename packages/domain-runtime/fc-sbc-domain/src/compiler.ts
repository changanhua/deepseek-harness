/** Deterministic FC observation and existing-solver adapters. No external capabilities are accepted. */
import { createHash } from 'node:crypto'
import { domainArtifactRefSchema } from '@changanhua/dsh-domain-runtime'
import type { DomainArtifactHeader } from '@changanhua/dsh-domain-runtime'
import type { z } from 'zod'
import { captureRealitySchema } from './schema.ts'
import { inventorySnapshot, observationBlockers, pageModel, planVariants, puzzleCandidates, quotePreflight } from './algorithms.ts'
import type { FcArtifact, FcCardObservation, FcSbcPlanArtifact, FcSbcRealitySnapshot, PlanVariant } from './types.ts'

/** Explicit deployment limits applied at the complete artifact and solver boundary. */
export interface FcLimits {
  /** Maximum retained immutable artifacts; capacity rejection never evicts old evidence. */
  maxArtifacts: number
  /** Maximum canonical UTF-8 bytes in one complete persisted artifact. */
  maxArtifactBytes: number
  /** Maximum card observations admitted in one capture. */
  maxCards: number
  /** Maximum observed challenges admitted in one capture. */
  maxChallenges: number
  /** Maximum product of candidate counts admitted to the existing cross-challenge solver. */
  maxCrossChallengeCombinations: number
}
/**
 * Canonical JSON for content addressing; inputs have already crossed their JSON/schema boundary.
 * @param value - Admitted JSON-compatible value.
 * @returns Canonical sorted-key JSON.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}
/**
 * SHA-256 of canonical content; never the legacy solver's short candidate fingerprint.
 * @param value - Canonicalizable artifact content.
 * @returns SHA-256 identity in sha256:hex form.
 */
export function digest(value: unknown): string { return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}` }
/**
 * Content identity includes immutable metadata and payload; the identity itself is excluded.
 * @param kind - FC artifact kind.
 * @param header - Immutable metadata before identity is assigned.
 * @param payload - Validated FC owner payload.
 * @returns The complete content-addressed artifact.
 */
export function seal(kind: 'sbc-reality' | 'sbc-plan', header: Omit<DomainArtifactHeader, 'ref'>,
  payload: FcArtifact['payload']): FcArtifact {
  const hash = digest({ kind, header, payload })
  return { header: { ref: domainArtifactRefSchema.parse({ domain: 'fc27', kind, id: hash.slice(7), digest: hash }), ...header }, payload }
}
/**
 * Confirm durable artifact bytes still agree with their immutable identity.
 * @param artifact - Stored artifact whose content must match its reference.
 * @returns Whether kind, domain and digest match the complete immutable content.
 */
export function verifyArtifact(artifact: FcArtifact): boolean {
  const { ref, ...header } = artifact.header
  return ref.domain === 'fc27' && ['sbc-reality', 'sbc-plan'].includes(ref.kind)
    && ref.digest === digest({ kind: ref.kind, header, payload: artifact.payload }) && ref.id === ref.digest.slice(7)
}
/**
 * Expiry never rewrites immutable capture-time metadata. Missing expiry is unknown.
 * @param header - Observation timestamp and explicitly supplied expiry.
 * @param now - Current UTC time in milliseconds.
 * @returns Current freshness; missing or future observation evidence remains unknown.
 */
export function freshness(header: Pick<DomainArtifactHeader, 'observedAt' | 'expiresAt'>, now: number): 'fresh' | 'stale' | 'unknown' {
  if (!header.observedAt || !header.expiresAt || Date.parse(header.observedAt) > now) return 'unknown'
  return Date.parse(header.expiresAt) <= now ? 'stale' : 'fresh'
}
const codes = (values: string[]) => [...new Set(values)].sort()
const safeUrl = (value: string) => { const url = new URL(value); return `${url.origin}${url.pathname}` }

/**
 * Compile only proven observed fields, preserving unknown and partial coverage.
 * @param input - Parsed typed read/probe observation envelope.
 * @param limits - Deployment capacity limits.
 * @param now - First publication time in UTC milliseconds.
 * @returns Immutable Reality with conservative coverage and field provenance.
 */
export function compileReality(input: z.infer<typeof captureRealitySchema>, limits: FcLimits, now: number): FcArtifact {
  const { read, probe } = input
  if ((read && read.url !== input.page.url) || (probe && probe.url !== input.page.url)) throw new Error('observation-page-mismatch')
  const capturedAt = [read?.capturedAt, probe?.capturedAt].filter((value): value is string => value !== undefined).sort((a,
    b) => Date.parse(a) - Date.parse(b))[0]
  if (capturedAt === undefined) throw new Error('observation-required')
  if (input.expiresAt && Date.parse(input.expiresAt) < Date.parse(capturedAt)) throw new Error('expiry-before-observation')
  const issues: string[] = []
  if (read && probe && read.capturedAt !== probe.capturedAt) issues.push('observation-times-differ')
  const rawCards = read?.inventory.cards ?? probe?.inventory?.visibleCards ?? []
  if (rawCards.length > limits.maxCards) throw new Error('inventory-capacity')
  const admitted: FcCardObservation[] = []
  for (const row of rawCards) {
    if (!['club', 'sbc-storage', 'visible'].includes(row.source ?? '')) { issues.push('inventory-source-unknown'); continue }
    if (read && row.source === 'visible') issues.push('inventory-source-mismatch')
    if (row.locked === undefined) issues.push('card-protection-unknown')
    admitted.push({ ...row, locked: row.locked ?? true })
  }
  const traversed = read?.inventory.club?.status === 'complete' && read.inventory.club.retrievedAll
    && read.inventory.club.pageCount > 0 && read.inventory.sbcStorage?.status === 'complete'
    && read.inventory.sbcStorage.retrievedAll && read.inventory.sbcStorage.pageCount > 0
  const declaredCoverage = read?.inventory.coverage ?? 'visible-only'
  const proposedCoverage = declaredCoverage === 'complete' && traversed && issues.length === 0 ? 'complete'
    : declaredCoverage === 'unread' ? 'unread' : 'partial'
  if (declaredCoverage === 'complete' && !traversed) issues.push('inventory-end-evidence-missing')
  const inventory = inventorySnapshot({ coverage: proposedCoverage, capturedAt, cards: admitted })
  issues.push(...inventory.issues.map(row => row.code))
  const uniqueRows = new Map<string | null | undefined, FcCardObservation>()
  const duplicates = new Set<string | null | undefined>()
  for (const row of admitted) {
    if (uniqueRows.has(row.instanceId)) duplicates.add(row.instanceId)
    else uniqueRows.set(row.instanceId, row)
  }
  const cards = inventory.cards.map((card) => {
    const original = uniqueRows.get(card.instanceId)
    const { reserveValue, ...observed } = card
    return { ...original, ...observed, locked: card.locked || duplicates.has(card.instanceId),
      ...(original?.reserveValue != null ? { reserveValue } : {}) }
  })
  const inventoryStatus = inventory.status === 'complete' && issues.length === 0 ? 'complete' : declaredCoverage === 'unread' && cards.length === 0 ? 'unknown' : 'partial'
  const selected = read?.group.sets.filter(set => set.setId === read.group.selectedSetId)
  const group = selected?.length === 1 ? selected[0] : undefined
  const challenges = group?.challenges ?? []
  if (challenges.length > limits.maxChallenges) throw new Error('challenge-capacity')
  // main-read may have used challengeTitles: its status has no full-set count/end proof.
  issues.push(group ? 'group-coverage-unproven' : 'group-identity-unknown')
  if (new Set(challenges.map(row => row.challengeId)).size !== challenges.length) issues.push('duplicate-challenge-identity')
  if (challenges.some(row => !row.challengeId)) issues.push('challenge-identity-missing')
  if (read?.issues.length) issues.push('source-read-issues')
  if (!probe?.supported || probe.loginRequired) issues.push(probe?.loginRequired ? 'login-required' : 'page-support-unverified')
  const coverage = inventoryStatus === 'unknown' && !group ? 'unknown' : 'partial'
  const payload: FcSbcRealitySnapshot = {
    schemaVersion: 1,
    pageIdentity: { ...input.page, url: safeUrl(input.page.url), ...(input.installationId ? { installationId: input.installationId } : {}),
      ...(input.clubId ? { clubId: input.clubId } : {}), ...(read?.platform ? { platform: read.platform } : {}) },
    group: { ...(group ? { id: group.setId } : {}), title: group?.title ?? probe?.challengeSet?.title ?? 'unknown',
      taskType: probe?.taskType ?? 'unknown', coverage: group ? 'partial' : 'unknown', challenges },
    inventory: { status: inventoryStatus,
      coverage: inventoryStatus === 'complete' ? 'complete' : inventoryStatus === 'unknown' ? 'unread' : 'partial', cards,
      summary: { ...inventory.summary,
        coverage: inventoryStatus === 'complete' ? 'complete' : proposedCoverage === 'unread' ? 'unread' : 'partial' } },
    marketAccess: { status: probe?.marketAccess?.status ?? 'unknown', ...(probe ? { observedAt: probe.capturedAt } : {}) },
    pageModel: probe ? pageModel({ page: { ...input.page, url: safeUrl(input.page.url) }, probe: { ...probe,
      url: safeUrl(probe.url) } }) : null,
    capturedAt,
  }
  const reasons = codes(issues)
  const timing = { observedAt: capturedAt, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) }
  return seal('sbc-reality', {
    createdAt: new Date(now).toISOString(), ...timing, coverage: { status: coverage, reasons },
    freshness: { status: freshness(timing, now), ...timing },
    derivedFrom: [], sourceRefs: input.sourceRefs, issues: reasons.map(code => ({ code, severity: 'warning' })),
  }, payload)
}

/**
 * Compile observed Reality into existing pure solver inputs; incomplete candidates remain visible.
 * @param reality - Exact immutable Reality artifact.
 * @param options - Bounded search and candidate counts.
 * @param limits - Deployment capacity limits.
 * @param now - First plan publication time in UTC milliseconds.
 * @returns Frozen candidate plan and explicit missing-evidence blockers.
 */
export function compilePlan(reality: FcArtifact, options: { searchLimit: number; candidateLimit: number }, limits: FcLimits,
  now: number): FcArtifact {
  if (reality.header.ref.kind !== 'sbc-reality') throw new Error('reality-required')
  const snapshot = reality.payload as FcSbcRealitySnapshot
  const blockers = observationBlockers({ probe: { supported: !reality.header.issues.some(row => row.code === 'page-support-unverified'),
    loginRequired: reality.header.issues.some(row => row.code === 'login-required'), taskType: snapshot.group.taskType },
  inventoryCoverage: snapshot.inventory.coverage })
  const incomplete: string[] = []
  if (snapshot.inventory.status !== 'complete') incomplete.push('inventory-coverage-incomplete')
  incomplete.push(snapshot.group.coverage === 'unknown' ? 'group-coverage-unknown' : 'group-coverage-unproven')
  if (freshness(reality.header, now) !== 'fresh') blockers.push(`reality-${freshness(reality.header, now)}`)
  if (snapshot.inventory.cards.some(row => row.reserveValue == null)) blockers.push('reserve-value-unverified')
  if (snapshot.group.challenges.some(row => row.completed === undefined)) blockers.push('challenge-completion-unknown')
  const pending = snapshot.group.challenges.filter(row => row.completed !== true)
  const invalidIdentity = pending.some(row => !row.challengeId) || new Set(pending.map(row => row.challengeId)).size !== pending.length
  const searchAllowed = snapshot.group.taskType === 'puzzle' && !invalidIdentity
  if (!searchAllowed) { blockers.push(invalidIdentity ? 'challenge-identity-invalid' : 'unsupported-task-type')
    incomplete.push('search-not-run') }
  if (!pending.length) { blockers.push('pending-challenges-unavailable'); incomplete.push('search-not-run') }
  let searched = 0
  const perChallenge = searchAllowed ? pending.map((challenge) => {
    const challengeId = challenge.challengeId
    if (!challengeId) throw new Error('challenge-identity-missing')
    const result = puzzleCandidates({ coverage: snapshot.inventory.coverage, cards: snapshot.inventory.cards,
      requirements: challenge.requirements, ...options })
    searched += result.summary.searched
    incomplete.push(...result.summary.searchIncompleteReasons)
    blockers.push(...result.issues.map(row => row.code))
    return { challengeId, challenge, result }
  }) : []
  const challengeCandidates = perChallenge.map(({ challengeId, result }) => ({
    challengeId, candidates: result.candidates,
    provisional: result.provisional !== null || snapshot.inventory.status !== 'complete', issues: codes(result.issues.map(row => row.code)),
  }))
  let variants: PlanVariant[] = []
  const combinations = perChallenge.reduce((total, row) => total * row.result.candidates.length, 1)
  const identityReady = snapshot.pageIdentity.platform && snapshot.group.id
  if (!identityReady) blockers.push('plan-identity-missing')
  if (combinations > limits.maxCrossChallengeCombinations) { incomplete.push('cross-challenge-combinations-bounded')
    blockers.push('cross-challenge-search-incomplete') }
  const planInput = { fcYear: 'FC27', platform: snapshot.pageIdentity.platform, groupId: snapshot.group.id,
    inventory: snapshot.inventory.cards, quotes: [], now,
    challenges: perChallenge.map(({ challenge, result }) => ({ challengeId: challenge.challengeId,
      slotCount: challenge.requirements.slotCount, candidates: result.candidates })), variantLimit: options.candidateLimit }
  if (identityReady && pending.length && perChallenge.length === pending.length && perChallenge.every(row => row.result.status === 'ready' && row.result.provisional === null) && combinations > 0 && combinations <= limits.maxCrossChallengeCombinations) variants = planVariants(planInput)
  if (variants.length >= options.candidateLimit) incomplete.push('plan-variant-limit-reached')
  if (!variants.length) blockers.push('no-cross-challenge-candidate')
  const quote = quotePreflight({ planInput, variants, now })
  blockers.push(...quote.issues.map(row => row.code), 'quote-provider-unavailable')
  if (reality.header.coverage?.status !== 'complete') blockers.push('reality-coverage-incomplete')
  const issueCodes = codes(blockers)
  const payload: FcSbcPlanArtifact = {
    schemaVersion: 1, realityRef: reality.header.ref,
    solver: { version: 'fc-sbc-puzzle-v1/domain-input-v1', searched, searchComplete: incomplete.length === 0,
      incompleteReasons: codes(incomplete) },
    candidates: variants.map(variant => ({ id: variant.planId, challengePlans: variant.challenges, purchaseCount: variant.purchaseCount,
      maxSpend: variant.maxSpend, provisional: issueCodes.length > 0, issues: issueCodes })),
    challengeCandidates, quoteStatus: { status: 'missing', quoteRefs: [] },
    readiness: { status: variants.length || challengeCandidates.some(row => row.candidates.length) ? 'candidate' : 'blocked',
      blockers: issueCodes },
  }
  return seal('sbc-plan', { createdAt: new Date(now).toISOString(), observedAt: snapshot.capturedAt,
    ...(reality.header.expiresAt ? { expiresAt: reality.header.expiresAt } : {}),
    coverage: { status: 'partial', reasons: codes([...incomplete, ...issueCodes]) },
    freshness: { status: freshness(reality.header, now), observedAt: snapshot.capturedAt,
      ...(reality.header.expiresAt ? { expiresAt: reality.header.expiresAt } : {}) },
    derivedFrom: [reality.header.ref], sourceRefs: [], issues: issueCodes.map(code => ({ code, severity: 'blocked' })),
  }, payload)
}

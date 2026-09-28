/** Pure input framing and strict result decoding for finite candidate selection. */

export interface ChoiceCandidate { readonly id: string; readonly description: string; readonly disabled?: boolean }
export interface ChoiceInput {
  readonly goal: string
  readonly facts: string
  readonly candidates: readonly ChoiceCandidate[]
  readonly constraints?: readonly string[]
}
export interface ChoiceLimits { readonly maxCandidates: number; readonly maxInputBytes: number }
export type ChoiceRequest =
  | { readonly kind: 'abstain'; readonly reason: 'no_eligible_candidates' }
  | { readonly kind: 'request'; readonly candidates: readonly ChoiceCandidate[]; readonly prompt: string }
export type ChoiceDecision = { readonly status: 'selected'; readonly candidateId: string } | { readonly status: 'abstain'; readonly reason: string }

/** Produce the exact model-visible JSON framing after validating bounded input. */
export function buildChoiceRequest(input: ChoiceInput, limits: ChoiceLimits): ChoiceRequest {
  if (!Number.isInteger(limits.maxCandidates) || limits.maxCandidates < 1) throw new Error('maxCandidates must be a positive integer')
  if (!Number.isInteger(limits.maxInputBytes) || limits.maxInputBytes < 1) throw new Error('maxInputBytes must be a positive integer')
  if (typeof input.goal !== 'string' || input.goal.trim() === '') throw new Error('goal must be a non-empty string')
  if (typeof input.facts !== 'string') throw new Error('facts must be a string')
  const raw = JSON.stringify(input)
  if (Buffer.byteLength(raw, 'utf8') > limits.maxInputBytes) throw new Error(`input exceeds maxInputBytes ${limits.maxInputBytes}`)
  const seen = new Set<string>()
  const candidates = input.candidates.filter((candidate) => {
    if (typeof candidate.id !== 'string' || candidate.id.trim() === '') throw new Error('candidate id must be a non-empty string')
    if (seen.has(candidate.id)) throw new Error(`duplicate candidate id: ${candidate.id}`)
    seen.add(candidate.id)
    if (typeof candidate.description !== 'string' || candidate.description.trim() === '') throw new Error(`candidate ${candidate.id} description must be a non-empty string`)
    return candidate.disabled !== true
  })
  if (candidates.length === 0) return { kind: 'abstain', reason: 'no_eligible_candidates' }
  if (candidates.length > limits.maxCandidates) throw new Error(`eligible candidates exceed maxCandidates ${limits.maxCandidates}`)
  const payload = {
    goal: input.goal, facts: input.facts,
    candidates: candidates.map(({ id, description }) => ({ id, description })), constraints: input.constraints ?? [],
  }
  const prompt = JSON.stringify(payload)
  if (Buffer.byteLength(prompt, 'utf8') > limits.maxInputBytes) throw new Error(`input exceeds maxInputBytes ${limits.maxInputBytes}`)
  return { kind: 'request', candidates, prompt }
}

/** Decode only a complete JSON object that selects a supplied eligible id or abstains. */
export function decodeChoiceResponse(text: string, candidates: readonly ChoiceCandidate[]): ChoiceDecision {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('choice response must be valid JSON') }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('choice response must be an object')
  const record = value as Record<string, unknown>
  if (record.status === 'selected') {
    if (Object.keys(record).some(key => key !== 'status' && key !== 'candidateId')) throw new Error('choice response contains unknown keys')
    if (typeof record.candidateId !== 'string' || !candidates.some(candidate => candidate.id === record.candidateId && candidate.disabled !== true)) {
      throw new Error('choice response selected an unknown or disabled candidate')
    }
    return { status: 'selected', candidateId: record.candidateId }
  }
  if (record.status === 'abstain' && typeof record.reason === 'string' && record.reason.trim() !== '') {
    if (Object.keys(record).some(key => key !== 'status' && key !== 'reason')) throw new Error('choice response contains unknown keys')
    return { status: 'abstain', reason: record.reason }
  }
  throw new Error('choice response must select one candidate or abstain')
}

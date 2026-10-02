import { brandString } from '@deepseek-ai/dsh-brand'
import type { Branded } from '@deepseek-ai/dsh-brand'
/** Opaque identity of a Candidate owned by Initiative. */
export type CandidateId = Branded<'InitiativeCandidateId'>
/**
 * Admit a validated or provider-generated Candidate identity without changing its bytes.
 * @param value - Candidate identity validated by the owning schema.
 * @returns The nominal Candidate identity.
 */
export const CandidateId = (value: string): CandidateId => brandString<CandidateId>(value)

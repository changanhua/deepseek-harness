/** Provider-owned authority issuance for Queue facades. */
import { Session } from '@deepseek-ai/dsh-session'
import type { VerifiedAgentAuthority, VerifiedOperatorAuthority } from './types.ts'

const ISSUED_AGENT = new WeakSet<object>()
const ISSUED_OPERATOR = new WeakSet<object>()

/**
 * Create Agent authority from a real live Session, never a caller-supplied id string.
 * @param session Live Agent session.
 * @returns Verified authority restricted to the session.
 */
export function createVerifiedAgentAuthority(session: Session): VerifiedAgentAuthority {
  if (!(session instanceof Session)) throw new TypeError('task queue Agent authority requires a live Session')
  const authority = Object.freeze({ kind: 'agent' as const, sessionId: session.id })
  ISSUED_AGENT.add(authority)
  return authority
}

/**
 * Create an operator authority for a trusted host-provider composition.
 * @returns Verified host operator authority.
 */
export function createVerifiedOperatorAuthority(): VerifiedOperatorAuthority {
  const authority = Object.freeze({ kind: 'operator' as const })
  ISSUED_OPERATOR.add(authority)
  return authority
}

/**
 * Assert that an Agent authority was issued by this Queue package.
 * @param authority Authority presented to an Agent facade.
 */
export function assertVerifiedAgentAuthority(authority: VerifiedAgentAuthority): void {
  if (!ISSUED_AGENT.has(authority)) throw new TypeError('task queue Agent authority was not issued by a trusted provider')
}

/**
 * Assert that an operator authority was issued by this Queue package.
 * @param authority Authority presented to an operator facade.
 */
export function assertVerifiedOperatorAuthority(authority: VerifiedOperatorAuthority): void {
  if (!ISSUED_OPERATOR.has(authority)) throw new TypeError('task queue operator authority was not issued by a trusted provider')
}

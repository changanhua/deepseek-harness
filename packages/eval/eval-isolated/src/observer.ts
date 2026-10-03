/** Authenticated observations from a Host-pinned core; this does not attest arbitrary modified Harness code. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { RoleFrame } from './channel.ts'

/** Host-only observation owner. Bootstrap material must never enter configuration, logs or execution evidence. */
export interface RoleObserver {
  readonly executionId: string
  readonly sessionId: string
  /** Private one-use startup carrier, erased by the Host before acknowledging ready. */
  readonly bootstrap: string
  /** Verify and consume one exact next frame from the pinned core. */
  accept(frame: RoleFrame): RoleFrame
  /** Authenticate the Host response so a task cannot forge model results in the exchange files. */
  respond(frame: RoleFrame): RoleFrame
}

/** Private core reporter and authenticated Host-response reader. */
export interface RoleReporter {
  (frame: RoleFrame): RoleFrame
  acceptResponse(frame: RoleFrame): RoleFrame
}

interface Bootstrap { executionId: string; sessionId: string; secret: string }

function signature(key: Buffer, identity: Bootstrap, frame: RoleFrame, direction: 'request' | 'response'): Buffer {
  return createHmac('sha256', key).update(JSON.stringify({ direction, executionId: identity.executionId, sessionId: identity.sessionId,
    sequence: frame.sequence, kind: frame.kind, value: frame.value })).digest()
}

function verify(key: Buffer, identity: Bootstrap, frame: RoleFrame, direction: 'request' | 'response'): RoleFrame {
  const envelope = frame.value as { payload?: unknown; mac?: unknown } | null
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !('payload' in envelope)
    || typeof envelope.mac !== 'string' || !/^[a-f0-9]{64}$/u.test(envelope.mac)
    || Object.keys(envelope).some(key => !['payload', 'mac'].includes(key))) throw new Error('eval-observer-signature')
  const actual = { sequence: frame.sequence, kind: frame.kind, value: envelope.payload }
  if (!timingSafeEqual(signature(key, identity, actual, direction), Buffer.from(envelope.mac, 'hex'))) throw new Error('eval-observer-signature')
  return actual
}

/**
 * Allocate an execution-specific authentication secret for the locked core's private bootstrap input.
 * @param executionId Host-owned role execution id.
 * @param sessionId Host-owned Session identity.
 * @returns A non-serializable live observer. The caller must erase the bootstrap carrier before allowing Agent input.
 */
export function createRoleObserver(executionId: string, sessionId: string): RoleObserver {
  if (!executionId || !sessionId) throw new Error('eval-observer-invalid-identity')
  const key = randomBytes(32)
  const identity: Bootstrap = { executionId, sessionId, secret: key.toString('hex') }
  let sequence = 0
  const observer = { executionId, sessionId, accept(frame: RoleFrame): RoleFrame {
    const actual = verify(key, identity, frame, 'request')
    if (frame.sequence !== sequence + 1) throw new Error('eval-observer-replay')
    sequence = frame.sequence
    return actual
  }, respond(frame: RoleFrame): RoleFrame {
    if (frame.sequence !== sequence) throw new Error('eval-observer-replay')
    return { ...frame, value: { payload: frame.value, mac: signature(key, identity, frame, 'response').toString('hex') } }
  } }
  Object.defineProperty(observer, 'bootstrap', { value: JSON.stringify(identity), enumerable: false })
  return Object.freeze(observer) as RoleObserver
}

/**
 * Read the private Host bootstrap once, inside the pinned core before it admits any Agent work.
 * @param bootstrap Private inherited input, never a role-writable path or environment variable.
 * @returns Core-local frame signer; neither the signer nor key may be exposed to task plugins or tool subprocesses.
 */
export function createRoleReporter(bootstrap: string): RoleReporter {
  const input: unknown = JSON.parse(bootstrap)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('eval-observer-invalid-bootstrap')
  const identity = input as Bootstrap
  if (typeof identity.executionId !== 'string' || !identity.executionId || typeof identity.sessionId !== 'string' || !identity.sessionId
    || typeof identity.secret !== 'string' || !/^[a-f0-9]{64}$/u.test(identity.secret)) throw new Error('eval-observer-invalid-bootstrap')
  const key = Buffer.from(identity.secret, 'hex')
  return Object.assign((frame: RoleFrame): RoleFrame => ({ ...frame, value: { payload: frame.value,
    mac: signature(key, identity, frame, 'request').toString('hex') } }), {
    acceptResponse: (frame: RoleFrame) => verify(key, identity, frame, 'response'),
  })
}

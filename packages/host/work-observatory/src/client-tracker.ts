/** Host-authoritative Human activity state machine. */

import type { ClientObservation, ClientObservationAck } from './types.ts'
import type { WorkObservatoryDatabase } from './database.ts'

const MAX_CLIENT_ID_LENGTH = 128

/** Validates browser snapshots and commits them using Host receive timestamps. */
export class HumanActivityTracker {
  /**
   * @param database - package-owned accounting store.
   * @param staleAfterMs - maximum accepted age of the last producer evidence.
   */
  constructor(
    private readonly database: WorkObservatoryDatabase,
    private readonly staleAfterMs: number,
  ) {
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs <= 0) {
      throw new TypeError('staleAfterMs must be a positive safe integer')
    }
  }

  /**
   * Validate and commit one browser observation.
   * @param input - browser snapshot; its clock is diagnostic only.
   * @param receivedAt - Host receive timestamp used for all accounting transitions.
   * @returns whether the producer sequence advanced.
   */
  observe(input: ClientObservation, receivedAt: number): ClientObservationAck {
    validateObservation(input)
    assertEpoch(receivedAt, 'receivedAt')
    return { accepted: this.database.acceptClientObservation(input, receivedAt) }
  }

  /**
   * Close stale producers at their last evidence.
   * @param now - Host sweep timestamp.
   * @returns number of producer states closed.
   */
  sweepStale(now: number): number {
    assertEpoch(now, 'now')
    return this.database.closeStaleClients(now, this.staleAfterMs)
  }
}

function validateObservation(input: ClientObservation): void {
  const candidate: unknown = input
  if (typeof candidate !== 'object' || candidate === null) {
    throw new TypeError('ClientObservation must be an object')
  }
  if (typeof input.clientId !== 'string' || input.clientId.length === 0 || input.clientId.length > MAX_CLIENT_ID_LENGTH) {
    throw new TypeError(`clientId must be a non-empty string of at most ${MAX_CLIENT_ID_LENGTH} characters`)
  }
  if (!Number.isSafeInteger(input.seq) || input.seq < 0) {
    throw new TypeError('seq must be a non-negative safe integer')
  }
  if (typeof input.visible !== 'boolean' || typeof input.active !== 'boolean') {
    throw new TypeError('visible and active must be booleans')
  }
  if (input.active && !input.visible) {
    throw new TypeError('active requires visible')
  }
  assertEpoch(input.clientObservedAt, 'clientObservedAt')
}

function assertEpoch(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe epoch millisecond`)
  }
}

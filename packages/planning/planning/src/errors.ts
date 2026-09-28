export type PlanningErrorCode =
  | 'unauthorized'
  | 'not-found'
  | 'conflict'
  | 'idempotency-conflict'
  | 'invalid-reference'
  | 'capacity-exceeded'
  | 'closed'
  | 'source-unavailable'
export class PlanningError extends Error {
  constructor(
    readonly code: PlanningErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'PlanningError'
  }
}

/** Stable failures emitted by the Host-only GitHub Issue publisher. */

export type DeliveryGitHubPublisherErrorCode =
  | 'not-found'
  | 'unmapped-repository'
  | 'missing-credential'
  | 'invalid-state'
  | 'http-failure'
  | 'invalid-response'
  | 'transport'
  | 'aborted'

/** Typed publisher failure without credential or raw provider-response content. */
export class DeliveryGitHubPublisherError extends Error {
  constructor(
    readonly code: DeliveryGitHubPublisherErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'DeliveryGitHubPublisherError'
  }
}

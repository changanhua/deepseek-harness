export interface TransportConfig {
  evidenceRoot: string
  endpoint: string
  model: string
  maxRequests?: number
  maxCandidateRequests?: number
}
export interface AdmittedRequest { phase: 'candidate' | 'assessment'; ordinal: number }
export interface TransportGuard {
  fetch(url: string, init: RequestInit): Promise<Response>
  withRequest<T>(request: AdmittedRequest, action: () => T): T
}
/** Persist and bound actual adapter HTTP attempts before calling the supplied transport. */
export function createTransportGuard(config: TransportConfig, upstream?: typeof fetch): Promise<TransportGuard>

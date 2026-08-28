/** Proxy metadata sanitization for host runtime facts. */

import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'

const PROXY_VARIABLES = [
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'https_proxy',
  'http_proxy',
  'all_proxy',
] as const

/** Secret-free scalar proxy metadata derived from one launch snapshot. */
export interface SanitizedProxy {
  readonly configured: boolean
  readonly scheme?: string
  readonly host?: string
  readonly port?: number
  readonly source?: 'env'
}

/**
 * Parse the highest-priority proxy variable without retaining credentials,
 * paths, queries, fragments, or the raw URL.
 * @param environment - immutable launcher-owned environment snapshot.
 * @returns scalar connection metadata, or `configured: false` for absence or malformed input.
 */
export function sanitizeProxy(environment: LaunchEnvironmentSnapshot): SanitizedProxy {
  const entry = PROXY_VARIABLES
    .map(name => environment.get(name))
    .find(candidate => candidate !== undefined && candidate.value.length > 0)
  if (entry === undefined) return { configured: false }
  try {
    const parsed = new URL(entry.value)
    const scheme = parsed.protocol.slice(0, -1).toLowerCase()
    if (scheme.length === 0 || parsed.hostname.length === 0) return { configured: false }
    const port = parsed.port.length === 0 ? undefined : Number(parsed.port)
    if (port !== undefined && (!Number.isSafeInteger(port) || port < 1 || port > 65_535)) {
      return { configured: false }
    }
    return {
      configured: true,
      scheme,
      host: parsed.hostname,
      ...port === undefined ? {} : { port },
      source: 'env',
    }
  } catch {
    return { configured: false }
  }
}

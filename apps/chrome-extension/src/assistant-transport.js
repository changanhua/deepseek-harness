import { normalizeBaseUrl } from './pending.js'
import { createVerifier } from './transport.js'

const API = '/api/browser-extension/v1'
const BASE64_URL = /^[A-Za-z0-9_-]+$/u
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const EXTENSION_ID = /^[a-p]{32}$/u
const MAX_BODY_BYTES = 64 * 1024

export class AssistantTransportError extends Error {
  constructor(code, status) {
    super(code)
    this.code = code
    this.status = status
  }
}

const base64Url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')

const decodeBase64Url = (value, code) => {
  if (typeof value !== 'string' || !BASE64_URL.test(value) || value.includes('=')) throw new AssistantTransportError(code)
  try {
    const bytes = Uint8Array.from(atob(value.replace(/-/gu, '+').replace(/_/gu, '/')), char => char.charCodeAt(0))
    if (base64Url(bytes) !== value) throw new AssistantTransportError(code)
    return bytes
  } catch (error) {
    if (error instanceof AssistantTransportError) throw error
    throw new AssistantTransportError(code)
  }
}

const challengeFor = async verifier => {
  const bytes = decodeBase64Url(verifier, 'invalid_verifier')
  if (bytes.byteLength !== 32) throw new AssistantTransportError('invalid_verifier')
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

const endpoint = (baseUrl, path) => `${normalizeBaseUrl(baseUrl)}${API}${path}`
const sameStrings = (actual, expected) => actual.length === expected.length && actual.every((value, index) => value === expected[index])

const normalizeScopes = scopes => {
  if (!Array.isArray(scopes) || !scopes.length || scopes.some(scope => typeof scope !== 'string' || !scope.trim())) throw new AssistantTransportError('invalid_scopes')
  return [...new Set(scopes.map(scope => scope.trim()))]
}

const normalizeOrigins = origins => {
  if (!Array.isArray(origins)) throw new AssistantTransportError('invalid_origins')
  const normalized = origins.map(raw => {
    if (raw === '*') return raw
    try {
      const url = new URL(raw)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
      return url.origin
    } catch {
      throw new AssistantTransportError('invalid_origins')
    }
  })
  return [...new Set(normalized)]
}

const validExpiry = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const validInstallationId = value => UUID_V4.test(value)
const validRequestId = value => UUID_V4.test(value)
const validExtensionId = value => EXTENSION_ID.test(value)

const readBoundedText = async (response, signal) => {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new AssistantTransportError('response_too_large')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel() }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new AssistantTransportError('response_too_large')
      }
      chunks.push(value)
    }
  } finally {
    signal.removeEventListener('abort', cancel)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

const requestJson = async (fetchImpl, url, init, { signal, timeoutMs }, expectedStatus) => {
  if (signal?.aborted) throw new AssistantTransportError('cancelled')
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
      credentials: 'omit', redirect: 'error', signal: controller.signal,
    })
    if (!expectedStatus.includes(response.status)) throw new AssistantTransportError('request_failed', response.status)
    const text = await readBoundedText(response, controller.signal)
    if (controller.signal.aborted) throw new AssistantTransportError('request_timeout')
    let body
    try { body = JSON.parse(text) } catch { throw new AssistantTransportError('invalid_response', response.status) }
    if (!body || typeof body !== 'object') throw new AssistantTransportError('invalid_response', response.status)
    return { response, body }
  } catch (error) {
    if (controller.signal.aborted) throw new AssistantTransportError(signal?.aborted ? 'cancelled' : 'request_timeout')
    if (error instanceof AssistantTransportError) throw error
    throw new AssistantTransportError('network_error')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

const validateInfo = info => {
  if (info.protocolVersion !== 1 || !Array.isArray(info.capabilities) || !info.capabilities.includes('browser:rpc') || !Array.isArray(info.scopes)) {
    throw new AssistantTransportError('unsupported_protocol', 200)
  }
  return info
}

const validatePending = (candidate, expected) => {
  if (!candidate || candidate.status !== 'pending' || !validRequestId(candidate.requestId) || !validExpiry(candidate.expiresAt)) throw new AssistantTransportError('invalid_connect_response', 201)
  if (Date.parse(candidate.expiresAt) <= Date.now()) throw new AssistantTransportError('expired')
  if (candidate.extensionId !== expected.extensionId || candidate.installationId !== expected.installationId) throw new AssistantTransportError('identity_mismatch', 201)
  const scopes = normalizeScopes(candidate.scopes)
  const origins = normalizeOrigins(candidate.origins)
  if (!sameStrings(scopes, expected.scopes) || !sameStrings(origins, expected.origins)) throw new AssistantTransportError('identity_mismatch', 201)
  return { ...candidate, ...expected, requestId: candidate.requestId, expiresAt: candidate.expiresAt, status: 'pending' }
}

const validateGrant = (grant, pending) => {
  if (!grant || typeof grant !== 'object' || grant.installationId !== pending.installationId || grant.extensionId !== pending.extensionId
    || !Number.isSafeInteger(grant.grantEpoch) || grant.grantEpoch < 1 || !validExpiry(grant.createdAt)) throw new AssistantTransportError('invalid_grant', 200)
  const scopes = normalizeScopes(grant.scopes)
  const origins = normalizeOrigins(grant.origins)
  if (!scopes.every(scope => pending.scopes.includes(scope)) || !origins.every(origin => pending.origins.includes('*') || pending.origins.includes(origin))) throw new AssistantTransportError('invalid_grant', 200)
  return { installationId: grant.installationId, extensionId: grant.extensionId, grantEpoch: grant.grantEpoch, scopes, origins, createdAt: grant.createdAt }
}

const validateToken = token => {
  const bytes = decodeBase64Url(token, 'invalid_token_response')
  if (bytes.byteLength !== 32) throw new AssistantTransportError('invalid_token_response', 200)
  return token
}

/** Creates the one-shot HTTP adapter for an independently granted browser assistant. */
export const createAssistantTransport = ({ fetchImpl = fetch, openApproval }) => {
  const info = async ({ baseUrl, signal }) => {
    const { body } = await requestJson(fetchImpl, endpoint(baseUrl, '/info'), { method: 'POST' }, { signal, timeoutMs: 3_000 }, [200])
    return validateInfo(body)
  }

  return {
    info,

    async begin({ baseUrl, installationId, extensionId, scopes, origins, verifier = createVerifier(), signal }) {
      if (!validInstallationId(installationId) || !validExtensionId(extensionId)) throw new AssistantTransportError('invalid_identity')
      if (signal?.aborted) throw new AssistantTransportError('cancelled')
      const normalized = normalizeBaseUrl(baseUrl)
      const requested = { baseUrl: normalized, installationId, extensionId, scopes: normalizeScopes(scopes), origins: normalizeOrigins(origins), verifier }
      const serviceInfo = await info({ baseUrl: normalized, signal })
      const supportedScopes = normalizeScopes(serviceInfo.scopes)
      if (!requested.scopes.every(scope => supportedScopes.includes(scope))) throw new AssistantTransportError('unsupported_scope')
      const { body } = await requestJson(fetchImpl, endpoint(normalized, '/connect'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extensionId, installationId, challenge: await challengeFor(verifier), scopes: requested.scopes, origins: requested.origins }),
      }, { signal, timeoutMs: 10_000 }, [201])
      const pending = validatePending(body, requested)
      if (typeof openApproval !== 'function') throw new AssistantTransportError('approval_unavailable')
      await openApproval(`${normalized}/browser-assistant?requestId=${encodeURIComponent(pending.requestId)}`)
      return pending
    },

    async exchange(pending, { signal } = {}) {
      if (!pending || typeof pending !== 'object' || !validRequestId(pending.requestId) || !validInstallationId(pending.installationId) || !validExtensionId(pending.extensionId) || !validExpiry(pending.expiresAt)) {
        throw new AssistantTransportError('invalid_pending')
      }
      if (Date.parse(pending.expiresAt) <= Date.now()) throw new AssistantTransportError('expired')
      if (signal?.aborted) throw new AssistantTransportError('cancelled')
      const normalized = normalizeBaseUrl(pending.baseUrl)
      const expected = { ...pending, baseUrl: normalized, scopes: normalizeScopes(pending.scopes), origins: normalizeOrigins(pending.origins) }
      await challengeFor(expected.verifier)
      const { response, body } = await requestJson(fetchImpl, endpoint(normalized, `/connect/${encodeURIComponent(expected.requestId)}/token`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ installationId: expected.installationId, verifier: expected.verifier }),
      }, { signal, timeoutMs: 10_000 }, [200, 202])
      if (response.status === 202) {
        if (body.status !== 'pending') throw new AssistantTransportError('invalid_token_response', 202)
        return { phase: 'pending' }
      }
      if (body.status !== 'connected') throw new AssistantTransportError('invalid_token_response', 200)
      return { phase: 'connected', token: validateToken(body.token), grant: validateGrant(body.grant, expected) }
    },
  }
}

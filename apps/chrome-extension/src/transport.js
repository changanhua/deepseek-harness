import { normalizeBaseUrl } from './pending.js'

const API = '/api/content-browser/v1'
const base64Url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
const decodeBase64Url = value => Uint8Array.from(atob(value.replace(/-/gu, '+').replace(/_/gu, '/')), char => char.charCodeAt(0))

export class ContentBrowserError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status }
}

const readJson = async response => {
  const body = await response.json().catch(() => ({}))
  if (!response.ok && response.status !== 202) throw new ContentBrowserError(typeof body.error === 'string' ? body.error : 'request_failed', response.status)
  return body
}

const fetchWithPolicy = async (fetchImpl, url, init = {}, { signal, fetchTimeoutMs = 10_000 } = {}) => {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), fetchTimeoutMs)
  try {
    return await fetchImpl(url, { ...init, credentials: 'omit', redirect: 'error', signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) throw new ContentBrowserError(signal?.aborted ? 'cancelled' : 'request_timeout')
    throw new ContentBrowserError('network_error')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

const request = async (fetchImpl, url, init = {}, options) => readJson(await fetchWithPolicy(fetchImpl, url, {
  ...init, headers: { Accept: 'application/json', ...init.headers },
}, options))

export const createVerifier = () => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

const challengeFor = async verifier => base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', decodeBase64Url(verifier))))
const endpoint = (baseUrl, path) => `${normalizeBaseUrl(baseUrl)}${API}${path}`

export const createContentBrowserTransport = ({ fetchImpl = fetch, openApproval, sleep = delay => new Promise(resolve => setTimeout(resolve, delay * 1000)) }) => {
  const tokenRequest = async (pending, signal, fetchTimeoutMs) => {
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), fetchTimeoutMs)
    try {
      return await fetchImpl(endpoint(pending.baseUrl, `/connect/${encodeURIComponent(pending.requestId)}/token`), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, credentials: 'omit', redirect: 'error', signal: controller.signal,
        body: JSON.stringify({ installationId: pending.installationId, verifier: pending.verifier }),
      })
    } catch (error) {
      if (controller.signal.aborted) throw new ContentBrowserError(signal?.aborted ? 'cancelled' : 'token_request_timeout')
      throw new ContentBrowserError('network_error')
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  const poll = async (pending, { maximumTokenAttempts = Infinity, signal, fetchTimeoutMs = 10_000 } = {}) => {
    const expiresAt = Date.parse(pending.expiresAt)
    if (!Number.isFinite(expiresAt)) throw new ContentBrowserError('invalid_connect_expiry', 200)
    for (let attempt = 0; attempt < maximumTokenAttempts && Date.now() < expiresAt; attempt += 1) {
      if (signal?.aborted) throw new ContentBrowserError('cancelled')
      const response = await tokenRequest(pending, signal, fetchTimeoutMs)
      const body = await readJson(response)
      if (response.status === 202) {
        if (attempt + 1 < maximumTokenAttempts && Date.now() < expiresAt) await sleep(1, signal)
        continue
      }
      if (typeof body.token !== 'string' || !body.token) throw new ContentBrowserError('invalid_token_response', response.status)
      return { phase: 'connected', token: body.token }
    }
    return Date.now() >= expiresAt ? { phase: 'expired' } : { phase: 'pending', ...pending }
  }

  return {
    async info({ baseUrl, signal }) {
      const info = await request(fetchImpl, endpoint(baseUrl, '/info'), { method: 'POST' }, { signal, fetchTimeoutMs: 3000 })
      if (info.protocolVersion !== 1 || !Array.isArray(info.capabilities) || !info.capabilities.includes('content:import')) throw new ContentBrowserError('unsupported_protocol', 200)
      return info
    },
    async begin({ baseUrl, extensionId, installationId, verifier = createVerifier(), maximumTokenAttempts = Infinity, signal, onPending = async () => {} }) {
      const normalized = normalizeBaseUrl(baseUrl)
      const info = await request(fetchImpl, endpoint(normalized, '/info'), { method: 'POST' }, { signal })
      if (info.protocolVersion !== 1 || !Array.isArray(info.capabilities) || !info.capabilities.includes('content:import')) throw new ContentBrowserError('unsupported_protocol', 200)
      const connect = await request(fetchImpl, endpoint(normalized, '/connect'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge: await challengeFor(verifier), installationId, extensionId }),
      }, { signal })
      if (typeof connect.requestId !== 'string' || typeof connect.expiresAt !== 'string') throw new ContentBrowserError('invalid_connect_response', 200)
      const pending = { baseUrl: normalized, installationId, verifier, requestId: connect.requestId, expiresAt: connect.expiresAt }
      await onPending(pending)
      await openApproval(`${normalized}/#extension-connect=${encodeURIComponent(connect.requestId)}`)
      return poll(pending, { maximumTokenAttempts, signal })
    },
    poll,
    async import({ baseUrl, token, request: capture, signal }) {
      const body = await request(fetchImpl, endpoint(baseUrl, '/import'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(capture),
      }, { signal })
      const { receipt } = body
      if (
        !receipt || receipt.entryId !== `web:${capture.captureId}` || receipt.operationId !== capture.captureId
        || !Number.isSafeInteger(receipt.entryRevision) || receipt.entryRevision < 1
        || !Number.isSafeInteger(receipt.draftRevision) && receipt.draftRevision !== null
        || typeof receipt.versionId !== 'string' && receipt.versionId !== null
      ) throw new ContentBrowserError('invalid_receipt', 200)
      return { phase: 'saved', entryId: body.receipt.entryId, receipt: body.receipt }
    },
  }
}

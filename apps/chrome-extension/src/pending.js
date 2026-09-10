const PENDING_KEY = 'dsh.pendingCapture.v1'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

/** @typedef {{ url: string, pageTitle: string, site: string, kind: 'selection'|'single-reply', capturedAt: string, externalMessageId?: string }} CaptureSource */
/** @typedef {{ captureId: string, title: string, markdown: string, source: CaptureSource }} CaptureRequest */
/** @typedef {{ baseUrl: string, request: CaptureRequest }} PendingSnapshot */

const clone = value => structuredClone(value)

const normalizeBaseUrl = raw => {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('DSH 服务地址必须是无凭证的 HTTP 或 HTTPS URL')
  if (url.pathname !== '/' && url.pathname !== '') throw new TypeError('当前 DSH 服务地址必须是 origin 根地址，不支持子路径')
  url.search = ''
  url.hash = ''
  url.pathname = ''
  return url.href.replace(/\/$/u, '')
}

/** @param {{ title: string, markdown: string, source: CaptureSource }} input @param {() => string} [createId] @returns {CaptureRequest} */
export const createCaptureRequest = ({ title, markdown, source }, createId = () => crypto.randomUUID()) => {
  const captureId = createId()
  if (!UUID_V4.test(captureId)) throw new TypeError('captureId 必须是 UUIDv4')
  if (!title.trim() || !markdown.trim()) throw new TypeError('标题和正文不能为空')
  return clone({ captureId, title, markdown, source })
}

/** Freezes request and target together so retries never send a different body or server. */
/** @param {string} baseUrl @param {CaptureRequest} request @returns {Readonly<PendingSnapshot>} */
export const createPendingSnapshot = (baseUrl, request) => Object.freeze(clone({ baseUrl: normalizeBaseUrl(baseUrl), request }))

export const createPendingStore = storage => ({
  async load() {
    const result = await storage.get(PENDING_KEY)
    return result[PENDING_KEY] ? clone(result[PENDING_KEY]) : null
  },
  async save(snapshot) {
    const current = await this.load()
    if (current && current.request.captureId !== snapshot.request.captureId) throw new Error('已有待确认采集，请先确认或清除它')
    await storage.set({ [PENDING_KEY]: clone(snapshot) })
  },
  async clear() { await storage.remove(PENDING_KEY) },
})

/** The protocol adapter must return a durable receipt; all other outcomes remain unknown. */
export const submitPending = async (snapshot, transport) => {
  const receipt = await transport.submit(clone(snapshot))
  return receipt?.kind === 'receipt' && typeof receipt.entryId === 'string'
    ? { phase: 'saved', entryId: receipt.entryId }
    : { phase: 'unknown' }
}

export { normalizeBaseUrl }

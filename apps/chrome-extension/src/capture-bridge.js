const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const EXTENSION_ID = /^[a-p]{32}$/u
const KINDS = new Set(['selection', 'single-reply'])

const failure = code => Object.assign(new Error(code), { code })
const pageUrl = raw => {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw failure('unsupported_page')
    return url
  } catch (error) { throw error?.code ? error : failure('unsupported_page') }
}

const validateSender = (sender, extensionId) => {
  if (!sender || sender.id !== extensionId || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)) throw failure('invalid_sender')
  return pageUrl(sender.url)
}

const validatePayload = (payload, sender, extensionId) => {
  const current = validateSender(sender, extensionId)
  if (!payload || typeof payload.markdown !== 'string' || !payload.markdown.trim()) throw failure('invalid_capture')
  const source = payload.source
  if (!source || !KINDS.has(source.kind) || typeof source.pageTitle !== 'string' || typeof source.site !== 'string'
    || typeof source.capturedAt !== 'string' || !Number.isFinite(Date.parse(source.capturedAt))) throw failure('invalid_capture')
  const sourceUrl = pageUrl(source.url)
  if (sourceUrl.origin !== current.origin) throw failure('source_mismatch')
  return {
    title: typeof payload.title === 'string' ? payload.title : source.pageTitle,
    markdown: payload.markdown,
    source: {
      url: sourceUrl.href, pageTitle: source.pageTitle, site: source.site, kind: source.kind, capturedAt: source.capturedAt,
      ...(typeof source.externalMessageId === 'string' ? { externalMessageId: source.externalMessageId } : {}),
    },
  }
}

/** Bridge page-origin messages to the durable capture controller. */
export const createCaptureBridge = ({ controller, extensionId, openTab }) => {
  if (!controller || typeof controller.receive !== 'function' || typeof controller.save !== 'function' || typeof controller.receipt !== 'function') throw new TypeError('invalid_controller')
  if (!EXTENSION_ID.test(extensionId) || typeof openTab !== 'function') throw new TypeError('invalid_bridge_options')
  const quickCapture = async (payload, sender) => {
    const request = validatePayload(payload, sender, extensionId)
    const capture = await controller.receive(request, sender.tab.id)
    const saved = await controller.save(capture.captureId, true)
    return { ok: true, status: 'saved', entryId: saved.entryId }
  }
  const openCaptured = async (entryId, sender) => {
    const current = validateSender(sender, extensionId)
    if (typeof entryId !== 'string' || !entryId) throw failure('invalid_entry')
    const receipt = await controller.receipt(entryId)
    if (!receipt || receipt.entryId !== entryId || !Number.isInteger(receipt.sourceTabId)) throw failure('receipt_missing')
    const source = pageUrl(receipt.sourceUrl)
    if (source.origin !== current.origin || receipt.sourceTabId !== sender.tab.id) throw failure('receipt_mismatch')
    const base = pageUrl(receipt.baseUrl)
    await openTab(`${base.origin}/#content-entry=${encodeURIComponent(receipt.entryId)}`)
    return { ok: true }
  }
  return { quickCapture, openCaptured }
}

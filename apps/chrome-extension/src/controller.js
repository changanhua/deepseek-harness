import { createCaptureRequest, createPendingStore, normalizeBaseUrl } from './pending.js'
import { createVerifier } from './transport.js'

export const DEFAULT_BASE_URL = 'http://127.0.0.1:3080'
const CONFIG_KEY = 'dsh.connection.v1'
const CAPTURE_KEY = 'dsh.capture.v2'
const RECEIPT_KEY = 'dsh.savedReceipt.v1'
const RECEIPTS_KEY = 'dsh.receiptLinks.v2'
const errorCode = error => error?.code ?? error?.message ?? 'request_failed'
const failure = code => Object.assign(new Error(code), { code })
const requestOf = capture => ({ captureId: capture.captureId, title: capture.title, markdown: capture.markdown, source: capture.source })
const signatureOf = capture => JSON.stringify({ title: capture.title, markdown: capture.markdown, source: { ...capture.source, capturedAt: undefined } })

/** One trusted extension owner for draft identity, target binding and durable receipts. */
export const createExtensionController = ({ storage, transport, hasPermission, changed = () => {} }) => {
  const legacyPending = createPendingStore(storage)
  let lane = Promise.resolve()
  let busy = false
  let connecting = null
  let connectionAbort = null
  let generation = 0
  const serial = action => {
    const result = lane.then(action, action)
    lane = result.then(() => {}, () => {})
    return result
  }
  const get = async key => (await storage.get(key))[key] ?? null
  const put = async (key, value) => { await storage.set({ [key]: value }); changed() }
  const connection = async () => {
    const stored = await get(CONFIG_KEY)
    if (stored) return stored
    const initial = { baseUrl: DEFAULT_BASE_URL, installationId: crypto.randomUUID() }
    await put(CONFIG_KEY, initial)
    return initial
  }
  const ready = serial(async () => {
    await connection()
    const capture = await get(CAPTURE_KEY)
    if (capture?.status === 'saving') await put(CAPTURE_KEY, { ...capture, status: 'unknown', attempted: true, error: 'result_unknown' })
    if (!capture) {
      const old = await legacyPending.load()
      if (old) await put(CAPTURE_KEY, { ...old.request, baseUrl: old.baseUrl, status: 'unknown', attempted: true, error: 'result_unknown' })
    }
  })
  const read = async () => {
    await ready
    const c = await connection()
    return {
      connection: { baseUrl: c.baseUrl, phase: c.pending ? 'pending' : c.error === 'unauthorized' ? 'unauthorized' : c.error ? 'offline' : c.token ? 'connected' : 'configured', ...(c.error ? { error: c.error } : {}) },
      capture: await get(CAPTURE_KEY),
    }
  }
  const currentCapture = async id => {
    const capture = await get(CAPTURE_KEY)
    if (!capture || capture.captureId !== id) throw failure('capture_changed')
    return capture
  }
  const check = async () => {
    await ready
    const c = await connection()
    const epoch = generation
    let error
    try {
      if (!await hasPermission(c.baseUrl)) throw failure('permission_required')
      await transport.info({ baseUrl: c.baseUrl })
    } catch (e) { error = errorCode(e) }
    await serial(async () => {
      const latest = await connection()
      if (generation !== epoch || latest.baseUrl !== c.baseUrl) return
      await put(CONFIG_KEY, { ...latest, error: error ?? (latest.error === 'unauthorized' ? 'unauthorized' : undefined) })
    })
    return read()
  }
  const cancel = async () => {
    generation += 1
    connectionAbort?.abort()
    connecting = null
    await serial(async () => { const c = await connection(); await put(CONFIG_KEY, { ...c, pending: undefined }) })
  }
  const connect = async () => {
    await ready
    if (connecting) return connecting
    const epoch = ++generation
    connectionAbort = new AbortController()
    const signal = connectionAbort.signal
    const work = (async () => {
      const c = await connection()
      if (!await hasPermission(c.baseUrl)) throw failure('permission_required')
      const verifier = c.pending?.verifier ?? createVerifier()
      const pending = c.pending ?? { baseUrl: c.baseUrl, installationId: c.installationId, verifier }
      await serial(async () => {
        if (epoch !== generation) throw failure('cancelled')
        await put(CONFIG_KEY, { ...c, pending, error: undefined })
      })
      try {
        const result = pending.requestId
          ? await transport.poll(pending, { signal })
          : await transport.begin({ baseUrl: c.baseUrl, installationId: c.installationId, verifier, signal,
              onPending: next => serial(async () => {
                if (epoch !== generation) throw failure('cancelled')
                await put(CONFIG_KEY, { ...c, pending: next, error: undefined })
              }) })
        await serial(async () => {
          if (epoch !== generation) throw failure('cancelled')
          if (result.phase !== 'connected') {
            await put(CONFIG_KEY, { ...c, pending: undefined, error: 'connection_expired' })
            throw failure('connection_expired')
          }
          await put(CONFIG_KEY, { ...c, token: result.token, pending: undefined, error: undefined })
        })
      } catch (error) {
        await serial(async () => {
          if (epoch !== generation) return
          const latest = await connection()
          await put(CONFIG_KEY, { ...latest, pending: undefined, error: errorCode(error) })
        })
        throw error
      }
    })()
    connecting = work
    try { await work } finally { if (connecting === work) connecting = null }
    return read()
  }
  const save = async (id, allowConnect = false) => {
    await ready
    if (busy) throw failure('busy')
    busy = true
    try {
      const original = await currentCapture(id)
      if (original.status === 'saved') return original
      let c = await connection()
      if (c.baseUrl !== original.baseUrl) throw failure('target_changed')
      if (!c.token) {
        if (!allowConnect) throw failure('authorization_required')
        await connect()
        c = await connection()
      }
      return await serial(async () => {
        const capture = await currentCapture(id)
        const latest = await connection()
        if (latest.baseUrl !== capture.baseUrl || latest.token !== c.token) throw failure('target_changed')
        if (!await hasPermission(capture.baseUrl)) throw failure('permission_required')
        const request = requestOf(capture)
        await put(CAPTURE_KEY, { ...capture, attempted: true, status: 'saving', error: undefined })
        try {
          const result = await transport.import({ baseUrl: capture.baseUrl, token: c.token, request })
          const saved = { ...capture, attempted: true, status: 'saved', error: undefined, entryId: result.entryId }
          const receipt = { entryId: result.entryId, baseUrl: capture.baseUrl, sourceUrl: capture.source.url, sourceTabId: capture.sourceTabId }
          const links = await get(RECEIPTS_KEY) ?? []
          await storage.set({ [CONFIG_KEY]: { ...latest, error: undefined }, [CAPTURE_KEY]: saved,
            [RECEIPT_KEY]: { entryId: result.entryId, baseUrl: capture.baseUrl, sourceUrl: capture.source.url, signature: signatureOf(capture), capture: saved },
            [RECEIPTS_KEY]: [...links.filter(link => link.entryId !== result.entryId || link.baseUrl !== capture.baseUrl), receipt].slice(-64),
          })
          await legacyPending.clear()
          changed()
          return saved
        } catch (error) {
          const code = errorCode(error)
          const unknown = ['network_error', 'request_timeout', 'invalid_receipt', 'result_unknown'].includes(code)
          await put(CAPTURE_KEY, { ...capture, attempted: true, status: unknown ? 'unknown' : 'failed', error: code })
          if (code === 'unauthorized' || error.status === 401) await put(CONFIG_KEY, { ...latest, token: undefined, error: 'unauthorized' })
          else if (unknown) await put(CONFIG_KEY, { ...latest, error: code })
          throw error
        }
      })
    } finally { busy = false }
  }
  const receive = async (payload, sourceTabId) => {
    await ready
    if (busy) throw failure('busy')
    return serial(async () => {
      const c = await connection()
      const title = payload.title?.trim() || payload.source.pageTitle?.trim() || '网页片段'
      const request = createCaptureRequest({ title: title.slice(0, 160), markdown: payload.markdown, source: payload.source })
      if (new Blob([JSON.stringify(request)]).size > 1024 * 1024) throw failure('capture_too_large')
      const previous = await get(CAPTURE_KEY)
      if (previous && previous.status !== 'saved') {
        if (signatureOf(previous) === signatureOf(request) && previous.baseUrl === c.baseUrl) return previous
        throw failure(previous.attempted ? 'pending_unconfirmed' : 'pending_exists')
      }
      const last = await get(RECEIPT_KEY)
      if (last?.capture && last.baseUrl === c.baseUrl && last.signature === signatureOf(request)) {
        const reused = { ...last.capture, sourceTabId }
        await put(CAPTURE_KEY, reused)
        await put(RECEIPT_KEY, { ...last, capture: reused })
        return reused
      }
      const next = { ...request, baseUrl: c.baseUrl, sourceTabId, status: 'draft', attempted: false }
      await put(CAPTURE_KEY, next)
      return next
    })
  }
  return {
    read, receive, save, check, connect, cancel,
    async configure(raw) {
      const baseUrl = normalizeBaseUrl(raw)
      if (!await hasPermission(baseUrl)) throw failure('permission_required')
      const old = await connection()
      if (old.baseUrl === baseUrl) return read()
      await cancel()
      await serial(() => put(CONFIG_KEY, { baseUrl, installationId: crypto.randomUUID() }))
      return read()
    },
    async title(id, title) {
      if (busy) throw failure('busy')
      await serial(async () => {
        const c = await currentCapture(id)
        if (c.attempted) throw failure('capture_frozen')
        if (typeof title !== 'string' || !title.trim() || title.length > 160) throw failure('invalid_title')
        await put(CAPTURE_KEY, { ...c, title: title.trim() })
      })
    },
    async discard(id) {
      if (busy) throw failure('busy')
      await serial(async () => {
        const c = await currentCapture(id)
        if (c.attempted && c.status !== 'saved') throw failure('pending_unconfirmed')
        await storage.remove(CAPTURE_KEY)
        changed()
      })
    },
    async receipt(id) {
      const current = await get(RECEIPT_KEY)
      if (current?.entryId === id) return { ...current, sourceTabId: current.capture?.sourceTabId }
      const links = await get(RECEIPTS_KEY) ?? []
      const result = links.findLast(link => link.entryId === id)
      if (!result) throw failure('receipt_missing')
      return result
    },
  }
}

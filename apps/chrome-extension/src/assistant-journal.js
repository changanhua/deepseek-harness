export const JOURNAL_KEY = 'dsh.assistant.execution.v1'
const JOURNAL_ANCHOR_KEY = 'dsh.assistant.execution-anchor.v1'

const clone = value => structuredClone(value)
const error = code => Object.assign(new Error(code), { code })
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength
const fields = ['protocolVersion', 'grantEpoch', 'requestId', 'sessionId', 'installationId', 'deadline', 'fingerprint']
const identityOf = request => Object.fromEntries(fields.map(key => [key, request[key]]))
const sameIdentity = (left, right) => fields.every(key => left[key] === right[key])
const boundedId = value => typeof value === 'string' && value.length > 0 && value.length <= 128
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
const validTarget = value => value && Number.isSafeInteger(value.tabId) && value.tabId >= 0
  && Number.isSafeInteger(value.frameId) && value.frameId >= 0 && boundedId(value.documentId)
const validIdentity = value => value?.protocolVersion === 1 && Number.isSafeInteger(value.grantEpoch) && value.grantEpoch > 0
  && uuid(value.requestId) && uuid(value.installationId) && boundedId(value.sessionId)
  && Number.isSafeInteger(value.deadline) && value.deadline > 0 && /^[a-f0-9]{64}$/u.test(value.fingerprint)
const validResult = value => value && ['observed', 'failed', 'cancelled', 'unknown'].includes(value.outcome)
  && typeof value.quiescent === 'boolean' && (value.outcome === 'unknown' || value.quiescent)
  && (value.reason === undefined || typeof value.reason === 'string' && value.reason.length <= 1024)
const unknown = (identity, reason, quiescent = false) => ({ ...identity, outcome: 'unknown', reason, quiescent })
const opensTab = request => request.mutates && request.target === undefined
  && request.payload?.kind === 'tab_open' && request.payload.page === undefined
const conflictsWith = (entry, request) => entry.mutates && !entry.released
  && request.target !== undefined && entry.target?.tabId === request.target.tabId

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  throw error('invalid_request')
}

async function verifyInvocation(request, maxRequestBytes) {
  if (!validIdentity(request) || typeof request.mutates !== 'boolean'
    || request.target !== undefined && !validTarget(request.target)
    || request.mutates && !request.target && !opensTab(request)) throw error('invalid_request')
  if (bytes(request) > maxRequestBytes) throw error('request_too_large')
  const body = { protocolVersion: request.protocolVersion, grantEpoch: request.grantEpoch, requestId: request.requestId,
    sessionId: request.sessionId, installationId: request.installationId, deadline: request.deadline,
    mutates: request.mutates, payload: request.payload, ...(request.target === undefined ? {} : { target: request.target }) }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(body)))
  const fingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (fingerprint !== request.fingerprint) throw error('invalid_fingerprint')
}

/**
 * One service-worker writer owns this journal. Persist intent before invoking
 * the executor; never persist action inputs or replay them during recovery.
 * Only an operation that may still be running holds the tab. A quiescent
 * unknown result remains queryable without requiring a person to clear it.
 */
export const createAssistantJournal = ({ storage, execute, inspect = async () => ({ outcome: 'unknown', quiescent: false }),
  permit = () => false, changed = () => {}, canBootstrap = async () => false, now = Date.now, capacity = 64, maxRequestBytes = 65536,
  maxResultBytes = 2 * 1024 * 1024, maxStorageBytes = 8 * 1024 * 1024, maxDurationMs = 30000, retentionMs = 60000 }) => {
  if ([capacity, maxRequestBytes, maxResultBytes, maxStorageBytes, maxDurationMs, retentionMs]
    .some(value => !Number.isSafeInteger(value) || value <= 0)) throw error('invalid_journal_limits')
  let entries = []
  let journalId
  let initialized = false
  let unavailable = false
  let closed = false
  let lane = Promise.resolve()
  const active = new Map()
  const serialize = work => {
    const result = lane.then(work)
    lane = result.then(() => {}, () => {})
    return result
  }
  const open = () => { if (unavailable) throw error('journal_unavailable'); if (closed) throw error('journal_closed') }
  const initialize = async () => {
    if (initialized) return
    try {
      const record = (await storage.get(JOURNAL_KEY))[JOURNAL_KEY]
      const anchor = (await storage.get(JOURNAL_ANCHOR_KEY))[JOURNAL_ANCHOR_KEY]
      if (record !== undefined) {
        if (record?.version !== 1 || !uuid(record.journalId) || record.journalId !== anchor
          || !Array.isArray(record.entries) || record.entries.length > capacity
          || bytes(record) > maxStorageBytes || new Set(record.entries.map(row => row?.identity?.requestId)).size !== record.entries.length
          || record.entries.some(row => !validIdentity(row.identity) || typeof row.mutates !== 'boolean'
            || row.target !== undefined && !validTarget(row.target)
            || row.operation !== undefined && (row.operation !== 'tab_open' || !row.mutates || row.target !== undefined)
            || row.mutates && !row.target && row.operation !== 'tab_open'
            || typeof row.released !== 'boolean' || !['active', 'settled'].includes(row.state)
            || row.state === 'settled' && (!validResult(row.result) || !sameIdentity(row.result, row.identity))
            || row.released && (row.state !== 'settled' || !row.result.quiescent))) throw error('invalid_journal')
        // A settled quiescent record is released on read: no person clears an unresolved write.
        entries = record.entries.map(row => ({ ...row, released: row.released || row.state === 'settled' && row.result.quiescent }))
        journalId = record.journalId
        if (record.entries.some((row, index) => row.released !== entries[index].released)) {
          await storage.set({ [JOURNAL_KEY]: { ...record, entries } })
        }
      } else {
        if (anchor !== undefined || !await canBootstrap()) throw error('journal_missing')
        journalId = crypto.randomUUID()
        await storage.set({ [JOURNAL_KEY]: { version: 1, journalId, entries: [] }, [JOURNAL_ANCHOR_KEY]: journalId })
      }
      initialized = true
    } catch { unavailable = true; throw error('journal_unavailable') }
  }
  const persist = async (next, protectedRequestId = null) => {
    if (unavailable) throw error('journal_unavailable')
    const kept = next.filter(row => !row.released || row.identity.deadline + retentionMs > now())
    const record = { version: 1, journalId, entries: kept }
    // Completed reads are replay-safe; sent writes and unresolved requests are not.
    while (kept.length > capacity || bytes(record) > maxStorageBytes) {
      const index = kept.findIndex(row => row.identity.requestId !== protectedRequestId && !row.mutates
        && row.state === 'settled' && row.released)
      if (index < 0) throw error('journal_capacity')
      kept.splice(index, 1)
    }
    try { await storage.set({ [JOURNAL_KEY]: record }) }
    catch { unavailable = true; throw error('journal_unavailable') }
    entries = kept
  }
  const find = identity => {
    const entry = entries.find(row => row.identity.requestId === identity.requestId)
    if (entry && !sameIdentity(entry.identity, identity)) throw error('request_conflict')
    return entry
  }
  const notify = result => {
    try { Promise.resolve(changed(clone(result))).catch(() => {}) } catch { /* observers cannot change durable facts */ }
  }
  const resultFor = (identity, candidate) => {
    if (!validResult(candidate)) return unknown(identity, 'executor_not_quiescent')
    const result = { ...identity, outcome: candidate.outcome, quiescent: candidate.quiescent,
      ...(candidate.reason === undefined ? {} : { reason: candidate.reason }),
      ...(candidate.value === undefined ? {} : { value: clone(candidate.value) }) }
    return bytes(result) > maxResultBytes ? unknown(identity, 'result_too_large', candidate.quiescent) : result
  }
  const conclude = (entry, candidate) => serialize(async () => {
    const current = find(entry.identity)
    if (current?.released && current.result?.outcome === 'unknown') return clone(current.result)
    // A late inspection reports missing information, never a downgrade of a settled outcome.
    if (current?.result && current.result.outcome !== 'unknown' && candidate.outcome === 'unknown') return clone(current.result)
    const result = resultFor(entry.identity, candidate)
    const settled = { ...entry, state: 'settled', result, released: result.quiescent }
    try { await persist(entries.map(row => row.identity.requestId === entry.identity.requestId ? settled : row), entry.identity.requestId) }
    catch { return unknown(entry.identity, 'receipt_persistence_failed') }
    notify(result)
    return clone(result)
  })
  const run = async (entry, request, work) => {
    let candidate
    const timer = setTimeout(() => {
      work.controller.abort(error('deadline'))
      work.resolve(unknown(entry.identity, 'deadline'))
    }, Math.max(0, request.deadline - now()))
    work.timer = timer
    try {
      if (work.controller.signal.aborted || !permit(request) || now() >= request.deadline) {
        candidate = { outcome: 'cancelled', quiescent: true, reason: 'authorization_changed' }
      } else {
        candidate = await execute(clone(request), work.controller.signal)
      }
    } catch { candidate = { outcome: 'unknown', quiescent: false, reason: 'executor_disconnected' } }
    try { work.resolve(await conclude(entry, candidate)) }
    catch { work.resolve(unknown(entry.identity, 'receipt_unavailable')) }
    finally { clearTimeout(timer); active.delete(entry.identity.requestId) }
  }

  const recover = async (entry, mode) => {
    const running = active.get(entry.identity.requestId)
    if (running) {
      if (mode === 'cancel') running.controller.abort(error('cancelled'))
      return unknown(entry.identity, mode === 'cancel' ? 'cancel_requested' : 'in_progress')
    }
    if (entry.state === 'settled' && (entry.released || entry.result.outcome !== 'unknown')) return clone(entry.result)
    let observed
    try { observed = await inspect(clone(entry), { cancel: mode === 'cancel' }) }
    catch { return entry.result ? clone(entry.result) : unknown(entry.identity, 'executor_unavailable') }
    if (validResult(observed) && (observed.quiescent || observed.outcome !== 'unknown')) return conclude(entry, observed)
    return entry.result ? clone(entry.result) : unknown(entry.identity, 'worker_restarted')
  }

  const handle = async frame => {
    if (!['execute', 'status', 'cancel'].includes(frame?.type) || !validIdentity(frame.request)) throw error('invalid_request')
    const request = clone(frame.request)
    if (frame.type === 'execute') await verifyInvocation(request, maxRequestBytes)
    if (frame.type === 'execute' && request.mutates) {
      const conflicts = await serialize(async () => {
        await initialize()
        return entries.filter(row => conflictsWith(row, request)
          && !active.has(row.identity.requestId)).map(row => clone(row))
      })
      for (const entry of conflicts) await recover(entry, 'status')
    }
    const admitted = await serialize(async () => {
      await initialize()
      const existing = find(request)
      if (existing?.released && existing.identity.deadline + retentionMs <= now()) {
        return { result: unknown(existing.identity, 'receipt_expired', true) }
      }
      if (existing) return { entry: clone(existing) }
      if (frame.type !== 'execute') return { result: unknown(identityOf(request), 'receipt_unavailable') }
      open()
      const denied = reason => ({ result: { ...identityOf(request), outcome: 'failed', quiescent: true, reason } })
      if (request.deadline <= now() || request.deadline - now() > maxDurationMs) return denied('deadline')
      if (!permit(request)) return denied('authorization_changed')
      if (request.mutates && entries.some(row => conflictsWith(row, request))) return denied('target_busy')
      const retained = entries.filter(row => !row.released || row.identity.deadline + retentionMs > now())
      const entry = { identity: identityOf(request), mutates: request.mutates,
        ...(opensTab(request) ? { operation: 'tab_open' } : {}),
        ...(request.target === undefined ? {} : { target: clone(request.target) }), state: 'active', released: false }
      try { await persist([...retained, entry]) }
      catch (cause) { if (cause?.code === 'journal_capacity') return denied('journal_capacity'); throw cause }
      const deferred = Promise.withResolvers()
      const work = { ...deferred, controller: new AbortController(), timer: undefined }
      active.set(request.requestId, work)
      return { entry, work }
    })
    if (admitted.result) return admitted.result
    if (admitted.work) {
      void run(admitted.entry, request, admitted.work)
      return admitted.work.promise
    }
    if (frame.type === 'execute' && active.has(request.requestId)) return active.get(request.requestId).promise
    return recover(admitted.entry, frame.type)
  }

  /**
   * Restart recovery is deliberately a lookup-only lane: it never calls the
   * executor or inspection hook.  A missing journal entry is silent so the
   * Host times out conservatively instead of inventing a terminal receipt.
   */
  const lookup = async (locator, sessionId) => serialize(async () => {
    if (!locator || locator.kind !== 'extension-journal-v1' || locator.protocolVersion !== 1
      || !uuid(locator.transportRequestId) || !uuid(locator.installationId)
      || !Number.isSafeInteger(locator.grantEpoch) || locator.grantEpoch < 1
      || typeof sessionId !== 'string' || !sessionId) return undefined
    await initialize()
    const entry = entries.find(row => row.identity.requestId === locator.transportRequestId
      && row.identity.sessionId === sessionId && row.identity.installationId === locator.installationId
      && row.identity.grantEpoch === locator.grantEpoch)
    if (!entry || entry.released && entry.identity.deadline + retentionMs <= now()) return undefined
    if (entry.state === 'settled' && entry.result) return clone(entry.result)
    return unknown(entry.identity, 'receipt_unavailable')
  })

  const interrupt = (reason = 'connection_lost', installationId = undefined) => {
    for (const [requestId, work] of active) {
      const entry = entries.find(row => row.identity.requestId === requestId)
      if (installationId !== undefined && entry?.identity.installationId !== installationId) continue
      work.controller.abort(error(reason))
    }
  }
  const stop = async () => {
    closed = true
    interrupt('stopped')
    for (const [id, work] of active) {
      clearTimeout(work.timer)
      work.resolve(unknown(entries.find(row => row.identity.requestId === id).identity, 'stopped'))
    }
    await lane
  }
  const list = () => serialize(async () => { await initialize(); return clone(entries) })
  return { handle, lookup, interrupt, stop, list }
}

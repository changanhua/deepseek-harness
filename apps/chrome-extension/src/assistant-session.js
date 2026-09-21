import { normalizeBaseUrl } from './pending.js'
import { createAssistantLive } from './assistant-live.js'

const KEY = 'dsh.assistant.session.v1'
const clone = value => structuredClone(value)
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength
const failure = (code, cause) => Object.assign(new Error(code), { code, ...(cause ? { cause } : {}) })
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256
const target = connection => ({ baseUrl: connection.baseUrl, installationId: connection.grant.installationId })
const sameTarget = (left, right) => left?.baseUrl === right?.baseUrl && left?.installationId === right?.installationId
const sameBinding = (left, right) => sameTarget(left, right) && left?.sessionId === right?.sessionId
const targetValid = value => {
  try { return value && id(value.sessionId) && uuid(value.installationId) && normalizeBaseUrl(value.baseUrl) === value.baseUrl }
  catch { return false }
}
const contentValid = content => Array.isArray(content) && content.length > 0 && content.length <= 8 && content.every(part => {
  if (!part || typeof part !== 'object') return false
  if (part.type === 'text') return typeof part.text === 'string' && part.text.length <= 65536 && Object.keys(part).every(key => ['type', 'text'].includes(key))
  return part.type === 'image' && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(part.mediaType)
    && typeof part.data === 'string' && part.data.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/u.test(part.data)
    && (part.name === undefined || typeof part.name === 'string' && part.name.length <= 256)
    && Object.keys(part).every(key => ['type', 'data', 'mediaType', 'name'].includes(key))
})
const locked = pending => pending && ['sending', 'unknown'].includes(pending.status)
const errorView = error => ({ code: typeof error?.code === 'string' ? error.code : 'result_unknown',
  message: typeof error?.message === 'string' ? error.message.slice(0, 1024) : 'Request result unavailable' })
const acceptedBy = (records, requestId) => records.some(record => {
  const event = record.event
  const messages = event?.type === 'user/message' ? [event.data]
    : event?.type === 'agent/inbox/spliced' && Array.isArray(event.data?.inserted) ? event.data.inserted : []
  return messages.some(message => message?.source?.kind === 'user' && message.source.rpcId === requestId)
})

/** Persistent intake identity; conversation records remain a bounded memory view of the Host log. */
export const createAssistantSession = ({ storage, call, getConnection, changed = () => {}, storageKey = KEY }) => {
  let durable = { version: 1, binding: null, pending: null, pendingCreate: null }
  let view = { records: [], header: null, cursor: -1, hasMore: false, truncated: false, phase: 'idle', error: null, modelSelection: null }
  let initialized = false
  let invalid = false
  let closed = false
  let generation = 0
  let stream = null
  let lane = Promise.resolve()
  let eventBytes = 0
  const assistantLive = createAssistantLive()
  const sending = new Map()
  const unfollows = new Set()
  const read = () => clone({ ...durable, ...view, streamId: stream?.id ?? null, assistantLive: assistantLive.read() })
  const emit = () => { try { Promise.resolve(changed(read())).catch(() => {}) } catch { /* observations cannot reopen a target */ } }
  const open = () => { if (invalid) throw failure('storage_invalid'); if (closed) throw failure('disposed') }
  const initialize = async () => {
    open()
    if (initialized) return
    let saved
    try { saved = (await storage.get(storageKey))[storageKey] } catch (cause) { invalid = true; throw failure('storage_failed', cause) }
    if (saved !== undefined) {
      const pending = saved?.pending, creation = saved?.pendingCreate
      if (saved?.version !== 1 || bytes(saved) > 6 * 1024 * 1024
        || saved.binding !== null && !targetValid(saved.binding)
        || pending !== null && (!targetValid(pending) || !sameBinding(pending, saved.binding) || !uuid(pending.requestId)
          || !contentValid(pending.content) || !['queue', 'steer'].includes(pending.mode)
          || pending.expectedTargetRevision !== undefined && (!Number.isSafeInteger(pending.expectedTargetRevision) || pending.expectedTargetRevision < 0)
          || !['sending', 'unknown', 'accepted', 'draft', 'failed'].includes(pending.status)
          || typeof pending.clientTimeZone !== 'string' || pending.clientTimeZone.length > 128)
        || creation !== null && (!targetValid(creation) || !sameBinding(creation, saved.binding)
          || creation.cwd !== undefined && (typeof creation.cwd !== 'string' || creation.cwd.length > 4096))
        || creation !== null && pending !== null) {
        invalid = true; view.phase = 'invalid'; view.error = { code: 'storage_invalid' }; emit(); throw failure('storage_invalid')
      }
      durable = clone(saved)
      if (durable.pending?.status === 'sending') durable.pending.status = 'unknown'
    }
    initialized = true
  }
  const transaction = work => {
    const task = lane.then(async () => { await initialize(); open(); return work() })
    lane = task.then(() => {}, () => {})
    return task
  }
  const save = async next => {
    if (bytes(next) > 6 * 1024 * 1024) throw failure('storage_limit')
    try { await storage.set({ [storageKey]: clone(next) }) }
    catch (cause) { invalid = true; view.phase = 'invalid'; view.error = { code: 'storage_failed' }; emit(); throw failure('storage_failed', cause) }
    durable = clone(next)
  }
  const ready = (binding = durable.binding) => {
    open()
    const connection = getConnection()
    if (binding && connection?.baseUrl && binding.baseUrl !== connection.baseUrl) throw failure('target_changed')
    if (connection?.phase !== 'connected' || !connection.grant?.scopes?.includes('session:interact')) throw failure('offline')
    if (binding && !sameTarget(binding, target(connection))) throw failure('target_changed')
    return connection
  }
  const resetStream = () => {
    const streamId = stream?.id
    generation += 1; stream = null
    if (streamId) {
      const retiring = Promise.resolve(call('session.unfollow', { streamId })).catch(() => {})
        .finally(() => { unfollows.delete(retiring) })
      unfollows.add(retiring)
    }
  }
  const clearRecords = () => {
    assistantLive.replace({ revision: 0 })
    view = { ...view, records: [], header: null, cursor: -1, hasMore: false, truncated: false, modelSelection: null }
  }
  const follow = async () => {
    const candidate = await transaction(() => {
      ready()
      if (!durable.binding || durable.pendingCreate) return null
      const candidate = { id: crypto.randomUUID(), generation, binding: clone(durable.binding), snapshotSeen: false }
      stream = candidate; view.phase = 'following'; view.error = null; emit()
      return candidate
    })
    if (!candidate) return
    try {
      const result = await call('session.follow', { streamId: candidate.id,
        request: { address: { kind: 'session', sessionId: candidate.binding.sessionId }, maxMessages: 50, assistantStream: true } })
      if (stream !== candidate || generation !== candidate.generation) return
      if (result?.streamId !== candidate.id) throw failure('invalid_stream')
    } catch (cause) {
      if (stream === candidate && generation === candidate.generation) { view.phase = 'error'; view.error = errorView(cause); emit() }
      throw cause
    }
  }
  const bind = async sessionId => {
    if (!id(sessionId)) throw failure('invalid_session')
    await transaction(async () => {
      const connection = ready(null)
      if (locked(durable.pending) || durable.pendingCreate) throw failure('pending_locked')
      resetStream()
      await save({ version: 1, binding: { ...target(connection), sessionId }, pending: null, pendingCreate: null })
      clearRecords(); view.phase = 'bound'; view.error = null; emit()
    })
    await follow(); return read()
  }
  const runOnce = (key, work) => {
    const previous = sending.get(key)
    if (previous) return previous
    const task = work().finally(() => { sending.delete(key) })
    sending.set(key, task)
    return task
  }
  const create = async (options = {}) => {
    const input = clone(options)
    const prepared = await transaction(async () => {
      const connection = ready(durable.pendingCreate)
      if (locked(durable.pending)) throw failure('pending_locked')
      if (durable.pendingCreate) {
        if (input.cwd !== undefined && input.cwd !== durable.pendingCreate.cwd) throw failure('create_conflict')
        return clone(durable.pendingCreate)
      }
      if (input.cwd !== undefined && (typeof input.cwd !== 'string' || !input.cwd || input.cwd.length > 4096)) throw failure('invalid_cwd')
      const prepared = { ...target(connection), sessionId: `session-${crypto.randomUUID()}`,
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }) }
      resetStream()
      await save({ version: 1, binding: { baseUrl: prepared.baseUrl, installationId: prepared.installationId, sessionId: prepared.sessionId }, pending: null, pendingCreate: prepared })
      clearRecords(); view.phase = 'creating'; view.error = null; emit()
      return prepared
    })
    return runOnce('create:' + prepared.sessionId, async () => {
      const epoch = generation
      try {
        ready(prepared)
        const result = await call('session.create', { sessionId: prepared.sessionId, agentPreset: 'browser-assistant',
          ...(prepared.cwd === undefined ? {} : { cwd: prepared.cwd }) })
        if (result?.sessionId !== prepared.sessionId) throw failure('invalid_response')
        await transaction(async () => {
          if (durable.pendingCreate?.sessionId !== prepared.sessionId) return
          await save({ ...durable, pendingCreate: null })
          if (generation === epoch) { view.phase = 'bound'; view.error = null; emit() }
        })
        if (generation === epoch) await follow()
        return read()
      } catch (cause) {
        if (generation === epoch) { view.error = errorView(cause); view.phase = 'create-unknown'; emit() }
        throw cause
      }
    })
  }
  const models = async () => {
    await transaction(() => { ready() })
    return clone(await call('session.modelCatalog', {}))
  }
  const selectModel = async (selection, expectedSessionId) => {
    const requested = clone(selection)
    if (!requested || typeof requested !== 'object'
      || !id(requested.provider) || !id(requested.model)
      || requested.reasoningEffort !== undefined && (!id(requested.reasoningEffort) || requested.reasoningEffort.length > 128)
      || Object.keys(requested).some(key => !['provider', 'model', 'reasoningEffort'].includes(key))
      || expectedSessionId !== null && !id(expectedSessionId)) throw failure('invalid_model_selection')
    let selectedSessionId = await transaction(() => {
      ready()
      const current = durable.binding?.sessionId ?? null
      if (current !== expectedSessionId) throw failure('session_changed')
      return current
    })
    if (selectedSessionId === null) {
      const created = await create()
      selectedSessionId = created.binding?.sessionId ?? null
    }
    if (selectedSessionId === null) throw failure('invalid_response')
    await transaction(() => {
      ready()
      if (durable.binding?.sessionId !== selectedSessionId) throw failure('session_changed')
    })
    const result = await call('session.selectModel', { sessionId: selectedSessionId, ...requested })
    const selected = result?.selected
    if (!selected || !id(selected.provider) || !id(selected.model)
      || selected.reasoningEffort !== undefined && (!id(selected.reasoningEffort) || selected.reasoningEffort.length > 128)) {
      throw failure('invalid_response')
    }
    await transaction(() => {
      if (durable.binding?.sessionId !== selectedSessionId) throw failure('session_changed')
      view.modelSelection = { lastUsed: view.modelSelection?.lastUsed ?? null, next: clone(selected) }
      view.error = null
      emit()
    })
    return clone(selected)
  }
  const deliver = pending => runOnce(pending.requestId, async () => {
    const epoch = generation
    let issued = false
    try {
      ready(pending)
      if (!sameBinding(pending, durable.binding)) throw failure('target_changed')
      issued = true
      const result = await call('session.prompt', { requestId: pending.requestId, sessionId: pending.sessionId,
        mode: pending.mode, content: clone(pending.content), clientTimeZone: pending.clientTimeZone,
        ...(pending.expectedTargetRevision === undefined ? {} : { expectedTargetRevision: pending.expectedTargetRevision }) })
      if (result?.accepted !== true) throw failure('invalid_response')
      await transaction(async () => {
        if (durable.pending?.requestId !== pending.requestId) return
        await save({ ...durable, pending: { ...durable.pending, status: 'accepted' } })
        if (generation === epoch) view.error = null
        emit()
      })
      return { accepted: true, requestId: pending.requestId }
    } catch (cause) {
      await transaction(async () => {
        if (durable.pending?.requestId !== pending.requestId || durable.pending.status === 'accepted') return
        const rejected = ['bad_request', 'request-conflict', 'invalid-time-zone', 'model-unavailable', 'attachment-error'].includes(cause?.code)
        await save({ ...durable, pending: { ...durable.pending, status: !issued ? 'draft' : rejected ? 'failed' : 'unknown', error: errorView(cause) } })
        if (generation === epoch) view.error = errorView(cause)
        emit()
      })
      throw cause
    }
  })
  const submit = async input => {
    const request = clone(input)
    if (!contentValid(request.content) || !['queue', 'steer'].includes(request.mode ?? 'queue')) throw failure('invalid_content')
    const commandLine = (request.mode ?? 'queue') === 'queue' && request.content.length === 1
      && request.content[0]?.type === 'text' && request.content[0].text.trim().startsWith('/')
      ? request.content[0].text.trim() : null
    const checksSession = Object.prototype.hasOwnProperty.call(request, 'expectedSessionId')
    if (checksSession && request.expectedSessionId !== null && !id(request.expectedSessionId)) throw failure('invalid_session')
    if (request.expectedTargetRevision !== undefined
      && (!Number.isSafeInteger(request.expectedTargetRevision) || request.expectedTargetRevision < 0)) throw failure('invalid_target_revision')
    let admittedSessionId = await transaction(() => {
      ready()
      const current = durable.binding?.sessionId ?? null
      if (checksSession && request.expectedSessionId !== current) throw failure('session_changed')
      return current
    })
    if (admittedSessionId === null) {
      const created = await create()
      admittedSessionId = created.binding?.sessionId ?? null
    }
    if (commandLine !== null) {
      await transaction(() => {
        ready()
        if (!durable.binding || durable.binding.sessionId !== admittedSessionId) throw failure('session_changed')
        if (durable.pendingCreate || durable.pending && durable.pending.status !== 'accepted') throw failure('pending_exists')
      })
      const command = await call('commands.execute', { sessionId: admittedSessionId, line: commandLine })
      if (command !== undefined) return { accepted: true, command }
    }
    const prepared = await transaction(async () => {
      ready()
      if (!durable.binding || durable.binding.sessionId !== admittedSessionId) throw failure('session_changed')
      if (durable.pendingCreate || durable.pending && durable.pending.status !== 'accepted') throw failure('pending_exists')
      const prepared = { ...durable.binding, requestId: crypto.randomUUID(), content: request.content,
        mode: request.mode ?? 'queue', clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, status: 'sending',
        ...(request.expectedTargetRevision === undefined ? {} : { expectedTargetRevision: request.expectedTargetRevision }) }
      await save({ ...durable, pending: prepared }); emit()
      return clone(prepared)
    })
    return deliver(prepared)
  }
  const retry = async () => {
    const pending = await transaction(() => {
      if (!durable.pending) throw failure('no_pending')
      ready(durable.pending)
      if (!sameBinding(durable.binding, durable.pending)) throw failure('target_changed')
      return clone(durable.pending)
    })
    return deliver(pending)
  }
  const discardDraft = () => transaction(async () => {
    if (locked(durable.pending)) throw failure('pending_locked')
    await save({ ...durable, pending: null }); emit()
  })
  const stop = async () => {
    const binding = await transaction(() => { ready(); if (!durable.binding) throw failure('no_session'); return clone(durable.binding) })
    return call('session.cancel', { sessionId: binding.sessionId })
  }
  const trim = records => {
    const retained = records.slice(-1000)
    while (retained.length && bytes(retained) > 2 * 1024 * 1024) retained.shift()
    view.truncated ||= retained.length < records.length
    return retained
  }
  const onEvent = frame => {
    const candidate = stream
    if (!candidate || frame?.type !== 'event' || frame.streamId !== candidate.id) return Promise.resolve()
    const size = bytes(frame)
    if (eventBytes + size > 2 * 1024 * 1024) {
      view.phase = 'error'; view.error = { code: 'stream_too_large' }; resetStream(); emit(); return Promise.resolve()
    }
    eventBytes += size
    let rebaseline = false
    return transaction(async () => {
      if (stream !== candidate || generation !== candidate.generation || !sameBinding(durable.binding, candidate.binding)) return
      if (frame.error) { view.phase = 'error'; view.error = errorView(frame.error); emit(); return }
      const event = frame.event
      let records
      if (event?.type === 'snapshot') {
        if (candidate.snapshotSeen || event.header?.id !== candidate.binding.sessionId || !Number.isSafeInteger(event.cursor)
          || event.cursor < -1 || !Array.isArray(event.records) || event.records.some(record => !['event', 'chunks'].includes(record?.type) || !record.event)
          || !event.assistantStream) {
          view.phase = 'error'; view.error = { code: 'invalid_snapshot' }; emit(); return
        }
        try { assistantLive.replace(event.assistantStream) } catch {
          view.phase = 'error'; view.error = { code: 'invalid_snapshot' }; emit(); return
        }
        candidate.snapshotSeen = true
        view.modelSelection = clone(event.projections?.values?.modelSelection ?? null)
        records = clone(event.records); view.header = clone(event.header); view.cursor = event.cursor
        view.hasMore = event.hasMore === true; view.truncated = false; view.records = trim(records); view.phase = 'live'
      } else if (event?.type === 'event') {
        if (!candidate.snapshotSeen) return
        const seq = event.event?.seq
        if (!Number.isSafeInteger(seq) || seq <= view.cursor) return
        if (seq !== view.cursor + 1) {
          view.phase = 'error'; view.error = { code: 'stream_gap' }; resetStream(); rebaseline = true; emit(); return
        }
        records = [clone(event)]; view.records = trim([...view.records, ...records]); view.cursor = seq
        if (event.event.type === 'model/selection') {
          view.modelSelection = { lastUsed: view.modelSelection?.lastUsed ?? null, next: clone(event.event.data) }
        } else if (event.event.type === 'request/header') {
          const config = event.event.data.header.config
          const used = { provider: config.provider, model: config.model,
            ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }) }
          const previous = view.modelSelection
          const equal = (left, right) => left?.provider === right?.provider && left?.model === right?.model && left?.reasoningEffort === right?.reasoningEffort
          const pending = previous?.next && !equal(previous.next, previous.lastUsed) && !equal(previous.next, used) ? previous.next : null
          view.modelSelection = { lastUsed: used, next: pending ?? used }
        }
      } else if (event?.type === 'assistant-stream') {
        if (!candidate.snapshotSeen) return
        const decision = assistantLive.accept(event.frame)
        if (decision === 'rebaseline') {
          view.phase = 'error'; view.error = { code: 'stream_gap' }; resetStream(); rebaseline = true; emit(); return
        }
        emit(); return
      } else return
      if (durable.pending && acceptedBy(records, durable.pending.requestId)) await save({ ...durable, pending: null })
      emit()
    }).then(() => rebaseline ? follow() : undefined).finally(() => { eventBytes -= size })
  }
  const connectionChanged = async connection => {
    resetStream()
    await transaction(() => {
      view.phase = connection?.phase === 'connected' && durable.binding
        && !sameTarget(durable.binding, target(connection)) ? 'foreign' : 'offline'
      clearRecords(); emit()
    })
    if (connection?.phase === 'connected' && durable.binding && !durable.pendingCreate
      && sameTarget(durable.binding, target(connection))) await follow()
  }
  const restore = async () => { await transaction(() => { emit() }); return read() }
  const dispose = async () => { closed = true; resetStream(); await lane; await Promise.all([...unfollows]) }
  return { read, restore, bind, create, models, selectModel, submit, retry, discardDraft, stop, onEvent, connectionChanged, dispose }
}

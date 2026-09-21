const copy = value => structuredClone(value)
const failure = code => Object.assign(new Error(code), { code })
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)

/** Ephemeral approval presence is scoped to one native document surface and its selected Session. */
export const createAssistantApproval = ({ call, getConnection, getBinding, changed = () => {} }) => {
  const surfaces = new Map()
  let closing = false
  const stateFor = surfaceId => {
    let state = surfaces.get(surfaceId)
    if (!state) {
      state = { visible: false, key: null, generation: 0, activeSession: null, requests: [], lane: Promise.resolve(), pending: new Set() }
      surfaces.set(surfaceId, state)
    }
    return state
  }
  const desired = surfaceId => {
    const state = surfaces.get(surfaceId)
    const connection = getConnection()
    if (!state?.visible || connection.phase !== 'connected' || !connection.grant?.scopes?.includes('session:interact')) return null
    const binding = getBinding(surfaceId)
    const sessionId = binding?.installationId === connection.grant.installationId && binding.baseUrl === connection.baseUrl
      ? binding.sessionId : null
    return { key: JSON.stringify([connection.baseUrl, connection.grant.installationId, connection.grant.grantEpoch, sessionId]), sessionId }
  }
  const validRequests = value => Array.isArray(value) && value.length <= 8 && value.every(item => uuid(item?.id)
    && item.toolName === 'browser_action' && (item.callId === undefined || typeof item.callId === 'string' && item.callId.length <= 256)
    && (item.reason === undefined || typeof item.reason === 'string' && item.reason.length <= 32768))
  const accept = frame => {
    const state = typeof frame?.surfaceId === 'string' ? surfaces.get(frame.surfaceId) : undefined
    if (!state || !state.activeSession || frame.sessionId !== state.activeSession
      || desired(frame.surfaceId)?.key !== state.key || !validRequests(frame.requests)) return
    state.requests = copy(frame.requests); changed()
  }
  const syncOne = surfaceId => {
    if (closing) return Promise.resolve()
    const state = stateFor(surfaceId)
    const next = desired(surfaceId)
    if ((next?.key ?? null) === state.key) return state.lane
    state.key = next?.key ?? null; state.activeSession = next?.sessionId ?? null; state.requests = []; state.generation++; changed()
    const version = state.generation
    const params = { surfaceId, sessionId: next?.sessionId ?? null }
    const work = state.lane.then(async () => {
      if (state.generation !== version || closing) return
      try {
        const value = await call('approval.presence', params)
        if (version === state.generation && !closing && next) accept(value)
      } catch {
        if (version === state.generation) { state.key = null; state.activeSession = null; state.requests = []; changed() }
      }
    })
    state.lane = work.catch(() => {})
    return work
  }
  const sync = surfaceId => surfaceId === undefined
    ? Promise.all([...surfaces.keys()].map(syncOne)).then(() => undefined)
    : syncOne(surfaceId)
  const setView = async (surfaceId, visible) => {
    if (!visible && !surfaces.has(surfaceId)) return
    const state = stateFor(surfaceId)
    if (state.visible === visible) {
      if (!visible && !state.activeSession && state.pending.size === 0) surfaces.delete(surfaceId)
      return state.lane
    }
    state.visible = visible
    await syncOne(surfaceId)
    if (!visible && !state.activeSession && state.pending.size === 0) surfaces.delete(surfaceId)
  }
  const decide = async (surfaceId, id, decision) => {
    const state = surfaces.get(surfaceId)
    const current = desired(surfaceId)
    if (closing || !state || !current?.sessionId || current.key !== state.key || !['allowed-once', 'rejected'].includes(decision)
      || !state.requests.some(item => item.id === id) || state.pending.has(id)) throw failure('approval_unavailable')
    const sessionId = current.sessionId
    state.pending.add(id)
    try { return await call('approval.decide', { surfaceId, sessionId, id, decision }) }
    finally { state.pending.delete(id) }
  }
  return { sync, setView, decide, onEvent: accept,
    read: surfaceId => {
      const state = surfaces.get(surfaceId)
      return { sessionId: state?.activeSession ?? null, requests: copy(state?.requests ?? []) }
    },
    dispose: async () => {
      closing = true
      for (const state of surfaces.values()) { state.generation++; state.requests = []; state.activeSession = null; state.key = null }
      await Promise.all([...surfaces.values()].map(state => state.lane)); surfaces.clear()
    },
  }
}

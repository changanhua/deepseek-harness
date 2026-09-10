const copy = value => structuredClone(value)
const failure = code => Object.assign(new Error(code), { code })
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)

/** Ephemeral native view presence and approval transport; no approval decisions are persisted here. */
export const createAssistantApproval = ({ call, getConnection, getBinding, changed = () => {} }) => {
  const views = new Set()
  let key = null
  let generation = 0
  let activeSession = null
  let requests = []
  let lane = Promise.resolve()
  let closing = false
  const pending = new Set()
  const desired = () => {
    const connection = getConnection()
    if (connection.phase !== 'connected' || !connection.grant?.scopes?.includes('session:interact')) return null
    const binding = getBinding()
    const sessionId = views.size && binding?.installationId === connection.grant.installationId
      && binding.baseUrl === connection.baseUrl ? binding.sessionId : null
    return { key: JSON.stringify([connection.baseUrl, connection.grant.installationId, connection.grant.grantEpoch, sessionId]), sessionId }
  }
  const validRequests = value => Array.isArray(value) && value.length <= 8 && value.every(item => uuid(item?.id)
    && item.toolName === 'browser_action' && (item.callId === undefined || typeof item.callId === 'string' && item.callId.length <= 256)
    && (item.reason === undefined || typeof item.reason === 'string' && item.reason.length <= 32768))
  const accept = frame => {
    if (!activeSession || frame.sessionId !== activeSession || desired()?.key !== key || !validRequests(frame.requests)) return
    requests = copy(frame.requests); changed()
  }
  const sync = () => {
    if (closing) return Promise.resolve()
    const next = desired()
    if ((next?.key ?? null) === key) return lane
    key = next?.key ?? null; activeSession = next?.sessionId ?? null; requests = []; generation++; changed()
    const version = generation
    if (!next) return Promise.resolve()
    const work = lane.then(async () => {
      if (generation !== version || closing) return
      try {
        const value = await call('approval.presence', { sessionId: next.sessionId })
        if (version === generation && !closing) accept(value)
      } catch {
        if (version === generation) { key = null; activeSession = null; requests = []; changed() }
      }
    })
    lane = work.catch(() => {})
    return work
  }
  const setView = (id, visible) => { if (visible) views.add(id); else views.delete(id); return sync() }
  const decide = async (id, decision) => {
    const current = desired()
    if (closing || !current?.sessionId || current.key !== key || !['allowed-once', 'rejected'].includes(decision)
      || !requests.some(item => item.id === id) || pending.has(id)) throw failure('approval_unavailable')
    const sessionId = current.sessionId
    pending.add(id)
    try {
      return await call('approval.decide', { sessionId, id, decision })
    } finally { pending.delete(id) }
  }
  return { sync, setView, decide, onEvent: frame => { if (frame?.type === 'approval') accept(frame) },
    read: () => ({ sessionId: activeSession, requests: copy(requests) }),
    dispose: async () => { closing = true; generation++; views.clear(); requests = []; activeSession = null; key = null; await lane },
  }
}

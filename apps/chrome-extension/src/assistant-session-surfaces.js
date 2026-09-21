import { createAssistantSession } from './assistant-session.js'

const validSurfaceId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value)

/** Owns one isolated Session follower for every live extension document. */
export const createAssistantSessionSurfaces = ({ storage, call, getConnection, changed = () => {} }) => {
  const entries = new Map()
  const readiness = new Map()
  const session = surfaceId => {
    if (!validSurfaceId(surfaceId)) throw Object.assign(new Error('invalid_surface'), { code: 'invalid_surface' })
    let current = entries.get(surfaceId)
    if (current) return current
    current = createAssistantSession({
      storage, call, getConnection,
      storageKey: `dsh.assistant.session.v2.${surfaceId}`,
      changed: state => changed(surfaceId, state),
    })
    entries.set(surfaceId, current)
    return current
  }
  const ready = surfaceId => {
    let current = readiness.get(surfaceId)
    if (current) return current
    const entry = session(surfaceId)
    current = entry.restore().then(async () => {
      const connection = getConnection()
      if (entry.read().binding && connection?.phase === 'connected') await entry.connectionChanged(connection)
      return entry
    })
    readiness.set(surfaceId, current)
    return current
  }
  const onEvent = frame => Promise.all([...entries.values()].map(entry => entry.onEvent(frame))).then(() => undefined)
  const connectionChanged = connection => Promise.all([...entries.values()].map(entry => entry.connectionChanged(connection))).then(() => undefined)
  const release = async surfaceId => {
    const entry = entries.get(surfaceId)
    entries.delete(surfaceId)
    readiness.delete(surfaceId)
    await entry?.dispose()
  }
  const dispose = async () => {
    const active = [...entries.values()]
    entries.clear()
    readiness.clear()
    await Promise.all(active.map(entry => entry.dispose()))
  }
  const peek = surfaceId => entries.get(surfaceId)?.read() ?? null
  return { session, ready, peek, onEvent, connectionChanged, release, dispose }
}

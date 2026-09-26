const key = 'dsh.browserSessionId'
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

/** Keeps one browser-lifetime identity in Chrome session storage across worker restarts. */
export const createBrowserSessionId = ({ storageSession, createId = () => crypto.randomUUID() }) => {
  let pending
  return async () => {
    if (pending) return pending
    pending = (async () => {
      if (!storageSession?.get || !storageSession?.set) throw Object.assign(new Error('browser_session_unavailable'), { code: 'browser_session_unavailable' })
      const current = (await storageSession.get(key))?.[key]
      if (typeof current === 'string' && uuidV4.test(current)) return current
      const next = createId()
      if (typeof next !== 'string' || !uuidV4.test(next)) throw Object.assign(new Error('browser_session_invalid'), { code: 'browser_session_invalid' })
      await storageSession.set({ [key]: next })
      return next
    })()
    try { return await pending } catch (error) { pending = undefined; throw error }
  }
}

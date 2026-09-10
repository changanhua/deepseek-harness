import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface SessionNavigation {
  readonly list: {
    getSnapshot(): { readonly ids: readonly SessionId[]; readonly byId: Readonly<Record<SessionId, { readonly origin?: string }>> }
    subscribe(listener: () => void): () => void
  }
  open(id: SessionId): void
}

/** Select one already listed ordinary Session from an explicit browser deep link. */
export function installSessionDeepLink(sessions: SessionNavigation, surface: Window): () => void {
  let handledHash: string | undefined
  const navigate = (): void => {
    const hash = surface.location.hash
    if (hash === handledHash) return
    const requested = new URLSearchParams(hash.slice(1)).get('session')
    if (requested === null || requested.length === 0 || requested.length > 256) return
    const list = sessions.list.getSnapshot()
    const sessionId = list.ids.find(id => id === requested)
    if (sessionId === undefined || list.byId[sessionId]?.origin === 'subagent') return
    handledHash = hash
    sessions.open(sessionId)
  }
  const hashChanged = (): void => { handledHash = undefined; navigate() }
  const unsubscribe = sessions.list.subscribe(navigate)
  surface.addEventListener('hashchange', hashChanged)
  navigate()
  return () => { unsubscribe(); surface.removeEventListener('hashchange', hashChanged) }
}

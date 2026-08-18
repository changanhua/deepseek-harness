/**
 * Capability viewer UI plugin, browser half: one sidebar module entry (the
 * Capability navigation row with a count badge) and the center-column
 * Capability workspace view, both over one shared CapabilityStore driven by
 * the capabilityRegistry Remote (`ctx.remote.capabilityRegistry`). The plugin
 * loads a snapshot when a session is current and re-reads on retry; no
 * forwarded-event dependency in V0 (a manual refresh is the honest floor).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the `shell.view` SlotMap merge (ui-layout).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the `sidebar.modules` SlotMap merge (ui-sidebar).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the capabilityRegistry Remote type merge.
import type {} from '@deepseek-ai/dsh-host-capability-registry/remote'
import type { CapabilityNavEntryInjected, CapabilityWorkspaceInjected } from './contract/slots.ts'
import { CapabilityNavEntry } from './CapabilityNavEntry.tsx'
import { CapabilityWorkspace } from './CapabilityWorkspace.tsx'
import { CapabilityStore, type CapabilityRemoteFace } from './store.ts'
import { en, zh, type CapabilityKey } from './locales.ts'

export type { CapabilityNavEntryInjected, CapabilityNavEntryProps, CapabilityWorkspaceInjected, CapabilityWorkspaceProps } from './contract/slots.ts'
export type { CapabilityKey } from './locales.ts'
export type { CapabilityRemoteFace, CapabilityStoreSnapshot } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Capability viewer's copy. */
    capability: CapabilityKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'capability'

/** Required services: the two slot seats, the capabilityRegistry Remote, and copy. */
export const inject = ['slots', 'remote', 'remote.capabilityRegistry', 'locale']

/**
 * Client plugin body: the shared store, the module entry, the workspace view,
 * and the session-driven load chain.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-capability: dictionaries')

  // The Typert remote-client type is generated into lib; keep the face cast
  // explicit so the store consumes a narrow, test-friendly interface.
  const store = new CapabilityStore(ctx.remote.capabilityRegistry as unknown as CapabilityRemoteFace)

  // Load when the current session changes; the capability projection is
  // session-scoped (skills resolve through the session's viewing scope).
  ctx.effect(() => {
    let lastSession: SessionId | undefined
    const sessions = ctx.get('sessions')
    const update = (): void => {
      const current = sessions?.list.getSnapshot().current
      if (current === undefined) {
        store.reset()
        lastSession = undefined
        return
      }
      if (current !== lastSession) {
        lastSession = current
        void store.load(current)
      }
    }
    update()
    const dispose = sessions?.list.subscribe(update)
    return () => {
      dispose?.()
      store.dispose()
    }
  }, 'ui-capability: session load chain')

  ctx.slots.inject('shell.view', () => ctx.slots.register({
    name: 'shell.view',
    id: 'capability',
    locale: NS,
    inject: (): CapabilityWorkspaceInjected => ({ capability: store }),
  }, CapabilityWorkspace))

  ctx.slots.inject('sidebar.modules', () => ctx.slots.register({
    name: 'sidebar.modules',
    id: 'capability-module',
    // Order below the Queue module (order 10) so the Capability entry sits
    // directly above Queue in the sidebar module stack.
    order: 5,
    locale: NS,
    inject: (): CapabilityNavEntryInjected => ({ capability: store }),
  }, CapabilityNavEntry))
}

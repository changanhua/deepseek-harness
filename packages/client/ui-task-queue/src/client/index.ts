/**
 * Queue module UI plugin, browser half: one sidebar module entry (the Queue
 * navigation row with a live status badge) and the center-column Queue
 * workspace view, both over one shared QueueStore driven by the panel Remote
 * (`ctx.remote.taskQueue`). The plugin owns the refresh chain: a 5s snapshot
 * poll keeps the badge live and the workspace re-reads on mount and after
 * every mutation; no forwarded-event dependency in v1 (a poll is the honest
 * floor until the `task-queue/*` events join the remote allowlist).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the `shell.view` SlotMap merge (ui-layout).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the `sidebar.modules` SlotMap merge (ui-sidebar).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-task-queue-remote/remote'
import type { QueueNavEntryInjected, QueueWorkspaceInjected } from './contract/slots.ts'
import { QueueNavEntry } from './QueueNavEntry.tsx'
import { QueueWorkspace } from './QueueWorkspace.tsx'
import { QueueStore, type QueueRemoteFace } from './store.ts'
import { en, zh, type TaskQueueKey } from './locales.ts'

export type { QueueActionResult, QueueRemoteFace, QueueSnapshot } from './store.ts'
export type { QueueNavEntryInjected, QueueNavEntryProps, QueueWorkspaceInjected, QueueWorkspaceProps } from './contract/slots.ts'
export type { TaskQueueKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Queue module's copy. */
    taskQueue: TaskQueueKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'taskQueue'

/** Snapshot poll cadence while the plugin is mounted. */
const POLL_MS = 5000

/** Required services: the two slot seats, the panel Remote, and copy. */
export const inject = ['slots', 'remote', 'remote.taskQueue', 'locale']

/**
 * Client plugin body: the shared store, the module entry, the workspace view,
 * and the refresh chain.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-task-queue: dictionaries')

  // The Typert remote-client type is generated into lib; keep the face cast
  // explicit until the host build regenerates it with readRunLog.
  const store = new QueueStore(ctx.remote.taskQueue as unknown as QueueRemoteFace)

  ctx.effect(() => {
    void store.refresh()
    const timer = window.setInterval(() => { void store.refresh() }, POLL_MS)
    return () => {
      window.clearInterval(timer)
      store.dispose()
    }
  }, 'ui-task-queue: refresh chain')

  ctx.slots.inject('shell.view', () => ctx.slots.register({
    name: 'shell.view',
    id: 'queue',
    locale: NS,
    inject: (): QueueWorkspaceInjected => ({ queue: store }),
  }, QueueWorkspace))

  ctx.slots.inject('sidebar.modules', () => ctx.slots.register({
    name: 'sidebar.modules',
    id: 'queue-module',
    order: 10,
    locale: NS,
    inject: (): QueueNavEntryInjected => ({ queue: store }),
  }, QueueNavEntry))
}

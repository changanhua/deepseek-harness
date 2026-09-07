/**
 * Content library plugin, browser half: the per-message "capture to library"
 * entry in the assistant-actions strip over the contentRemote Host Remote,
 * plus a persistent read-only library workspace and its sidebar entry. One
 * ContentLibraryStore created by this body backs the workspace and every
 * capture entry; the Host owns idempotency, source verification, and
 * revisions, so this plugin stores no content authority of its own.
 * @module @changanhua/dsh-client-ui-content/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the assistant-actions SlotMap entry and the useChat standard prop.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the ui-conversation SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the shell.view SlotMap entry.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the sidebar.modules SlotMap entry.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the generated contentRemote namespace merge.
import type {} from '@changanhua/dsh-content-remote/remote'
import { ContentLibraryStore } from './controller.ts'
import { CaptureAction } from './CaptureAction.tsx'
import { ContentLibraryNavEntry } from './ContentLibraryNavEntry.tsx'
import { ContentLibraryWorkspace } from './ContentLibraryWorkspace.tsx'
import type { CaptureInjected, LibraryInjected } from './contract.ts'
import { en, zh, type ContentKey, NS } from './locales.ts'

export type * from './contract.ts'
export type {
  CaptureOutcome, ContentLibraryRemote, ContentLibraryView, LibraryError,
  LibraryLoadState, PendingCapture,
} from './controller.ts'
export type {
  EditOutcome, EditorSession, MetadataPatch,
} from './controller.ts'
export type { CaptureTarget } from './capture-target.ts'
export type { ContentKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Content library UI copy. */
    content: ContentKey
  }
}

/** Required services: the slot registry, the Remote namespace, and the copy. */
export const inject = ['slots', 'locale', 'remote', 'remote.contentRemote']

/**
 * Client plugin body: the library store, the workspace and its sidebar
 * entry, and the per-message capture entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-content: dictionaries')

  // One store per plugin fiber: every slot contribution below closes over
  // it, and the effect disposer drops it with the fiber that created it.
  const store = new ContentLibraryStore(ctx.remote.contentRemote)

  ctx.effect(() => () => { store.dispose() }, 'ui-content: library lifecycle')

  // A reconnect can only invalidate what was already read; an idle store
  // stays idle until something asks for it.
  ctx.on('connection/reset', () => {
    void store.resync()
  })

  ctx.slots.inject('shell.view', () => ctx.slots.register({
    name: 'shell.view',
    id: 'content-library',
    locale: NS,
    inject: (): LibraryInjected => ({
      hooks: { library: store },
      refresh: () => { void store.refresh() },
      select: (entryId) => { store.select(entryId) },
      beginCreate: () => { store.beginCreate() },
      beginEdit: entryId => store.beginEdit(entryId),
      closeEditor: () => { store.closeEditor() },
      clearConflict: () => { store.clearConflict() },
      createEntry: (title, body) => store.createEntry(title, body),
      saveDraft: (title, body) => store.saveDraft(title, body),
      commitVersion: (title, body) => store.commitVersion(title, body),
      setMetadata: (entryId, patch) => store.setMetadata(entryId, patch),
    }),
  }, ContentLibraryWorkspace))

  ctx.slots.inject('sidebar.modules', () => ctx.slots.register({
    name: 'sidebar.modules',
    id: 'content-library-module',
    order: 7,
    locale: NS,
    inject: () => ({}),
  }, ContentLibraryNavEntry))

  ctx.slots.inject('conversation.chat.assistant-actions', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.chat.assistant-actions',
      id: 'capture',
      order: 12,
      locale: NS,
      inject: (sessionId): CaptureInjected => ({
        hooks: { library: store },
        capture: target => store.capture(sessionId, target),
      }),
    }, CaptureAction)
    return () => {
      dispose()
    }
  })
}

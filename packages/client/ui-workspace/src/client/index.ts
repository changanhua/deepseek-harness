/**
 * Workspace plugin, browser half. Two registrations: WorkspaceBrowser fills
 * the sidebar shell's `sidebar.workspaces` hole (the whole browsing region),
 * and WorkspacePicker fills the conversation hero's picker hole
 * (`conversation.hero.workspace` — both hero forms). Both read real Host
 * Workspaces through the global useWorkspaces hook, and each declares its
 * own `single` directory-flow child hole for the composed picker package's
 * client half (see the contract module doc). Export discipline:
 * packages/client/AGENTS.md.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { IWorkspaces, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the Controller service merges.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session root standard-hook merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { WorkspaceBrowserInjected, WorkspacePickerInjected } from './contract/slots.ts'
import { UiWorkspaceService } from './navigation.ts'
import { createWorkspaceViewStore } from './stores.ts'
import { WorkspaceBrowser } from './rows/WorkspaceBrowser.tsx'
import { WorkspacePicker } from './WorkspacePicker.tsx'
import { en, zh, type WorkspaceKey } from './locales.ts'
import { Workbench, WorkbenchNav } from './workbench/Workbench.tsx'
import { createWorkbenchStore } from './workbench/store.ts'
import { en as workbenchEn, zh as workbenchZh } from './workbench/locales.ts'
import type { WorkbenchInjected } from './workbench/contract.ts'
import { createResourcesRuntime } from './workbench/resources-runtime.ts'

export type { UiWorkspace } from './navigation.ts'
export type {
  DirectoryFlowOwnerProps, DirectoryFlowSlotName, DirectoryPickingHooks, DirectoryPickingInjected,
  WorkspaceBrowserInjected, WorkspaceBrowserProps, WorkspacePickerInjected, WorkspacePickerProps,
} from './contract/slots.ts'
export type { WorkspaceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface GlobalStandardProps {
    /** Selector hook over the pure Workspace Controller snapshot. */
    useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>
  }

  interface LocaleNamespaceMap {
    /** The workspace browsing region and pick/create flow copy. */
    workspace: WorkspaceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'workspace'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * the ui-sidebar / ui-conversation applies, whose activation order relative
 * to this one is NOT constrained: dsh.client.inject edges are informational
 * (loading/prefetch metadata, never apply sequencing) and neither owner
 * provides a waitable service. apply therefore depends on each slot
 * declaration through `slots.inject()` instead of assuming order.
 */
export const inject = [
  'slots', 'sessions', 'workspaces', 'locale', 'connection', 'remote', 'remote.directoryPicker', 'remote.workspace',
]

/**
 * Register the browser and picker once their slot declarations are on the
 * ledger. Inject factories return plain callbacks; data reads use the
 * framework's global hooks.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const sessions = ctx.get('sessions') as ISessions
  const workspaces = ctx.get('workspaces') as IWorkspaces
  const connectionGeneration = connection.generation
  const uiWorkspace = new UiWorkspaceService(
    ctx, ctx.remote.directoryPicker, workspaces, sessions)
  ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list } })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace: dictionaries')

  const workbenchStore = createWorkbenchStore()
  const resources = createResourcesRuntime(() => ctx.remote.workspace)
  ctx.effect(() => () => { resources.dispose() }, 'ui-workspace: resources')
  ctx.effect(() => ctx.locale.register('workbench', { zh: workbenchZh, en: workbenchEn }), 'ui-workspace: workbench dictionaries')
  const modules = createSnapshotStore<readonly string[]>([])
  ctx.effect(() => {
    const update = (): void => {
      const ids = ctx.slots.entries('shell.view').map(entry => entry.options.id).filter((id): id is string => id !== undefined)
      const previous = modules.getSnapshot()
      if (ids.length !== previous.length || ids.some((id, index) => id !== previous[index])) modules.set(ids)
    }
    const off = ctx.slots.subscribe('shell.view', update)
    update()
    return off
  }, 'ui-workspace: available workbench modules')
  ctx.slots.inject('conversation.home', () => ctx.slots.register({
    name: 'conversation.home',
    locale: 'workbench',
    store: workbenchStore,
    inject: (): WorkbenchInjected => ({
      hooks: { modules, resources: resources.source },
      resourceLoad: resources.load,
      resourceAdd: resources.add,
      resourceAct: resources.act,
      resourceClosePreview: resources.closePreview,
      openSession: (id) => {
        sessions.open(id)
        ctx.get('layout')?.activateModule('conversation')
      },
      startSession: (workspaceId) => {
        ctx.get('layout')?.activateModule('conversation')
        uiWorkspace.startSession(workspaceId)
      },
      prepareComposer: (workspaceId) => { uiWorkspace.startSession(workspaceId) },
      openModule: (id) => {
        if (modules.getSnapshot().includes(id)) ctx.get('layout')?.activateModule(id)
      },
    }),
  }, Workbench))
  ctx.slots.inject('sidebar.primary', () => ctx.slots.register({
    name: 'sidebar.primary',
    id: 'workbench-navigation',
    locale: 'workbench',
    store: workbenchStore,
  }, WorkbenchNav))

  const searchSessions: WorkspaceBrowserInjected['searchSessions'] = async (query, signal) => {
    const result = await sessions.search(query, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  // Stable per-surface occupancy sources (the renderer's hook cache keys by
  // source identity): true while the surface's directory-flow hole is filled.
  const flowSource = (hole: 'sidebar.workspaces.directoryFlow' | 'conversation.hero.workspace.directoryFlow'): HostObservable<boolean> => ({
    getSnapshot: () => ctx.slots.entries(hole).length > 0,
    subscribe: listener => ctx.slots.subscribe(hole, listener),
  })
  const browserFlowSource = flowSource('sidebar.workspaces.directoryFlow')
  const pickerFlowSource = flowSource('conversation.hero.workspace.directoryFlow')
  const browserInjected = (): WorkspaceBrowserInjected => ({
    // Explicit group actions keep their target; unscoped New Session inherits
    // the current Session Workspace before the recent-Workspace fallback.
    startSession: (workspaceId) => {
      ctx.get('layout')?.activateModule('conversation')
      uiWorkspace.startSession(workspaceId)
    },
    open: (sessionId) => {
      sessions.open(sessionId)
      ctx.get('layout')?.activateModule('conversation')
    },
    searchSessions,
    searchResultLimit: sessions.searchResultLimit,
    renameSession: async (sessionId, title) => {
      // Row → session-face hop: rename is a per-session verb (ISession), not
      // a list-service verb; the binding resolves any listed session.
      const session = sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error.message)
    },
    forkSession: (sessionId) => {
      sessions.fork({ sessionId, increaseTitle: true })
        .then((childId) => {
          sessions.open(childId)
          ctx.get('layout')?.activateModule('conversation')
        })
        .catch(() => {
          // Fork or child-rename failure keeps the current selection.
        })
    },
    renameWorkspace: async (workspaceId, title) => { await workspaces.rename(workspaceId, title) },
    deleteWorkspace: async (workspaceId) => { await workspaces.delete(workspaceId) },
    insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
      await workspaces.insertBefore(workspaceId, beforeWorkspaceId)
    },
    archiveSession: async (sessionId) => { await uiWorkspace.archiveSession(sessionId) },
    insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
      await workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    },
    createWorkspace: input => workspaces.create(input),
    hooks: { directoryFlow: browserFlowSource, connectionGeneration },
  })
  const pickerInjected = (): WorkspacePickerInjected => ({
    createWorkspace: input => workspaces.create(input),
    hooks: { directoryFlow: pickerFlowSource },
  })
  // Each registration declares its directory-flow child in the same call;
  // slot injection follows both the owner and declaration HMR lifetimes.
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register(
    {
      name: 'sidebar.workspaces',
      children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
      store: createWorkspaceViewStore(),
      inject: browserInjected,
      locale: NS,
    },
    WorkspaceBrowser,
  ))
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register(
    {
      name: 'conversation.hero.workspace',
      children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
      inject: pickerInjected,
      locale: NS,
    },
    WorkspacePicker,
  ))
}

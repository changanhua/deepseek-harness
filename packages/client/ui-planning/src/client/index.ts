import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import planningRemote from '@changanhua/dsh-planning-remote/remote'
import { PlanningNavEntry } from './PlanningNavEntry.tsx'
import { PlanningWorkbench } from './PlanningWorkbench.tsx'
import type { PlanningWorkspaceInjected } from './contract.ts'
import { en, NS, zh, type PlanningKey } from './locales.ts'
import { createPlanningRuntimeController } from './runtime-controller.ts'
import { PlanningImageAction, type PlanningImageActionInjected } from './PlanningImageAction.tsx'

interface ContentReadResult {
  readonly ok: boolean
  readonly value?: {
    readonly projectRefs: readonly string[]
    readonly versions: readonly {
      readonly id: string
      readonly title: string
      readonly body: string
      readonly bodySha256: string
    }[]
  } | null
  readonly error?: { readonly code: string; readonly message: string }
}

export type { PlanningKey } from './locales.ts'
export type { PlanningRuntimeController, PlanningRuntimeState } from './runtime-controller.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    planning: PlanningKey
  }
}
export const inject = ['slots', 'locale', 'remote', 'uiWorkspace']

/** Mount the generated Remote then register the two lifecycle-owned Planning slots. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(planningRemote)
  const ui = ctx.inject(['slots', 'locale', 'remote', 'remote.planning', 'uiWorkspace'], (ctx) => {
    const runtime = createPlanningRuntimeController(ctx.remote.planning)
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-planning: dictionaries')
    ctx.effect(() => {
      runtime.loadWorkspaces()
      return () => {
        runtime.dispose()
      }
    }, 'ui-planning: Remote lifecycle')
    const injected = (): PlanningWorkspaceInjected => ({
      hooks: { planning: runtime.source },
      selectWorkspace: (workspaceId) => {
        runtime.selectWorkspace(workspaceId)
      },
      selectItem: (itemId) => {
        runtime.selectItem(itemId)
      },
      create: input => runtime.create(input),
      refresh: () => {
        runtime.refresh()
      },
      execute: command => runtime.execute(command),
      retry: () => runtime.retry(),
      handoff: () => runtime.handoff(),
      readEvidence: (evidenceId) => {
        runtime.readEvidence(evidenceId)
      },
      openSessionSource: (sessionId) => {
        const navigation = ctx.get('uiWorkspace') as { openSession: (id: string) => void } | undefined
        if (navigation === undefined) throw new Error('Workspace navigation is unavailable')
        navigation.openSession(sessionId)
      },
      readImageSource: async (workspaceId, attachmentId) => {
        const result = await ctx.remote.planning.image({ workspaceId, attachmentId })
        if (!result.ok) throw new Error(result.error.message)
        return `data:${result.value.mediaType};base64,${result.value.data}`
      },
      readContentSource: async (entryId, versionId, workspaceId, sha256) => {
        const remote = (
          ctx.remote as unknown as {
            contentRemote?: { get: (id: string) => Promise<ContentReadResult> }
          }
        ).contentRemote
        if (remote === undefined) throw new Error('Content source is unavailable')
        const result = await remote.get(entryId)
        if (!result.ok) throw new Error(`${result.error?.code ?? 'unavailable'}: ${result.error?.message ?? ''}`)
        const entry = result.value
        const version = entry?.versions.find(candidate => candidate.id === versionId)
        if (
          entry === null ||
          entry === undefined ||
          !entry.projectRefs.includes(workspaceId) ||
          version === undefined ||
          version.bodySha256 !== sha256
        )
          throw new Error('Captured content version is unavailable in this project')
        return { title: version.title, body: version.body }
      },
    })
    ctx.slots.inject('shell.view', () =>
      ctx.slots.register({ name: 'shell.view', id: 'planning', locale: NS, inject: injected }, PlanningWorkbench),
    )
    ctx.slots.inject('sidebar.modules.group', () =>
      ctx.slots.register(
        { name: 'sidebar.modules.group', id: 'planning-module', order: 9, locale: NS, inject: injected },
        PlanningNavEntry,
      ),
    )
    ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
      name: 'conversation.chat.assistant-actions', id: 'planning-images', order: 14, locale: NS,
      inject: (sessionId): PlanningImageActionInjected => ({
        loadBoard: signal => ctx.remote.planning.sessionBoard(sessionId, signal),
        save: (workspaceId, command) => ctx.remote.planning.execute({ workspaceId, command }),
        onSaved: () => { runtime.refresh() },
      }),
    }, PlanningImageAction))
  })
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}

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
import { nextPlanningRequestId } from './request-id.ts'
import type { PlanningCommand } from '@changanhua/dsh-planning/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { PlanningSessionBinding, type PlanningBindingInjected, type PlanningBindingView } from './PlanningSessionBinding.tsx'

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
  interface SlotMap {
    'planning.subject.actions': { kind: 'list'; scope: 'root'; owner: { workspaceId: string; planId: string; subject: import('@changanhua/dsh-planning/types').PlanningSubjectRef } }
  }
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
    const sessionStarts = new Map<string, { sessionId: string; command: PlanningCommand }>()
    const bindings = new Map<string, PlanningBindingInjected>()
    const bindingLifetime = new AbortController()
    ctx.effect(() => () => { bindingLifetime.abort(); bindings.clear(); sessionStarts.clear() }, 'planning Session binding reads')
    const bindingFor = (sessionId: string): PlanningBindingInjected => {
      const existing = bindings.get(sessionId)
      if (existing) return existing
      const store = createSnapshotStore<PlanningBindingView | null>(null)
      const value: PlanningBindingInjected = { hooks: { planningBinding: store } }
      bindings.set(sessionId, value)
      void ctx.remote.planning.sessionBoard(sessionId, bindingLifetime.signal).then((result) => {
        if (bindingLifetime.signal.aborted || !result.ok) return
        const binding = result.value.sessionBindings?.find(value => value.sessionId === sessionId)
        if (!binding) return
        const focus = binding.subject.kind === 'focus' ? result.value.focuses?.find(value => value.id === binding.subject.id) : undefined
        const plan = result.value.items.find(value => value.id === (focus?.planId ?? binding.subject.id))
        const revision = plan?.revisions.find(value => value.id === binding.baseRevision)
        store.set({ title: focus?.title ?? revision?.title ?? binding.subject.id, revision: binding.baseRevision })
      }).catch(() => {})
      return value
    }
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-planning: dictionaries')
    ctx.effect(() => {
      runtime.loadWorkspaces()
      return () => {
        runtime.dispose()
      }
    }, 'ui-planning: Remote lifecycle')
    const injected = (): PlanningWorkspaceInjected => ({
      startPlanningSession: async (subject, revision) => {
        const state = runtime.source.getSnapshot()
        if (!state.board || !state.workspaceId) throw new Error('Planning project is unavailable')
        const workspaceId = state.workspaceId
        const key = JSON.stringify([workspaceId, subject, revision])
        let attempt = sessionStarts.get(key)
        if (!attempt) {
          const sessionId = `session-${nextPlanningRequestId()}`
          attempt = { sessionId, command: { kind: 'bind-session', requestId: nextPlanningRequestId(),
            expectedBoardVersion: state.board.version, subject, baseRevision: revision, sessionId } }
          sessionStarts.set(key, attempt)
        }
        const sessions = ctx.get('sessions') as unknown as {
          create: (input: { workspaceId: string; sessionId: string }) => Promise<string>
        } | undefined
        if (!sessions) throw new Error('Native sessions are unavailable')
        await sessions.create({ workspaceId, sessionId: attempt.sessionId })
        const result = await ctx.remote.planning.execute({ workspaceId, command: attempt.command })
        if (!result.ok) {
          if (['conflict'].includes(result.error.code)) {
            runtime.refresh()
            sessionStarts.delete(key)
          }
          throw new Error(`${result.error.message} (Session: ${attempt.sessionId})`)
        }
        sessionStarts.delete(key)
        runtime.refresh()
        const navigation = ctx.get('uiWorkspace') as { openSession: (id: string) => void } | undefined
        navigation?.openSession(attempt.sessionId)
      },
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
      ctx.slots.register({ name: 'shell.view', id: 'planning', locale: NS, inject: injected, children: { 'planning.subject.actions': { kind: 'list', scope: 'root' } } }, PlanningWorkbench),
    )
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
      name: 'conversation.input.dock', id: 'planning-binding', locale: NS,
      inject: sessionId => bindingFor(sessionId),
    }, PlanningSessionBinding))
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

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import planningRemote from '@changanhua/dsh-planning-remote/remote'
import { PlanningNavEntry } from './PlanningNavEntry.tsx'
import { PlanningWorkbench } from './PlanningWorkbench.tsx'
import { PlanningDesignCasePage, type PlanningDesignCaseInjected } from './PlanningDesignCasePage.tsx'
import type { PlanningWorkspaceInjected } from './contract.ts'
import { en, NS, zh, type PlanningKey } from './locales.ts'
import { createPlanningRuntimeController } from './runtime-controller.ts'
import { createSbcDesignController } from './sbc-design-controller.ts'
import { createThinkingController } from './thinking-controller.ts'
import { PlanningImageAction, type PlanningImageActionInjected } from './PlanningImageAction.tsx'
import { nextPlanningRequestId } from './request-id.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { PlanningSessionBinding, type PlanningBindingInjected, type PlanningBindingView } from './PlanningSessionBinding.tsx'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createPlanningSessionStarter } from './session-start.ts'

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
    const runtime = createPlanningRuntimeController(ctx.remote.planning, 'deepseek-harness')
    const sbc = createSbcDesignController(ctx.remote.planning)
    const thinking = createThinkingController(ctx.remote.planning, {
      create: input => sessions().create({ ...input, workspaceId: input.workspaceId as WorkspaceId,
        sessionId: SessionId(input.sessionId) }),
      prompt: async (sessionId, text, requestId, signal) => {
        const owner = sessions()
        const scope = owner.scope(SessionId(sessionId))
        const face = scope === undefined ? undefined : owner.sessionOf(scope)
        if (!face) throw new Error('Native Session face is unavailable')
        const result = await face.prompt([{ type: 'text', text }], 'queue', signal, requestId as SessionRequestId)
        if (!result.ok) throw new Error(result.error.message)
      },
      open: (id) => { ctx.get('uiWorkspace')?.openSession(id) },
    })
    ctx.effect(() => () => { thinking.dispose() }, 'Thinking case lifecycle')
    ctx.effect(() => () =>{  sbc.dispose() }, 'SBC design case lifecycle')
    const bindings = new Map<string, PlanningBindingInjected>()
    const bindingLifetime = new AbortController()
    const sessions = () => {
      const value = ctx.get('sessions') as unknown as ISessions | undefined
      if (!value) throw new Error('Native sessions are unavailable')
      return value
    }
    const sessionStarter = createPlanningSessionStarter({
      newId: nextPlanningRequestId,
      create: async (workspaceId, sessionId, agentPreset) => {
        await sessions().create({ workspaceId: workspaceId as WorkspaceId, sessionId: SessionId(sessionId),
          ...(agentPreset === undefined ? {} : { agentPreset }) })
      },
      bind: async (workspaceId, command, signal) => {
        const result = await ctx.remote.planning.execute({ workspaceId, command }, signal)
        if (!result.ok) throw result.error
      },
      prompt: async (sessionId, text, requestId, signal) => {
        const owner = sessions()
        const scope = owner.scope(SessionId(sessionId))
        const session = scope === undefined ? undefined : owner.sessionOf(scope)
        if (!session) throw new Error('Created Session is unavailable')
        const result = await session.prompt([{ type: 'text', text }], 'queue', signal, requestId as SessionRequestId)
        if (!result.ok) throw result.error
      },
      open: (sessionId) => {
        const navigation = ctx.get('uiWorkspace') as { openSession: (id: string) => void } | undefined
        if (!navigation) throw new Error('Workspace navigation is unavailable')
        navigation.openSession(sessionId)
      },
      refresh: () =>{  runtime.refresh() },
    })
    ctx.effect(() => () => { bindingLifetime.abort(); bindings.clear(); sessionStarter.dispose() }, 'planning Session binding reads')
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
      navigate: (patch) =>{  runtime.navigate(patch) },
      refreshDesignCases: () =>{  runtime.refreshDesignCases() },
      continuePlan: async (planId) => {
        runtime.selectItem(planId)
        const state = runtime.source.getSnapshot()
        const plan = state.board?.items.find(value => value.id === planId)
        if (!plan) throw new Error('Plan is unavailable')
        const focus = state.board?.focuses?.find(value => value.id === state.navigation?.focusId && value.planId === planId)
        await injected().continuePlanningSession(focus ? { kind: 'focus', id: focus.id } : { kind: 'plan', id: planId }, plan.headRevisionId)
      },
      openDesignCase: (summary) => {
        const workspaceId = runtime.source.getSnapshot().workspaceId
        if (workspaceId && summary.resource.provider === 'sbc') {
          const input = { workspaceId, subject: summary.subjectRef }
          void sbc.open(input).then(() => thinking.open(input))
          ctx.get('layout')?.openModule('planning-design-case')
        }
      },
      continuePlanningSession: async (subject, revision) => {
        const state = runtime.source.getSnapshot()
        const candidates = (state.board?.sessionBindings ?? []).filter(value =>
          value.subject.kind === subject.kind && value.subject.id === subject.id)
        if (candidates.length) {
          const owner = ctx.get('remote.session') as ClientRemote['session'] | undefined
          if (!owner) throw new Error('Native Session list is unavailable')
          const result = await owner.list({})
          if (!result.ok) throw new Error(result.error.message)
          const binding = result.value.items.flatMap(row => candidates.filter(value => value.sessionId === row.sessionId))[0]
          if (binding) { injected().openSessionSource(binding.sessionId); return }
        }
        await injected().startPlanningSession(subject, revision)
      },
      startPlanningSession: async (subject, revision, mode) => {
        const state = runtime.source.getSnapshot()
        if (!state.board || !state.workspaceId) throw new Error('Planning project is unavailable')
        await sessionStarter.start({ workspaceId: state.workspaceId, boardVersion: state.board.version, subject, revision, mode })
      },
      hooks: { planning: runtime.source },
      selectWorkspace: (workspaceId) => {
        sbc.close()
        runtime.selectWorkspace(workspaceId)
      },
      selectItem: (itemId) => {
        sbc.close()
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
    ctx.slots.inject('shell.view', () => ctx.slots.register({
      name: 'shell.view', id: 'planning-design-case', locale: NS,
      inject: (): PlanningDesignCaseInjected => ({ hooks: { sbcDesign: sbc.source, thinking: thinking.source },
        explore: operation => sbc.explore(operation),
        refresh: async () => { await sbc.refresh(); await thinking.refresh() },
        prepareThinking: question => thinking.prepare(question), resumeThinking: runId => thinking.resume(runId),
        applyThinking: async (...args) => { const saved = await thinking.apply(...args); if (saved) await sbc.refresh(); return saved },
        submitThinkingProposal: async (...args) => { const saved = await thinking.submitProposal(...args); if (saved) runtime.refresh()
          return saved },
        openThinkingSession: (id) =>{  thinking.openSession(id) },
        close: () => { thinking.close(); sbc.close(); runtime.refresh(); ctx.get('layout')?.openModule('planning') } }),
    }, PlanningDesignCasePage))
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

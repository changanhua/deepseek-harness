import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@changanhua/dsh-host-work-observatory/remote'
import type { WorkObservatoryRemoteFace } from './controller.ts'
import type { WorkObservatoryWorkspaceInjected } from './contract.ts'
import { installActivityTracker } from './activity-tracker.ts'
import { createObservatoryController } from './controller.ts'
import { WorkObservatoryNavEntry } from './WorkObservatoryNavEntry.tsx'
import { WorkObservatoryWorkspace } from './WorkObservatoryWorkspace.tsx'
import { en, NS, zh, type WorkObservatoryKey } from './locales.ts'

export type * from './contract.ts'
export type { ObservatoryViewState, WorkObservatoryRemoteFace } from './controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Work Observatory UI copy. */
    workObservatory: WorkObservatoryKey
  }
}

/** Services consumed by the app-scoped tracker and two workspace slot entries. */
export const inject = ['slots', 'locale', 'remote', 'remote.workObservatory', 'sessions']

/** Register activity tracking, the dedicated view, and its persistent sidebar entry. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-work-observatory: dictionaries')
  const remote = ctx.remote.workObservatory as unknown as WorkObservatoryRemoteFace
  const controller = createObservatoryController(remote)

  ctx.effect(() => installActivityTracker({
    sessionId: () => ctx.sessions.list.getSnapshot().current,
    observeClient: observation => ctx.remote.workObservatory.observeClient(observation).then((result) => {
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    }),
    onError: (error) => { ctx.logger.warn(`work observatory: observation failed: ${error.message}`) },
  }), 'ui-work-observatory: activity tracker')

  ctx.effect(() => {
    let projectPath: string | undefined
    const update = (): void => {
      const snapshot = ctx.sessions.list.getSnapshot()
      const next = snapshot.current === undefined ? undefined : snapshot.byId[snapshot.current]?.cwd
      if (next === projectPath) return
      projectPath = next
      controller.setProject(next)
    }
    update()
    if (projectPath === undefined) controller.refresh()
    const dispose = ctx.sessions.list.subscribe(update)
    return () => { dispose(); controller.dispose() }
  }, 'ui-work-observatory: range lifecycle')

  ctx.slots.inject('shell.view', () => ctx.slots.register({
    name: 'shell.view',
    id: 'work-observatory',
    locale: NS,
    inject: (): WorkObservatoryWorkspaceInjected => ({
      selectDate: (date) => { controller.selectDate(date) },
      refresh: () => { controller.refresh() },
      openSession: (sessionId) => { ctx.sessions.open(sessionId) },
      hooks: { observatory: controller.source },
    }),
  }, WorkObservatoryWorkspace))

  ctx.slots.inject('sidebar.modules', () => ctx.slots.register({
    name: 'sidebar.modules',
    id: 'work-observatory-module',
    order: 6,
    locale: NS,
    inject: () => ({}),
  }, WorkObservatoryNavEntry))
}

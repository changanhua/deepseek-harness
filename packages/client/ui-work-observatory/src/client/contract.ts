import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  HostObservable,
  PropsLocale,
  PropsRuntime,
  SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ObservatoryViewState } from './controller.ts'
import type { NS } from './locales.ts'

export interface WorkObservatoryWorkspaceInjected {
  readonly selectDate: (date: string) => void
  readonly refresh: () => void
  readonly openSession: (sessionId: SessionId) => void
  readonly hooks: { readonly observatory: HostObservable<ObservatoryViewState> }
}

export interface WorkObservatoryWorkspaceHooks {
  readonly useObservatory: SnapshotSelectorHook<ObservatoryViewState>
}

export type WorkObservatoryWorkspaceProps =
  PropsRuntime<'shell.view'>
  & Omit<WorkObservatoryWorkspaceInjected, 'hooks'>
  & WorkObservatoryWorkspaceHooks
  & PropsLocale<typeof NS>

export type WorkObservatoryNavProps = PropsRuntime<'sidebar.modules'> & PropsLocale<typeof NS>

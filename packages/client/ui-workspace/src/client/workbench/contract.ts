/** Framework-bound props shared by workbench navigation and its main view. */
import type { PropsHooks, PropsLocale, PropsRuntime, PropsStore, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { createWorkbenchStore } from './store.ts'
import type { WorkbenchKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Project overview and current-work navigation. */
    workbench: WorkbenchKey
  }
}

/** Callback and observable data passed from plugin assembly, never a transport object. */
export type WorkbenchInjected = {
  hooks: { modules: HostObservable<readonly string[]> }
  openSession: (id: SessionId) => void
  startSession: (workspaceId?: WorkspaceId) => void
  openModule: (id: string) => void
}

/** Main workbench props, including standard live session and workspace sources. */
export type WorkbenchProps = PropsRuntime<'shell.view'>
  & PropsStore<ReturnType<typeof createWorkbenchStore>>
  & PropsLocale<'workbench'>
  & PropsHooks<WorkbenchInjected['hooks']>
  & Omit<WorkbenchInjected, 'hooks'>

/** The primary navigation shares its route store with the main workbench. */
export type WorkbenchNavProps = PropsRuntime<'sidebar.primary'>
  & PropsStore<ReturnType<typeof createWorkbenchStore>>
  & PropsLocale<'workbench'>

/** Interaction state shared by workbench navigation and the center view. */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'

/** Workbench routes independent of the selected conversation. */
export type WorkbenchPage = 'overview' | 'attention' | 'running' | 'recent' | 'project' | 'tools'

/** Create one per-plugin view store; all business facts remain in the controllers. */
export function createWorkbenchStore() {
  return defineStore({
    init: () => ({
      page: 'overview' as WorkbenchPage,
      projectId: undefined as WorkspaceId | undefined,
      query: '',
      initialized: false,
    }),
    actions: {
      navigate: (draft, page: WorkbenchPage, projectId?: WorkspaceId) => {
        draft.page = page
        draft.projectId = projectId
        draft.query = ''
      },
      setQuery: (draft, query: string) => { draft.query = query },
      initialize: (draft) => { draft.initialized = true },
    },
  })
}

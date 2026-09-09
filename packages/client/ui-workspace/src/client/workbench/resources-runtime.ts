/** React-free, request-scoped resource projection for the selected project. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ResourceFile, ResourceId, ResourceInput, ResourceList, WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Resource data and errors observed for one selected project. */
export interface ResourcesState {
  workspaceId?: WorkspaceId
  data?: ResourceList
  preview?: ResourceFile
  busy: boolean
  error?: string
}

interface ResourcesRuntime {
  source: HostObservable<ResourcesState>
  load: (id: WorkspaceId) => Promise<void>
  add: (id: WorkspaceId, input: ResourceInput) => Promise<boolean>
  act: (id: WorkspaceId, resourceId: ResourceId, action: 'read' | 'start' | 'stop' | 'remove') => Promise<void>
  closePreview: () => void
  dispose: () => void
}

/**
 * Create a per-plugin resource projection and human-operation callbacks.
 * @param remote - current generated Workspace Remote.
 * @returns lifecycle-owned projection with explicit load and mutation operations.
 */
export function createResourcesRuntime(remote: () => ClientRemote['workspace']): ResourcesRuntime {
  const source = createSnapshotStore<ResourcesState>({ busy: false })
  let generation = 0
  let disposed = false

  async function request<T>(id: WorkspaceId, operation: () => Promise<RemoteResult<T>>, preview = false): Promise<boolean> {
    if (disposed) return false
    const ticket = ++generation
    const current = source.getSnapshot()
    source.set({ ...(current.workspaceId === id ? current : {}), workspaceId: id, busy: true })
    source.update((draft) => { delete draft.error })
    try {
      const result = await operation()
      if (!result.ok) throw new Error(result.error.message)
      const data = preview ? undefined : await remote().resourcesList(id)
      if (data !== undefined && !data.ok) throw new Error(data.error.message)
      if (ticket !== generation) return false
      source.update((draft) => {
        draft.busy = false
        if (preview) draft.preview = result.value as ResourceFile
        else if (data?.ok) draft.data = data.value
      })
      return true
    } catch (error) {
      if (ticket === generation) source.update((draft) => {
        draft.busy = false
        draft.error = error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  async function load(id: WorkspaceId): Promise<void> {
    if (disposed) return
    const ticket = ++generation
    const current = source.getSnapshot()
    source.set({ ...(current.workspaceId === id ? current : {}), workspaceId: id, busy: true })
    source.update((draft) => { delete draft.error })
    try {
      const result = await remote().resourcesList(id)
      if (!result.ok) throw new Error(result.error.message)
      if (ticket === generation) source.update((draft) => { draft.data = result.value; draft.busy = false })
    } catch (error) {
      if (ticket === generation) source.update((draft) => {
        draft.busy = false; draft.error = error instanceof Error ? error.message : String(error)
      })
    }
  }
  return {
    source,
    load,
    add: (id: WorkspaceId, input: ResourceInput): Promise<boolean> => request(id, () => remote().resourcesAdd(id, input)),
    act: async (id: WorkspaceId, resourceId: ResourceId, action: 'read' | 'start' | 'stop' | 'remove'): Promise<void> => {
      if (action === 'read') await request(id, () => remote().resourcesRead(id, resourceId), true)
      else if (action === 'start') await request(id, () => remote().resourcesStart(id, resourceId))
      else if (action === 'stop') await request(id, () => remote().resourcesStop(id, resourceId))
      else await request(id, () => remote().resourcesRemove(id, resourceId))
    },
    closePreview: (): void => { source.update((draft) => { delete draft.preview }) },
    dispose: (): void => { disposed = true; generation++ },
  }
}

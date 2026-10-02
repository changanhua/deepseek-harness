import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PlanningContextInput, SbcDesignCaseView, SbcExploreInput, SbcExploreOperation } from '@changanhua/dsh-planning-remote/types'
import type { RemoteResult } from './runtime-controller.ts'
import { nextPlanningRequestId } from './request-id.ts'
/** Authenticated transport for reading and editing one exploratory case. */
export interface SbcDesignRemote {
  sbcDesignCase(input: PlanningContextInput, signal?: AbortSignal): Promise<RemoteResult<SbcDesignCaseView>>
  exploreSbcDesignCase(input: SbcExploreInput, signal?: AbortSignal): Promise<RemoteResult<SbcDesignCaseView>>
}
/** Visible case data and request status owned by one mounted browser controller. */
export interface SbcDesignState { view: SbcDesignCaseView | null; pending: boolean; error: string | null; opened: boolean }
/** One lifecycle-owned mirror. Unknown writes require a read, never automatic replay.
 * @param remote - Case read and CAS mutation transport.
 * @returns Disposable view controller; close cancels its current request.
 */
export function createSbcDesignController(remote: SbcDesignRemote): {
  source: ReturnType<typeof createSnapshotStore<SbcDesignState>>
  close(): void
  refresh(): Promise<void>
  open(input: PlanningContextInput): Promise<void>
  explore(operation: SbcExploreOperation): Promise<void>
  dispose(): void
} {
  const source = createSnapshotStore<SbcDesignState>({ view: null, pending: false, error: null, opened: false })
  let input: PlanningContextInput | null = null
  let active: AbortController | null = null
  let disposed = false
  const close = () => {
    active?.abort()
    active = null
    input = null
    source.set({ view: null, pending: false, error: null, opened: false })
  }
  const run = async (call: (signal: AbortSignal) => Promise<RemoteResult<SbcDesignCaseView>>) => {
    if (disposed || active) return
    const controller = new AbortController()
    active = controller
    const isCurrent = () => !disposed && active === controller
    source.update((state) => { state.pending = true; state.error = null })
    try {
      const result = await call(controller.signal)
      if (!isCurrent()) return
      source.update((state) => {
        if (result.ok) state.view = result.value
        else state.error = `${result.error.code}: ${result.error.message}`
      })
    } catch (error) {
      if (isCurrent())
        source.update((state) => { state.error = error instanceof Error ? error.message : String(error) })
    } finally {
      if (active === controller) {
        active = null
        source.update((state) => { state.pending = false })
      }
    }
  }
  const refresh = async () => {
    const current = input
    if (current) await run(signal => remote.sbcDesignCase(current, signal))
  }
  return { source, close, refresh,
    open: async (next: PlanningContextInput) => {
      if (disposed) return
      close()
      input = next
      source.update((state) => { state.opened = true })
      await refresh()
    },
    explore: async (operation: SbcExploreOperation) => {
      const state = source.getSnapshot()
      if (!input || !state.view || state.error) return
      if (operation.kind === 'select' && operation.nodeId === state.view.case.local.selectedNodeId) return
      const request = { ...input, expectedVersion: state.view.case.version, requestId: nextPlanningRequestId(), operation }
      await run(signal => remote.exploreSbcDesignCase(request, signal))
    },
    dispose: () => { disposed = true; close() },
  }
}

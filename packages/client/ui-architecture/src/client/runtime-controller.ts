/** Current Loader snapshot controller for the Architecture workspace. */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Narrow `pluginInventory` Remote used by the Architecture feature. */
export interface ArchitectureRuntimeRemoteFace {
  list(): Promise<RemoteResult<PluginInventorySnapshot>>
}

/** Current point-in-time Loader read, retaining the last accepted snapshot. */
export interface ArchitectureRuntimeState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  snapshot: PluginInventorySnapshot | undefined
}

/** Apply-private loader and observable exposed through the Slot hooks compartment. */
export interface ArchitectureRuntimeController {
  readonly source: HostObservable<ArchitectureRuntimeState>
  load(): void
  dispose(): void
}

/**
 * Create one apply-private view of the current Loader inventory.
 * @param remote - `pluginInventory` Remote restricted to its list operation.
 * @returns A lifecycle-owned observable controller.
 */
export function createArchitectureRuntimeController(
  remote: ArchitectureRuntimeRemoteFace,
): ArchitectureRuntimeController {
  const store = createSnapshotStore<ArchitectureRuntimeState>({
    status: 'idle', error: null, snapshot: undefined,
  })
  let generation = 0
  let disposed = false
  const source: HostObservable<ArchitectureRuntimeState> = {
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
  }

  function fail(request: number, message: string): void {
    if (request !== generation) return
    store.update((draft) => {
      draft.status = 'error'
      draft.error = message
    })
  }

  function load(): void {
    if (disposed) return
    const request = ++generation
    store.update((draft) => {
      draft.status = 'loading'
      draft.error = null
    })
    void remote.list().then((result) => {
      if (request !== generation) return
      if (!result.ok) {
        fail(request, `${result.error.code}: ${result.error.message}`)
        return
      }
      store.update((draft) => {
        draft.status = 'ready'
        draft.error = null
        draft.snapshot = result.value
      })
    }, (error: unknown) => { fail(request, error instanceof Error ? error.message : String(error)) })
  }

  function dispose(): void {
    disposed = true
    generation += 1
  }

  return { source, load, dispose }
}

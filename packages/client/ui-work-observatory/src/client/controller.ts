import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WorkObservatoryRange,
  WorkObservatoryRangeRequest,
} from '@deepseek-ai/dsh-host-work-observatory/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

export interface WorkObservatoryRemoteFace {
  readRange(request: WorkObservatoryRangeRequest): Promise<RemoteResult<WorkObservatoryRange>>
}

export interface ObservatoryViewState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  date: string
  projectPath?: string
  range?: WorkObservatoryRange
}

export interface ObservatoryController {
  readonly source: HostObservable<ObservatoryViewState>
  selectDate(date: string): void
  setProject(projectPath: string | undefined): void
  refresh(): void
  dispose(): void
}

function localDate(today = new Date()): string {
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function epochRange(date: string): { from: number; to: number } {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (parts === null) throw new Error('invalid local calendar date')
  const start = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
  const end = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]) + 1)
  return { from: start.getTime(), to: end.getTime() }
}

/** Create the app-scoped range loader used by the workspace view. */
export function createObservatoryController(remote: WorkObservatoryRemoteFace): ObservatoryController {
  const store = createSnapshotStore<ObservatoryViewState>({
    status: 'idle', error: null, date: localDate(),
  })
  let generation = 0
  let disposed = false

  const load = (): void => {
    if (disposed) return
    const request = ++generation
    const state = store.getSnapshot()
    let range: { from: number; to: number }
    try {
      range = epochRange(state.date)
    } catch (error) {
      store.set({ ...state, status: 'error', error: error instanceof Error ? error.message : String(error) })
      return
    }
    store.set({ ...state, status: 'loading', error: null })
    void remote.readRange({ ...range, ...(state.projectPath === undefined ? {} : { projectPath: state.projectPath }) })
      .then((result) => {
        if (disposed || request !== generation) return
        if (!result.ok) {
          store.update((draft) => {
            draft.status = 'error'
            draft.error = `${result.error.code}: ${result.error.message}`
          })
          return
        }
        store.update((draft) => {
          draft.status = 'ready'
          draft.error = null
          draft.range = result.value
        })
      }, (error: unknown) => {
        if (disposed || request !== generation) return
        store.update((draft) => {
          draft.status = 'error'
          draft.error = error instanceof Error ? error.message : String(error)
        })
      })
  }

  return {
    source: { getSnapshot: store.getSnapshot, subscribe: store.subscribe },
    selectDate(date) {
      store.update((draft) => { draft.date = date })
      load()
    },
    setProject(projectPath) {
      if (store.getSnapshot().projectPath === projectPath) return
      store.update((draft) => {
        if (projectPath === undefined) delete draft.projectPath
        else draft.projectPath = projectPath
      })
      load()
    },
    refresh: load,
    dispose() {
      disposed = true
      generation += 1
    },
  }
}

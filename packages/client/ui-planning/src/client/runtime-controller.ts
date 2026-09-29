import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { nextPlanningRequestId } from './request-id.ts'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  PlanningCommand,
  PlanningEstimate,
  PlanningHandoff,
  PlanningLane,
  PlanningMutationResult,
} from '@changanhua/dsh-planning/types'
import type {
  PlanningBoardView,
  PlanningEvidenceInput,
  PlanningExecutionInput,
  PlanningExecutionView,
  PlanningHandoffInput,
} from '@changanhua/dsh-planning-remote/types'
import type { DeliveryEvidenceView } from '@changanhua/dsh-delivery-remote'

export interface PlanningWorkspaceView {
  readonly id: string
  readonly title: string
}
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

export interface PlanningRuntimeRemoteFace {
  workspaces(signal?: AbortSignal): Promise<RemoteResult<readonly PlanningWorkspaceView[]>>
  snapshot(workspaceId: string, signal?: AbortSignal): Promise<RemoteResult<PlanningBoardView>>
  execute(
    input: { readonly workspaceId: string; readonly command: PlanningCommand },
    signal?: AbortSignal,
  ): Promise<RemoteResult<PlanningMutationResult>>
  handoff(input: PlanningHandoffInput, signal?: AbortSignal): Promise<RemoteResult<PlanningHandoff>>
  execution(input: PlanningExecutionInput, signal?: AbortSignal): Promise<RemoteResult<PlanningExecutionView>>
  evidence(input: PlanningEvidenceInput, signal?: AbortSignal): Promise<RemoteResult<DeliveryEvidenceView>>
}

export interface PlanningRuntimeState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  workspaces: readonly PlanningWorkspaceView[]
  workspaceId: string | undefined
  board: PlanningBoardView | undefined
  selectedItemId: string | undefined
  error: string | null
  actionError: string | null
  pending: boolean
  retry: (() => Promise<boolean>) | undefined
  execution: PlanningExecutionView | undefined
  executionError: string | null
  evidence: DeliveryEvidenceView | undefined
  evidenceError: string | null
  evidencePending: boolean
}

/** Minimal capture: title is derived from the first non-empty idea line. */
export interface CreateIdeaInput {
  readonly idea: string
  readonly lane?: PlanningLane
}
export interface PlanningRuntimeController {
  readonly source: HostObservable<PlanningRuntimeState>
  loadWorkspaces(): void
  refresh(): void
  selectWorkspace(workspaceId: string): void
  selectItem(itemId: string | undefined): void
  create(input: CreateIdeaInput): Promise<boolean>
  execute(command: PlanningCommand): Promise<boolean>
  retry(): Promise<boolean>
  handoff(): Promise<boolean>
  readEvidence(evidenceId: string): void
  dispose(): void
}

const emptyEstimate: PlanningEstimate = {
  value: null,
  urgency: null,
  reuse: null,
  compounding: null,
  timeCost: null,
  tokenCost: null,
  risk: null,
  cognitiveCost: null,
  rationale: '',
}
function errorMessage(result: Extract<RemoteResult<unknown>, { readonly ok: false }>): string {
  return `${result.error.code}: ${result.error.message}`
}

/** Lifecycle-owned browser mirror for the planning Remote projection. */
export function createPlanningRuntimeController(remote: PlanningRuntimeRemoteFace): PlanningRuntimeController {
  const store = createSnapshotStore<PlanningRuntimeState>({
    status: 'idle',
    workspaces: [],
    workspaceId: undefined,
    board: undefined,
    selectedItemId: undefined,
    error: null,
    actionError: null,
    pending: false,
    retry: undefined,
    execution: undefined,
    executionError: null,
    evidence: undefined,
    evidenceError: null,
    evidencePending: false,
  })
  const source: HostObservable<PlanningRuntimeState> = {
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
  }
  let disposed = false
  let generation = 0
  let active: AbortController | undefined
  let executionActive: AbortController | undefined
  let executionGeneration = 0
  let evidenceActive: AbortController | undefined
  let evidenceGeneration = 0
  const clearExecution = (): void => {
    executionGeneration++
    executionActive?.abort('selection-changed')
    executionActive = undefined
    store.update((draft) => {
      draft.execution = undefined
      draft.executionError = null
    })
  }
  const clearEvidence = (): void => {
    evidenceGeneration++
    evidenceActive?.abort('selection-changed')
    evidenceActive = undefined
    store.update((draft) => {
      draft.evidence = undefined
      draft.evidenceError = null
      draft.evidencePending = false
    })
  }
  const loadExecution = (input: PlanningExecutionInput): void => {
    clearExecution()
    const controller = new AbortController()
    executionActive = controller
    const token = ++executionGeneration
    void remote.execution(input, controller.signal).then(
      (result) => {
        if (disposed || token !== executionGeneration || executionActive !== controller) return
        executionActive = undefined
        store.update((draft) => {
          if (draft.workspaceId !== input.workspaceId || draft.selectedItemId !== input.itemId) return
          draft.execution = result.ok ? result.value : undefined
          draft.executionError = result.ok ? null : errorMessage(result)
        })
      },
      (error: unknown) => {
        if (disposed || token !== executionGeneration || executionActive !== controller) return
        executionActive = undefined
        store.update((draft) => {
          draft.executionError = error instanceof Error ? error.message : String(error)
        })
      },
    )
  }
  const refresh = (workspaceId: string): void => {
    active?.abort('superseded')
    const controller = new AbortController()
    active = controller
    const token = ++generation
    store.update((draft) => {
      draft.status = 'loading'
      draft.error = null
    })
    void remote.snapshot(workspaceId, controller.signal).then(
      (result) => {
        if (disposed || token !== generation || active !== controller) return
        active = undefined
        if (!result.ok) {
          store.update((draft) => {
            draft.status = 'error'
            draft.error = errorMessage(result)
          })
          return
        }
        store.update((draft) => {
          draft.status = 'ready'
          draft.board = result.value
          draft.error = null
          draft.selectedItemId = result.value.items.some(item => item.id === draft.selectedItemId)
            ? draft.selectedItemId
            : undefined
        })
        const itemId = store.getSnapshot().selectedItemId
        if (itemId === undefined) clearExecution()
        else loadExecution({ workspaceId, itemId })
      },
      (error: unknown) => {
        if (!disposed && token === generation)
          store.update((draft) => {
            draft.status = 'error'
            draft.error = error instanceof Error ? error.message : String(error)
          })
      },
    )
  }
  const run = async (command: PlanningCommand): Promise<boolean> => {
    const state = store.getSnapshot()
    const workspaceId = state.workspaceId
    if (disposed || workspaceId === undefined || state.pending) return false
    const controller = new AbortController()
    active = controller
    const isCurrent = (): boolean => !disposed && active === controller
    store.update((draft) => {
      draft.pending = true
      draft.actionError = null
      draft.retry = undefined
    })
    try {
      const result = await remote.execute({ workspaceId, command }, controller.signal)
      if (!isCurrent()) return false
      active = undefined
      if (!result.ok) {
        const conflict = result.error.code === 'conflict'
        store.update((draft) => {
          draft.pending = false
          draft.actionError = conflict
            ? `${errorMessage(result)}; refresh complete, review before submitting a new command`
            : errorMessage(result)
          draft.retry = undefined
        })
        if (conflict) refresh(workspaceId)
        return false
      }
      store.update((draft) => {
        draft.pending = false
        draft.retry = undefined
        draft.selectedItemId = result.value.itemId ?? draft.selectedItemId
      })
      refresh(workspaceId)
      return true
    } catch (error) {
      if (!isCurrent()) return false
      active = undefined
      store.update((draft) => {
        draft.pending = false
        draft.actionError = error instanceof Error ? error.message : String(error)
        draft.retry = () => run(command)
      })
      return false
    }
  }
  const loadWorkspaces = (): void => {
    if (disposed || store.getSnapshot().pending) return
    active?.abort('superseded')
    const controller = new AbortController()
    active = controller
    const token = ++generation
    store.update((draft) => {
      draft.status = 'loading'
      draft.error = null
    })
    void remote.workspaces(controller.signal).then(
      (result) => {
        if (disposed || token !== generation || active !== controller) return
        active = undefined
        if (!result.ok) {
          store.update((draft) => {
            draft.status = 'error'
            draft.error = errorMessage(result)
            draft.retry = () => {
              loadWorkspaces()
              return Promise.resolve(true)
            }
          })
          return
        }
        store.update((draft) => {
          draft.status = 'ready'
          draft.workspaces = result.value
          draft.retry = undefined
        })
        const workspaceId = store.getSnapshot().workspaceId
        if (workspaceId !== undefined && !store.getSnapshot().pending) refresh(workspaceId)
      },
      (error: unknown) => {
        if (!disposed && token === generation)
          store.update((draft) => {
            draft.status = 'error'
            draft.error = error instanceof Error ? error.message : String(error)
            draft.retry = () => {
              loadWorkspaces()
              return Promise.resolve(true)
            }
          })
      },
    )
  }
  const runHandoff = async (input: PlanningHandoffInput): Promise<boolean> => {
    const state = store.getSnapshot()
    if (disposed || state.pending || state.workspaceId !== input.workspaceId || state.selectedItemId !== input.itemId)
      return false
    active?.abort('superseded')
    const controller = new AbortController()
    active = controller
    const isCurrent = (): boolean => !disposed && active === controller
    store.update((draft) => {
      draft.pending = true
      draft.actionError = null
      draft.retry = undefined
    })
    try {
      const result = await remote.handoff(input, controller.signal)
      if (!isCurrent()) return false
      active = undefined
      store.update((draft) => {
        draft.pending = false
        draft.actionError = result.ok ? null : errorMessage(result)
      })
      if (result.ok || result.error.code === 'conflict') refresh(input.workspaceId)
      return result.ok
    } catch (error) {
      if (!isCurrent()) return false
      active = undefined
      store.update((draft) => {
        draft.pending = false
        draft.actionError = error instanceof Error ? error.message : String(error)
        draft.retry = () => runHandoff(input)
      })
      return false
    }
  }
  const handoff = (): Promise<boolean> => {
    const state = store.getSnapshot()
    const item = state.board?.items.find(value => value.id === state.selectedItemId)
    const head = item?.revisions.find(value => value.id === item.headRevisionId)
    return state.workspaceId === undefined || item?.disposition !== 'active' || head === undefined
      ? Promise.resolve(false)
      : runHandoff({ workspaceId: state.workspaceId, itemId: item.id, expectedRevisionId: head.id })
  }
  const readEvidence = (evidenceId: string): void => {
    const state = store.getSnapshot()
    const workspaceId = state.workspaceId
    const itemId = state.selectedItemId
    if (disposed || workspaceId === undefined || itemId === undefined) return
    clearEvidence()
    const controller = new AbortController()
    evidenceActive = controller
    const token = ++evidenceGeneration
    store.update((draft) => {
      draft.evidencePending = true
    })
    void remote.evidence({ workspaceId, itemId, evidenceId }, controller.signal).then(
      (result) => {
        if (disposed || token !== evidenceGeneration || evidenceActive !== controller) return
        evidenceActive = undefined
        store.update((draft) => {
          if (draft.workspaceId !== workspaceId || draft.selectedItemId !== itemId) return
          draft.evidencePending = false
          draft.evidence = result.ok ? result.value : undefined
          draft.evidenceError = result.ok ? null : errorMessage(result)
        })
      },
      (error: unknown) => {
        if (disposed || token !== evidenceGeneration || evidenceActive !== controller) return
        evidenceActive = undefined
        store.update((draft) => {
          if (draft.workspaceId === workspaceId && draft.selectedItemId === itemId) {
            draft.evidencePending = false
            draft.evidenceError = error instanceof Error ? error.message : String(error)
          }
        })
      },
    )
  }
  return {
    source,
    loadWorkspaces,
    refresh: loadWorkspaces,
    selectWorkspace: (workspaceId) => {
      if (!disposed) {
        active?.abort('workspace-changed')
        clearExecution()
        clearEvidence()
        store.update((draft) => {
          draft.workspaceId = workspaceId
          draft.board = undefined
          draft.selectedItemId = undefined
          draft.pending = false
          draft.retry = undefined
          draft.actionError = null
        })
        refresh(workspaceId)
      }
    },
    selectItem: (itemId) => {
      if (!disposed) {
        clearExecution()
        clearEvidence()
        store.update((draft) => {
          draft.selectedItemId = itemId
          draft.retry = undefined
          draft.actionError = null
        })
        const workspaceId = store.getSnapshot().workspaceId
        if (workspaceId !== undefined && itemId !== undefined) loadExecution({ workspaceId, itemId })
      }
    },
    create: (input) => {
      const version = store.getSnapshot().board?.version
      if (version === undefined) return Promise.resolve(false)
      const title = input.idea
        .split(/\r?\n/u)
        .map(line => line.trim())
        .find(Boolean)
        ?.slice(0, 256)
      if (title === undefined) return Promise.resolve(false)
      return run({
        kind: 'propose',
        requestId: nextPlanningRequestId(),
        expectedBoardVersion: version,
        proposalId: nextPlanningRequestId(),
        expectedProposalVersion: null,
        targetItemId: null,
        baseRevisionId: null,
        draft: {
          title,
          intent: input.idea,
          scope: [],
          acceptance: [],
          sources: [{ kind: 'manual', text: input.idea }],
          estimate: emptyEstimate,
          reviewAt: null,
        },
        suggestedLane: input.lane ?? 'inbox',
        assumptions: [],
      })
    },
    execute: run,
    retry: async () => store.getSnapshot().retry?.() ?? false,
    handoff,
    readEvidence,
    dispose: () => {
      disposed = true
      generation += 1
      evidenceGeneration += 1
      active?.abort('plugin-disposed')
      executionActive?.abort('plugin-disposed')
      evidenceActive?.abort('plugin-disposed')
      active = undefined
      executionActive = undefined
      evidenceActive = undefined
    },
  }
}

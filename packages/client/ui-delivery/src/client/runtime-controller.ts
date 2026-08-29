/** React-free controller for the current Personal Delivery host projection. */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  DeliveryCreatePacketInput,
  DeliveryEvidenceView,
  DeliveryImportIssueInput,
  DeliveryReadEvidenceInput,
  DeliveryRecordDecisionInput,
  DeliverySnapshotView,
  DeliveryStartChangeInput,
  DeliveryStartVerificationInput,
} from '@deepseek-ai/dsh-delivery-remote/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Narrow cancellable Remote read used by the workbench controller. */
export interface DeliveryRuntimeRemoteFace {
  snapshot(signal?: AbortSignal): Promise<RemoteResult<DeliverySnapshotView>>
  importIssue(input: DeliveryImportIssueInput, signal?: AbortSignal): Promise<RemoteResult<unknown>>
  createPacket(input: DeliveryCreatePacketInput, signal?: AbortSignal): Promise<RemoteResult<unknown>>
  startChange(input: DeliveryStartChangeInput, signal?: AbortSignal): Promise<RemoteResult<unknown>>
  startVerification(input: DeliveryStartVerificationInput, signal?: AbortSignal): Promise<RemoteResult<unknown>>
  readEvidence(input: DeliveryReadEvidenceInput, signal?: AbortSignal): Promise<RemoteResult<DeliveryEvidenceView>>
  recordDecision(input: DeliveryRecordDecisionInput, signal?: AbortSignal): Promise<RemoteResult<unknown>>
}

/** One explicit operation whose cancellation belongs to the workbench. */
export type DeliveryPendingOperation =
  | 'import-issue'
  | 'create-packet'
  | 'start-change'
  | 'start-verification'
  | 'read-evidence'
  | 'record-decision'

/** Last accepted host projection plus honest loading/error state. */
export interface DeliveryRuntimeState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  snapshot: DeliverySnapshotView | undefined
  pending: DeliveryPendingOperation | null
  actionError: string | null
  lastSucceeded: DeliveryPendingOperation | null
  evidence: DeliveryEvidenceView | undefined
}

/** Apply-private observable lifecycle. */
export interface DeliveryRuntimeController {
  readonly source: HostObservable<DeliveryRuntimeState>
  load(): void
  importIssue(input: DeliveryImportIssueInput): Promise<boolean>
  createPacket(input: DeliveryCreatePacketInput): Promise<boolean>
  startChange(input: DeliveryStartChangeInput): Promise<boolean>
  startVerification(input: DeliveryStartVerificationInput): Promise<boolean>
  readEvidence(input: DeliveryReadEvidenceInput): Promise<boolean>
  recordDecision(input: DeliveryRecordDecisionInput): Promise<boolean>
  cancel(): void
  dispose(): void
}

function failureMessage(result: Extract<RemoteResult<unknown>, { readonly ok: false }>): string {
  return `${result.error.code}: ${result.error.message}`
}

/**
 * Create one lifecycle-owned projection controller over `ctx.remote.delivery`.
 * @param remote - Generated browser face for the narrow Delivery Remote namespace.
 * @returns a cancellable shared observable controller for both Delivery slot entries.
 */
export function createDeliveryRuntimeController(
  remote: DeliveryRuntimeRemoteFace,
): DeliveryRuntimeController {
  const store = createSnapshotStore<DeliveryRuntimeState>({
    status: 'idle',
    error: null,
    snapshot: undefined,
    pending: null,
    actionError: null,
    lastSucceeded: null,
    evidence: undefined,
  })
  let generation = 0
  let active: AbortController | undefined
  let disposed = false
  const source: HostObservable<DeliveryRuntimeState> = {
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
  }

  function fail(request: number, message: string): void {
    if (disposed || request !== generation) return
    store.update((draft) => {
      draft.status = 'error'
      draft.error = message
    })
  }

  function load(): void {
    if (disposed) return
    active?.abort('superseded')
    const controller = new AbortController()
    active = controller
    const request = ++generation
    store.update((draft) => {
      draft.status = 'loading'
      draft.error = null
    })
    void remote.snapshot(controller.signal).then((result) => {
      if (disposed || request !== generation) return
      active = undefined
      if (!result.ok) {
        fail(request, failureMessage(result))
        return
      }
      store.update((draft) => {
        draft.status = 'ready'
        draft.error = null
        draft.snapshot = result.value
      })
    }, (error: unknown) => {
      active = undefined
      fail(request, error instanceof Error ? error.message : String(error))
    })
  }

  async function operate<T>(
    operation: DeliveryPendingOperation,
    invoke: (signal: AbortSignal) => Promise<RemoteResult<T>>,
    accepted?: (value: T) => void,
  ): Promise<boolean> {
    if (disposed) return false
    if (store.getSnapshot().pending !== null) {
      store.update((draft) => {
        draft.actionError = 'Another Delivery operation is still running'
      })
      return false
    }
    active?.abort('operation-started')
    generation += 1
    const controller = new AbortController()
    active = controller
    store.update((draft) => {
      draft.pending = operation
      draft.actionError = null
      draft.lastSucceeded = null
    })
    try {
      const result = await invoke(controller.signal)
      if (active !== controller) return false
      active = undefined
      if (!result.ok) {
        store.update((draft) => {
          draft.pending = null
          draft.actionError = failureMessage(result)
        })
        return false
      }
      accepted?.(result.value)
      store.update((draft) => {
        draft.pending = null
        draft.actionError = null
        draft.lastSucceeded = operation
      })
      if (operation !== 'read-evidence') load()
      return true
    } catch (error) {
      if (active !== controller) return false
      active = undefined
      store.update((draft) => {
        draft.pending = null
        draft.actionError = error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  const importIssue = (input: DeliveryImportIssueInput): Promise<boolean> =>
    operate('import-issue', signal => remote.importIssue(input, signal))
  const createPacket = (input: DeliveryCreatePacketInput): Promise<boolean> =>
    operate('create-packet', signal => remote.createPacket(input, signal))
  const startChange = (input: DeliveryStartChangeInput): Promise<boolean> =>
    operate('start-change', signal => remote.startChange(input, signal))
  const startVerification = (input: DeliveryStartVerificationInput): Promise<boolean> =>
    operate('start-verification', signal => remote.startVerification(input, signal))
  const readEvidence = (input: DeliveryReadEvidenceInput): Promise<boolean> =>
    operate('read-evidence', signal => remote.readEvidence(input, signal), (evidence) => {
      store.update((draft) => { draft.evidence = evidence })
    })
  const recordDecision = (input: DeliveryRecordDecisionInput): Promise<boolean> =>
    operate('record-decision', signal => remote.recordDecision(input, signal))

  function cancel(): void {
    active?.abort('operator-cancelled')
  }

  function dispose(): void {
    disposed = true
    generation += 1
    active?.abort('plugin-disposed')
    active = undefined
  }

  return {
    source,
    load,
    importIssue,
    createPacket,
    startChange,
    startVerification,
    readEvidence,
    recordDecision,
    cancel,
    dispose,
  }
}

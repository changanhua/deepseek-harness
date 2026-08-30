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

/** Browser-local evidence selection; only the evidence id crosses Remote. */
export interface DeliveryEvidenceSelectionInput extends DeliveryReadEvidenceInput {
  readonly packetId: string
}

/** Evidence accepted only for one selected Packet and one controller request. */
export interface DeliveryEvidenceState {
  readonly packetId: string
  readonly requestToken: number
  readonly value: DeliveryEvidenceView
}

/** Last accepted host projection plus honest loading/error state. */
export interface DeliveryRuntimeState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  snapshot: DeliverySnapshotView | undefined
  pending: DeliveryPendingOperation | null
  actionError: string | null
  lastSucceeded: DeliveryPendingOperation | null
  evidence: DeliveryEvidenceState | undefined
}

/** Apply-private observable lifecycle. */
export interface DeliveryRuntimeController {
  readonly source: HostObservable<DeliveryRuntimeState>
  load(): void
  importIssue(input: DeliveryImportIssueInput): Promise<boolean>
  createPacket(input: DeliveryCreatePacketInput): Promise<boolean>
  startChange(input: DeliveryStartChangeInput): Promise<boolean>
  startVerification(input: DeliveryStartVerificationInput): Promise<boolean>
  selectPacket(packetId: string): void
  readEvidence(input: DeliveryEvidenceSelectionInput): Promise<boolean>
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
  let snapshotGeneration = 0
  let mutationGeneration = 0
  let evidenceRequestToken = 0
  let selectedPacketId = ''
  let activeSnapshot: AbortController | undefined
  let activeMutation: {
    readonly controller: AbortController
    readonly operation: DeliveryPendingOperation
    readonly request: number
  } | undefined
  let disposed = false
  const source: HostObservable<DeliveryRuntimeState> = {
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
  }

  function fail(request: number, message: string): void {
    if (disposed || request !== snapshotGeneration) return
    store.update((draft) => {
      draft.status = 'error'
      draft.error = message
    })
  }

  function load(): void {
    if (disposed) return
    activeSnapshot?.abort('superseded')
    const controller = new AbortController()
    activeSnapshot = controller
    const request = ++snapshotGeneration
    store.update((draft) => {
      draft.status = 'loading'
      draft.error = null
    })
    void remote.snapshot(controller.signal).then((result) => {
      if (disposed || request !== snapshotGeneration || activeSnapshot !== controller) return
      activeSnapshot = undefined
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
      if (activeSnapshot === controller) activeSnapshot = undefined
      fail(request, error instanceof Error ? error.message : String(error))
    })
  }

  async function operate<T>(
    operation: DeliveryPendingOperation,
    invoke: (signal: AbortSignal) => Promise<RemoteResult<T>>,
    accepted?: (value: T) => boolean | void,
  ): Promise<boolean> {
    if (disposed) return false
    if (store.getSnapshot().pending !== null) {
      store.update((draft) => {
        draft.actionError = 'Another Delivery operation is still running'
      })
      return false
    }
    const controller = new AbortController()
    const request = ++mutationGeneration
    activeMutation = { controller, operation, request }
    store.update((draft) => {
      draft.pending = operation
      draft.actionError = null
      draft.lastSucceeded = null
    })
    const ownsPending = (): boolean => activeMutation?.request === request
      && activeMutation.controller === controller
      && activeMutation.operation === operation
    const clearOwnedPending = (): void => {
      activeMutation = undefined
      store.update((draft) => { draft.pending = null })
    }
    try {
      const result = await invoke(controller.signal)
      if (!ownsPending()) return false
      if (!result.ok) {
        store.update((draft) => {
          draft.pending = null
          draft.actionError = failureMessage(result)
        })
        activeMutation = undefined
        return false
      }
      if (accepted?.(result.value) === false) {
        clearOwnedPending()
        return false
      }
      store.update((draft) => {
        draft.pending = null
        draft.actionError = null
        draft.lastSucceeded = operation
      })
      activeMutation = undefined
      if (operation !== 'read-evidence') load()
      return true
    } catch (error) {
      if (!ownsPending()) return false
      store.update((draft) => {
        draft.pending = null
        draft.actionError = error instanceof Error ? error.message : String(error)
      })
      activeMutation = undefined
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
  function selectPacket(packetId: string): void {
    if (selectedPacketId === packetId) return
    selectedPacketId = packetId
    evidenceRequestToken += 1
    if (activeMutation?.operation === 'read-evidence') {
      const stale = activeMutation
      activeMutation = undefined
      mutationGeneration += 1
      stale.controller.abort('packet-selection-changed')
    }
    store.update((draft) => {
      draft.evidence = undefined
      if (draft.pending === 'read-evidence') draft.pending = null
    })
  }
  const readEvidence = (input: DeliveryEvidenceSelectionInput): Promise<boolean> => {
    if (selectedPacketId !== input.packetId) return Promise.resolve(false)
    const requestToken = ++evidenceRequestToken
    store.update((draft) => { draft.evidence = undefined })
    return operate(
      'read-evidence',
      signal => remote.readEvidence({ evidenceId: input.evidenceId }, signal),
      (evidence) => {
        if (
          String(evidence.provenance.packetId) !== input.packetId
        ) return false
        store.update((draft) => {
          draft.evidence = { packetId: input.packetId, requestToken, value: evidence }
        })
      },
    )
  }
  const recordDecision = (input: DeliveryRecordDecisionInput): Promise<boolean> =>
    operate('record-decision', signal => remote.recordDecision(input, signal))

  function cancel(): void {
    if (activeMutation !== undefined) {
      activeMutation.controller.abort('operator-cancelled')
      return
    }
    activeSnapshot?.abort('operator-cancelled')
  }

  function dispose(): void {
    disposed = true
    snapshotGeneration += 1
    mutationGeneration += 1
    activeSnapshot?.abort('plugin-disposed')
    activeMutation?.controller.abort('plugin-disposed')
    activeSnapshot = undefined
    activeMutation = undefined
  }

  return {
    source,
    load,
    importIssue,
    createPacket,
    startChange,
    startVerification,
    selectPacket,
    readEvidence,
    recordDecision,
    cancel,
    dispose,
  }
}

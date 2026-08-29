/** Personal Delivery ledger, evidence spine, and explicit human operations. */

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  DeliveryAttentionReason,
  DeliveryCreatePacketInput,
  DeliveryLane,
  DeliveryWorkbenchCard,
} from '@deepseek-ai/dsh-delivery-remote/types'
import type { DeliveryWorkspaceProps } from './contract.ts'
import type { DeliveryKey } from './locales.ts'
import type { DeliveryPendingOperation, DeliveryRuntimeState } from './runtime-controller.ts'
import css from './DeliveryWorkbench.module.css'

const LANES: readonly DeliveryLane[] = ['ready', 'running', 'review', 'blocked', 'accepted']
const LANE_KEYS: Readonly<Record<DeliveryLane, DeliveryKey>> = {
  ready: 'lane.ready',
  running: 'lane.running',
  review: 'lane.review',
  blocked: 'lane.blocked',
  accepted: 'lane.accepted',
}
const SUCCESS_KEYS: Readonly<Record<DeliveryPendingOperation, DeliveryKey>> = {
  'import-issue': 'view.succeeded.import-issue',
  'create-packet': 'view.succeeded.create-packet',
  'start-change': 'view.succeeded.start-change',
  'start-verification': 'view.succeeded.start-verification',
  'read-evidence': 'view.succeeded.read-evidence',
  'record-decision': 'view.succeeded.record-decision',
}
const ATTENTION_KEYS: Readonly<Record<DeliveryAttentionReason, DeliveryKey>> = {
  'bound-work-unavailable': 'attention.bound-work-unavailable',
  'queue-work-failed': 'attention.queue-work-failed',
  'queue-attention': 'attention.queue-attention',
  'change-result-invalid': 'attention.change-result-invalid',
  'verification-result-invalid': 'attention.verification-result-invalid',
  'change-interrupted': 'attention.change-interrupted',
  'change-blocked': 'attention.change-blocked',
  'verification-failed': 'attention.verification-failed',
  'verification-needs-human-review': 'attention.verification-needs-human-review',
  'decision-rejected': 'attention.decision-rejected',
  'projection-inconsistent': 'attention.projection-inconsistent',
}
const VERDICT_KEYS = {
  passed: 'verdict.passed',
  failed: 'verdict.failed',
  'needs-human-review': 'verdict.needs-human-review',
} as const satisfies Record<NonNullable<DeliveryWorkbenchCard['verificationVerdict']>['status'], DeliveryKey>
const DECISION_STATUS_KEYS = {
  accepted: 'decision.status.accepted',
  rejected: 'decision.status.rejected',
  waived: 'decision.status.waived',
} as const satisfies Record<NonNullable<DeliveryWorkbenchCard['acceptanceDecision']>['decision'], DeliveryKey>

const MAX_BROWSER_EVIDENCE_BYTES = 256 * 1024

function lines(value: string): string[] {
  return value.split(/\r?\n/u).map(line => line.trim()).filter(line => line !== '')
}

function pathRules(value: string): DeliveryCreatePacketInput['packet']['allowedPaths'] {
  return lines(value).map(path => ({ kind: 'subtree', path: path as never }))
}

function abbreviated(value: string | null): string {
  return value === null ? '—' : value.slice(0, 12)
}

function evidenceIds(card: DeliveryWorkbenchCard): string[] {
  return [...new Set([
    ...(card.completionClaim?.evidenceIds ?? []),
    ...(card.verificationVerdict?.evidenceIds ?? []),
    ...(card.verificationVerdict?.checkResults.flatMap(result => result.evidenceIds) ?? []),
  ])].map(String).sort((left, right) => left.localeCompare(right))
}

function decodePlainText(contentBase64: string, byteLength: number): string | null {
  if (byteLength > MAX_BROWSER_EVIDENCE_BYTES || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(contentBase64)) {
    return null
  }
  try {
    const binary = globalThis.atob(contentBase64)
    if (binary.length !== byteLength) return null
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function queueStatus(card: DeliveryWorkbenchCard, kind: DeliveryWorkbenchCard['dispatches'][number]['binding']['kind']): string | null {
  const queue = card.dispatches.find(dispatch => dispatch.binding.kind === kind)?.queue
  return queue?.status ?? null
}

function ImportForm(props: Pick<DeliveryWorkspaceProps, 'importIssue' | 't'> & { busy: boolean }) {
  const [issueUrl, setIssueUrl] = useState('')
  const [repositoryId, setRepositoryId] = useState('')
  const ready = issueUrl.trim() !== '' && repositoryId.trim() !== '' && !props.busy
  return (
    <form
      className={css.commandCard}
      aria-label={props.t('import.title')}
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready) return
        void props.importIssue({ issueUrl: issueUrl.trim(), repositoryId: repositoryId.trim() })
      }}
    >
      <h2>{props.t('import.title')}</h2>
      <label>
        <span>{props.t('import.issueUrl')}</span>
        <input
          type="url"
          aria-label={props.t('import.issueUrl')}
          disabled={props.busy}
          value={issueUrl}
          onChange={(event) => { setIssueUrl(event.currentTarget.value) }}
        />
      </label>
      <label>
        <span>{props.t('import.repository')}</span>
        <input
          aria-label={props.t('import.repository')}
          disabled={props.busy}
          value={repositoryId}
          onChange={(event) => { setRepositoryId(event.currentTarget.value) }}
        />
      </label>
      <button type="submit" disabled={!ready}>{props.t('import.submit')}</button>
    </form>
  )
}

function PacketForm(props: Pick<DeliveryWorkspaceProps, 'createPacket' | 't'> & {
  contracts: readonly DeliveryWorkbenchCard['contractRevision'][]
  busy: boolean
}) {
  const [contractId, setContractId] = useState(props.contracts[0]?.id ?? '')
  const contract = props.contracts.find(candidate => candidate.id === contractId) ?? props.contracts[0]
  const [objective, setObjective] = useState(contract?.outcome ?? '')
  const [allowed, setAllowed] = useState('')
  const [forbidden, setForbidden] = useState('')
  const [stop, setStop] = useState('')
  const [executor, setExecutor] = useState('codex')
  const [clauseIds, setClauseIds] = useState<string[]>(
    () => contract?.acceptanceClauses.map(clause => String(clause.id)) ?? [],
  )

  useEffect(() => {
    const next = props.contracts.find(candidate => candidate.id === contractId) ?? props.contracts[0]
    if (next === undefined) return
    if (next.id !== contractId) setContractId(next.id)
    setObjective(next.outcome ?? '')
    setClauseIds(next.acceptanceClauses.map(clause => String(clause.id)))
  }, [contractId, props.contracts])

  const allowedPaths = pathRules(allowed)
  const forbiddenPaths = pathRules(forbidden)
  const ready = contract !== undefined
    && objective.trim() !== ''
    && clauseIds.length > 0
    && (allowedPaths.length > 0 || forbiddenPaths.length > 0)
    && !props.busy
  return (
    <form
      className={css.commandCard}
      aria-label={props.t('packet.title')}
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready) return
        void props.createPacket({
          contractRevisionId: String(contract.id),
          packet: {
            objective: objective.trim(),
            allowedPaths,
            forbiddenPaths,
            acceptanceClauseIds: clauseIds as never,
            stopConditions: lines(stop),
            executorPreference: executor.trim() === ''
              ? { mode: 'any' }
              : { mode: 'preferred', executorId: executor.trim() as never },
          },
        })
      }}
    >
      <h2>{props.t('packet.title')}</h2>
      {contract === undefined
        ? <p className={css.muted}>{props.t('packet.noContract')}</p>
        : <>
          <label>
            <span>{props.t('packet.contract')}</span>
            <select
              aria-label={props.t('packet.contract')}
              disabled={props.busy}
              value={contract.id}
              onChange={(event) => { setContractId(event.currentTarget.value) }}
            >
              {props.contracts.map(candidate => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.sourceRef.repository.owner}/{candidate.sourceRef.repository.name}#{candidate.sourceRef.issueNumber}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{props.t('packet.objective')}</span>
            <textarea disabled={props.busy} aria-label={props.t('packet.objective')} value={objective} onChange={(event) => { setObjective(event.currentTarget.value) }} />
          </label>
          <div className={css.twoFields}>
            <label>
              <span>{props.t('packet.allowed')}</span>
              <textarea disabled={props.busy} aria-label={props.t('packet.allowed')} value={allowed} onChange={(event) => { setAllowed(event.currentTarget.value) }} />
            </label>
            <label>
              <span>{props.t('packet.forbidden')}</span>
              <textarea disabled={props.busy} aria-label={props.t('packet.forbidden')} value={forbidden} onChange={(event) => { setForbidden(event.currentTarget.value) }} />
            </label>
          </div>
          <label>
            <span>{props.t('packet.stop')}</span>
            <textarea disabled={props.busy} aria-label={props.t('packet.stop')} value={stop} onChange={(event) => { setStop(event.currentTarget.value) }} />
          </label>
          <label>
            <span>{props.t('packet.executor')}</span>
            <input disabled={props.busy} aria-label={props.t('packet.executor')} value={executor} onChange={(event) => { setExecutor(event.currentTarget.value) }} />
          </label>
          <fieldset className={css.clauses}>
            <legend>{props.t('packet.clauses')}</legend>
            {contract.acceptanceClauses.map(clause => (
              <label key={clause.id}>
                <input
                  type="checkbox"
                  disabled={props.busy}
                  checked={clauseIds.includes(String(clause.id))}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked
                    setClauseIds(current => checked
                      ? [...new Set([...current, String(clause.id)])]
                      : current.filter(id => id !== clause.id))
                  }}
                />
                <span>{clause.text}</span>
              </label>
            ))}
          </fieldset>
          <button type="submit" disabled={!ready}>{props.t('packet.submit')}</button>
        </>}
    </form>
  )
}

function EvidenceSpine({ card, t }: { card: DeliveryWorkbenchCard; t: DeliveryWorkspaceProps['t'] }) {
  const change = queueStatus(card, 'code.change@1')
  const verification = queueStatus(card, 'code.verify@1')
  const nodes = [
    { label: t('spine.scope'), value: `${String(card.packet.allowedPaths.length)}/${String(card.packet.forbiddenPaths.length)}` },
    { label: t('spine.change'), value: change === null ? t('spine.pending') : t(`queue.${change}` as DeliveryKey) },
    { label: t('spine.checkpoint'), value: abbreviated(card.completionClaim?.disposition === 'completed' ? card.completionClaim.checkpointCommit : null) },
    { label: t('spine.verification'), value: card.verificationVerdict === null ? (verification === null ? t('spine.pending') : t(`queue.${verification}` as DeliveryKey)) : t(VERDICT_KEYS[card.verificationVerdict.status]) },
    { label: t('spine.decision'), value: card.acceptanceDecision === null ? t('spine.pending') : t(DECISION_STATUS_KEYS[card.acceptanceDecision.decision]) },
  ]
  return (
    <ol className={css.spine}>
      {nodes.map((node, index) => (
        <li key={node.label} data-complete={index === 0 || node.value !== t('spine.pending') ? true : undefined}>
          <span className={css.spineDot} aria-hidden="true" />
          <strong>{node.label}</strong>
          <span>{node.value}</span>
        </li>
      ))}
    </ol>
  )
}

function PacketDetail(props: DeliveryWorkspaceProps & {
  card: DeliveryWorkbenchCard
  runtime: DeliveryRuntimeState
}) {
  const { card, runtime, t } = props
  const [executor, setExecutor] = useState('codex')
  const changes = card.dispatches.filter(dispatch =>
    dispatch.binding.kind === 'code.change@1' && dispatch.binding.phase === 'bound',
  )
  const verifications = card.dispatches.filter(dispatch =>
    dispatch.binding.kind === 'code.verify@1' && dispatch.binding.phase === 'bound',
  )
  const [changeBindingId, setChangeBindingId] = useState(changes[0]?.binding.id ?? '')
  const [verificationBindingId, setVerificationBindingId] = useState(verifications[0]?.binding.id ?? '')
  const [decision, setDecision] = useState<'accepted' | 'rejected' | 'waived'>('accepted')
  const [reason, setReason] = useState('')
  const [nonce, setNonce] = useState('')
  const selectedChangeBindingId = changes.some(dispatch => dispatch.binding.id === changeBindingId)
    ? changeBindingId
    : changes[0]?.binding.id ?? ''
  const selectedVerificationBindingId = verifications.some(dispatch =>
    dispatch.binding.id === verificationBindingId,
  )
    ? verificationBindingId
    : verifications[0]?.binding.id ?? ''

  useEffect(() => {
    setChangeBindingId(changes[0]?.binding.id ?? '')
    setVerificationBindingId(verifications[0]?.binding.id ?? '')
    setReason('')
    setNonce('')
  }, [card.packet.id])

  const ids = evidenceIds(card)
  const evidence = runtime.evidence?.packetId === card.packet.id
    && ids.includes(String(runtime.evidence.value.id))
    ? runtime.evidence.value
    : undefined
  const evidenceText = evidence?.mediaType.split(';', 1)[0]?.trim().toLowerCase() === 'text/plain'
    ? decodePlainText(evidence.contentBase64, evidence.byteLength)
    : undefined
  const busy = runtime.pending !== null || runtime.status === 'loading'
  const canStart = changes.length === 0 && card.lane === 'ready'
  const canVerify = card.completionClaim?.disposition === 'completed' && verifications.length === 0
  const canDecide = card.verificationVerdict !== null
    && selectedChangeBindingId !== ''
    && selectedVerificationBindingId !== ''
    && reason.trim() !== ''
    && nonce.trim() !== ''
  return (
    <aside className={css.detailPane} aria-label={t('detail.title')}>
      <div className={css.detailHead}>
        <div>
          <span>{t(LANE_KEYS[card.lane])}</span>
          <h2>{card.packet.objective}</h2>
        </div>
        <code>{card.packet.id}</code>
      </div>
      <EvidenceSpine card={card} t={t} />
      <dl className={css.facts}>
        <div><dt>{t('detail.contract')}</dt><dd><code>{card.contractRevision.id}</code></dd></div>
        <div><dt>{t('detail.base')}</dt><dd><code>{abbreviated(card.packet.baseCommit)}</code></dd></div>
        <div><dt>{t('detail.plan')}</dt><dd><code>{abbreviated(card.packet.verificationPlan.digest)}</code></dd></div>
      </dl>
      {card.attentionReasons.length > 0 && (
        <section className={css.attention} aria-label={t('detail.attention')}>
          <h3>{t('detail.attention')}</h3>
          <ul>{card.attentionReasons.map(reasonCode => (
            <li key={reasonCode}>{t(ATTENTION_KEYS[reasonCode])}</li>
          ))}</ul>
        </section>
      )}
      {canStart && (
        <section className={css.actionBlock}>
          <label>
            <span>{t('action.executor')}</span>
            <input disabled={busy} aria-label={t('action.executor')} value={executor} onChange={(event) => { setExecutor(event.currentTarget.value) }} />
          </label>
          <button
            type="button"
            disabled={busy || executor.trim() === ''}
            onClick={() => { void props.startChange({ packetId: String(card.packet.id), executorId: executor.trim() }) }}
          >
            {t('action.startChange')}
          </button>
        </section>
      )}
      {canVerify && changes.length > 0 && (
        <section className={css.actionBlock}>
          <label>
            <span>{t('verification.changeBinding')}</span>
            <select
              aria-label={t('verification.changeBinding')}
              disabled={busy}
              value={selectedChangeBindingId}
              onChange={(event) => { setChangeBindingId(event.currentTarget.value) }}
            >
              {changes.map(dispatch => <option key={dispatch.binding.id} value={dispatch.binding.id}>{dispatch.binding.id}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy || selectedChangeBindingId === ''} onClick={() => { void props.startVerification({
            packetId: String(card.packet.id),
            changeBindingId: selectedChangeBindingId,
          }) }}>
            {t('action.startVerification')}
          </button>
        </section>
      )}
      <section className={css.evidenceSection}>
        <h3>{t('evidence.content')}</h3>
        {ids.length === 0
          ? <p className={css.muted}>{t('evidence.none')}</p>
          : <div className={css.evidenceButtons}>{ids.map(id => (
            <button key={id} type="button" disabled={busy} onClick={() => { void props.readEvidence({
              packetId: String(card.packet.id), evidenceId: id as never,
            }) }}>
              {t('evidence.read', { id })}
            </button>
          ))}</div>}
        {evidence !== undefined && evidenceText !== undefined && evidenceText !== null && (
          <pre className={css.evidenceContent}>{evidenceText}</pre>
        )}
        {evidence !== undefined && evidenceText === null && (
          <p className={css.muted}>{t('evidence.invalidText')}</p>
        )}
        {evidence !== undefined && evidenceText === undefined && (
          <p className={css.muted}>{t('evidence.binary', {
            mediaType: evidence.mediaType,
            byteLength: evidence.byteLength,
          })}</p>
        )}
      </section>
      {card.verificationVerdict !== null && changes.length > 0 && verifications.length > 0 && (
        <form
          className={css.decision}
          aria-label={t('decision.title')}
          onSubmit={(event) => {
            event.preventDefault()
            if (!canDecide) return
            void props.recordDecision({
              packetId: String(card.packet.id),
              changeBindingId: selectedChangeBindingId,
              verificationBindingId: selectedVerificationBindingId,
              decision,
              reason: reason.trim(),
              decisionNonce: nonce.trim(),
            })
          }}
        >
          <h3>{t('decision.title')}</h3>
          <div className={css.twoFields}>
            <label>
              <span>{t('decision.changeBinding')}</span>
              <select
                aria-label={t('decision.changeBinding')}
                disabled={busy}
                value={selectedChangeBindingId}
                onChange={(event) => { setChangeBindingId(event.currentTarget.value) }}
              >
                {changes.map(dispatch => <option key={dispatch.binding.id} value={dispatch.binding.id}>{dispatch.binding.id}</option>)}
              </select>
            </label>
            <label>
              <span>{t('decision.verificationBinding')}</span>
              <select
                aria-label={t('decision.verificationBinding')}
                disabled={busy}
                value={selectedVerificationBindingId}
                onChange={(event) => { setVerificationBindingId(event.currentTarget.value) }}
              >
                {verifications.map(dispatch => (
                  <option key={dispatch.binding.id} value={dispatch.binding.id}>
                    {dispatch.binding.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <span>{t('decision.kind')}</span>
            <select disabled={busy} aria-label={t('decision.kind')} value={decision} onChange={(event) => { setDecision(event.currentTarget.value as typeof decision) }}>
              <option value="accepted">{t('decision.accepted')}</option>
              <option value="rejected">{t('decision.rejected')}</option>
              <option value="waived">{t('decision.waived')}</option>
            </select>
          </label>
          <label>
            <span>{t('decision.reason')}</span>
            <textarea disabled={busy} aria-label={t('decision.reason')} value={reason} onChange={(event) => { setReason(event.currentTarget.value) }} />
          </label>
          <label>
            <span>{t('decision.nonce')}</span>
            <input disabled={busy} aria-label={t('decision.nonce')} value={nonce} onChange={(event) => { setNonce(event.currentTarget.value) }} />
          </label>
          <button type="submit" disabled={busy || !canDecide}>{t('decision.submit')}</button>
        </form>
      )}
    </aside>
  )
}

/** Render the locale-owned Personal Delivery workbench. */
export function DeliveryWorkbench(props: DeliveryWorkspaceProps) {
  const state = props.useDelivery(value => value)
  const snapshot = state.snapshot
  const [lane, setLane] = useState<DeliveryLane | 'all'>('all')
  const [selectedId, setSelectedId] = useState(snapshot?.cards[0]?.packet.id ?? '')
  const cardRefs = useRef(new Map<string, HTMLButtonElement>())

  const counts = useMemo(() => Object.fromEntries(LANES.map(candidate => [
    candidate,
    snapshot?.cards.filter(card => card.lane === candidate).length ?? 0,
  ])) as Record<DeliveryLane, number>, [snapshot])
  const cards = snapshot?.cards.filter(card => lane === 'all' || card.lane === lane) ?? []
  const selected = cards.find(card => card.packet.id === selectedId) ?? cards[0] ?? null
  const busy = state.pending !== null || state.status === 'loading'

  useEffect(() => {
    if (selected === null || selected.packet.id === selectedId) return
    setSelectedId(selected.packet.id)
  }, [selected, selectedId])

  useEffect(() => {
    props.selectPacket(selected === null ? '' : String(selected.packet.id))
  }, [props.selectPacket, selected?.packet.id])

  return (
    <main className={css.workspace} aria-label={props.t('nav.delivery')}>
      <header className={css.header}>
        <div>
          <h1>{props.t('view.title')}</h1>
          <p>{props.t('view.subtitle')}</p>
        </div>
        <div className={css.headerActions}>
          <button type="button" onClick={props.refresh} disabled={busy}>{props.t('view.refresh')}</button>
          {(state.pending !== null || (state.status === 'loading' && snapshot === undefined)) && (
            <button type="button" onClick={props.cancel}>{props.t('view.cancel')}</button>
          )}
        </div>
      </header>

      {state.status === 'loading' && snapshot === undefined && <p className={css.loading}>{props.t('view.loading')}</p>}
      {state.status === 'error' && (
        <div className={css.error} role="alert">
          <span>{props.t('view.error', { message: state.error ?? '' })}</span>
          <button type="button" onClick={props.refresh} disabled={busy}>{props.t('view.retry')}</button>
        </div>
      )}
      {state.actionError !== null && <div className={css.error} role="alert">{props.t('view.actionError', { message: state.actionError })}</div>}
      {state.lastSucceeded !== null && <p className={css.success} role="status">{props.t(SUCCESS_KEYS[state.lastSucceeded])}</p>}

      {snapshot !== undefined && (
        <>
          <section className={css.commandShelf}>
            <ImportForm importIssue={props.importIssue} t={props.t} busy={busy} />
            <PacketForm contracts={snapshot.contractsWithoutPacket} createPacket={props.createPacket} t={props.t} busy={busy} />
          </section>
          <nav className={css.trace} aria-label={props.t('ledger.title')}>
            <button type="button" aria-pressed={lane === 'all'} data-active={lane === 'all' || undefined} onClick={() => { setLane('all') }}>
              {props.t('lane.all')} {snapshot.cards.length}
            </button>
            {LANES.map(candidate => (
              <button
                type="button"
                key={candidate}
                data-lane={candidate}
                data-active={lane === candidate || undefined}
                aria-pressed={lane === candidate}
                onClick={() => { setLane(candidate) }}
              >
                {props.t(LANE_KEYS[candidate])} {counts[candidate]}
              </button>
            ))}
          </nav>
          {snapshot.cards.length === 0 && snapshot.contractsWithoutPacket.length === 0 && (
            <p className={css.empty}>{props.t('view.empty')}</p>
          )}
          <section className={css.ledgerShell}>
            <section className={css.ledger} aria-label={props.t('ledger.title')}>
              <div className={css.ledgerHead}>
                <h2>{props.t('ledger.title')}</h2>
                <span>{props.t('ledger.count', { count: cards.length })}</span>
              </div>
              <ul role="listbox" aria-label={props.t('ledger.title')}>
                {cards.map((card, index) => (
                  <li key={card.packet.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected?.packet.id === card.packet.id}
                      className={selected?.packet.id === card.packet.id ? css.selectedCard : undefined}
                      aria-label={`${card.packet.objective} — ${props.t(LANE_KEYS[card.lane])}`}
                      onClick={() => { setSelectedId(card.packet.id) }}
                      onKeyDown={(event) => {
                        const offset = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
                        const nextIndex = event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? cards.length - 1
                            : offset === 0
                              ? index
                              : (index + offset + cards.length) % cards.length
                        if (nextIndex === index && !['Home', 'End'].includes(event.key)) return
                        event.preventDefault()
                        const next = cards[nextIndex]
                        /* v8 ignore next -- nextIndex is clamped or wrapped against this non-empty list. */
                        if (next === undefined) return
                        setSelectedId(next.packet.id)
                        cardRefs.current.get(String(next.packet.id))?.focus()
                      }}
                      ref={(element) => {
                        if (element === null) cardRefs.current.delete(String(card.packet.id))
                        else cardRefs.current.set(String(card.packet.id), element)
                      }}
                    >
                      <span className={css.cardLane} data-lane={card.lane}>{props.t(LANE_KEYS[card.lane])}</span>
                      <strong>{card.packet.objective}</strong>
                      <code>{card.packet.id}</code>
                      <span>
                        {card.contractRevision.sourceRef.repository.owner}/
                        {card.contractRevision.sourceRef.repository.name}
                        #{card.contractRevision.sourceRef.issueNumber}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            {selected === null
              ? <aside className={css.detailPane} aria-label={props.t('detail.title')}><p className={css.empty}>{props.t('detail.select')}</p></aside>
              : <PacketDetail {...props} card={selected} runtime={state} />}
          </section>
        </>
      )}
    </main>
  )
}

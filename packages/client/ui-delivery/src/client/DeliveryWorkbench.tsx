/** Personal Delivery ledger, evidence spine, and explicit human operations. */

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  DeliveryAttentionReason,
  DeliveryCaseCard,
  DeliveryCaseLane,
  DeliveryCreatePacketInput,
  DeliveryLane,
  DeliveryWorkbenchCard,
} from '@changanhua/dsh-delivery-remote/types'
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
  'create-case': 'view.succeeded.create-case',
  'revise-case': 'view.succeeded.revise-case',
  'record-requirement-decision': 'view.succeeded.record-requirement-decision',
  'publish-issue': 'view.succeeded.publish-issue',
  'resolve-publication': 'view.succeeded.resolve-publication',
  'import-issue': 'view.succeeded.import-issue',
  'create-packet': 'view.succeeded.create-packet',
  'start-change': 'view.succeeded.start-change',
  'start-verification': 'view.succeeded.start-verification',
  'read-evidence': 'view.succeeded.read-evidence',
  'record-decision': 'view.succeeded.record-decision',
}

const CASE_LANE_KEYS: Readonly<Record<DeliveryCaseLane, DeliveryKey>> = {
  shaping: 'case.shaping',
  ready: 'case.ready',
  running: 'case.running',
  review: 'case.review',
  blocked: 'case.blocked',
  accepted: 'case.accepted',
}
const READINESS_KEYS: Readonly<Record<DeliveryCaseCard['readiness']['reasons'][number], DeliveryKey>> = {
  'missing-outcome': 'case.readiness.missing-outcome',
  'missing-repository': 'case.readiness.missing-repository',
  'missing-scope': 'case.readiness.missing-scope',
  'missing-acceptance': 'case.readiness.missing-acceptance',
  'missing-base-selection': 'case.readiness.missing-base-selection',
  'missing-verification-source': 'case.readiness.missing-verification-source',
  'open-decisions': 'case.readiness.open-decisions',
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

function argumentLines(value: string): string[] {
  return value === '' ? [] : value.split(/\r?\n/u)
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
  const ready = issueUrl.trim() !== '' && !props.busy
  return (
    <form
      className={css.commandCard}
      aria-label={props.t('import.title')}
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready) return
        void props.importIssue({ issueUrl: issueUrl.trim() })
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
      <button type="submit" disabled={!ready}>{props.t('import.submit')}</button>
    </form>
  )
}

function CaseCaptureForm(props: Pick<DeliveryWorkspaceProps, 'createCase' | 't'> & { busy: boolean }) {
  const [idea, setIdea] = useState('')
  const normalizedIdea = idea.trim()
  const title = normalizedIdea.split(/\r?\n/u).find(line => line.trim() !== '')?.trim() ?? ''
  const ready = title !== '' && !props.busy
  return (
    <form className={css.commandCard} aria-label={props.t('case.createTitle')} onSubmit={(event) => {
      event.preventDefault()
      if (!ready) return
      const disclosure = event.currentTarget.closest('details')
      void props.createCase({
        title,
        revision: {
          outcome: null,
          context: normalizedIdea,
          allowedScope: [],
          forbiddenScope: [],
          acceptanceClauses: [],
          openDecisions: [],
          baseSelectionRule: null,
          verificationSource: null,
          referenceLinks: [],
        },
      }).then((saved) => {
        if (!saved) return
        setIdea('')
        if (disclosure !== null) disclosure.open = false
      })
    }}>
      <h2>{props.t('case.createTitle')}</h2>
      <label>
        <span>{props.t('case.idea')}</span>
        <textarea value={idea} disabled={props.busy} onChange={(event) => { setIdea(event.currentTarget.value) }} />
      </label>
      <button type="submit" disabled={!ready}>{props.t('case.create')}</button>
    </form>
  )
}

function CaseForm(props: Pick<DeliveryWorkspaceProps, 'reviseCase' | 't'> & {
  card: DeliveryCaseCard
  busy: boolean
}) {
  const revision = props.card.headRevision
  type BaseSelectionKind = NonNullable<typeof revision.baseSelectionRule>['kind']
  type VerificationSourceKind = NonNullable<typeof revision.verificationSource>['kind']
  type InlineCheck = Extract<NonNullable<typeof revision.verificationSource>, { readonly kind: 'contract-field' }>['checks'][number]
  type CheckFields = {
    readonly id: string
    readonly original: InlineCheck | null
    readonly name: string
    readonly program: string
    readonly argumentsText: string
    readonly cwd: string
    readonly timeoutMs: string
    readonly severity: InlineCheck['severity']
    readonly expectedExitCodes: string
  }
  const initialBaseKind = revision.baseSelectionRule?.kind ?? 'ref-head'
  const initialBaseValue = revision.baseSelectionRule?.kind === 'commit'
    ? revision.baseSelectionRule.commit
    : revision.baseSelectionRule?.ref ?? 'HEAD'
  const initialVerificationKind = revision.verificationSource?.kind ?? 'git-blob'
  const checkFields = (check: InlineCheck): CheckFields => ({
    id: String(check.id),
    original: check,
    name: check.name,
    program: check.argv[0] as string,
    argumentsText: check.argv.slice(1).join('\n'),
    cwd: check.cwd,
    timeoutMs: String(check.timeoutMs),
    severity: check.severity,
    expectedExitCodes: check.expectedExitCodes.join(', '),
  })
  const initialChecks = revision.verificationSource?.kind === 'contract-field'
    ? revision.verificationSource.checks.map(checkFields)
    : []
  const initialOutcome = revision.outcome ?? ''
  const initialContext = revision.context
  const initialScope = revision.allowedScope.join('\n')
  const initialAcceptance = revision.acceptanceClauses.map(clause => clause.text).join('\n')
  const [title, setTitle] = useState(revision.title)
  const [outcome, setOutcome] = useState(initialOutcome)
  const [context, setContext] = useState(initialContext)
  const [scope, setScope] = useState(initialScope)
  const [acceptance, setAcceptance] = useState(initialAcceptance)
  const [baseKind, setBaseKind] = useState<BaseSelectionKind>(initialBaseKind)
  const [baseValue, setBaseValue] = useState(initialBaseValue)
  const [verificationKind, setVerificationKind] = useState<VerificationSourceKind>(initialVerificationKind)
  const [verificationPath, setVerificationPath] = useState(revision.verificationSource?.kind === 'git-blob' ? revision.verificationSource.path : '')
  const [checks, setChecks] = useState<CheckFields[]>(initialChecks)
  const [errors, setErrors] = useState<DeliveryKey[]>([])
  useEffect(() => {
    setTitle(revision.title)
    setOutcome(initialOutcome)
    setContext(initialContext)
    setScope(initialScope)
    setAcceptance(initialAcceptance)
    setBaseKind(revision.baseSelectionRule?.kind ?? 'ref-head')
    setBaseValue(revision.baseSelectionRule?.kind === 'commit' ? revision.baseSelectionRule.commit : revision.baseSelectionRule?.ref ?? 'HEAD')
    setVerificationKind(revision.verificationSource?.kind ?? 'git-blob')
    setVerificationPath(revision.verificationSource?.kind === 'git-blob' ? revision.verificationSource.path : '')
    setChecks(revision.verificationSource?.kind === 'contract-field' ? revision.verificationSource.checks.map(checkFields) : [])
    setErrors([])
  }, [revision.id])
  const allowedScope = scope === initialScope ? revision.allowedScope : lines(scope)
  const acceptanceClauses = acceptance === initialAcceptance
    ? revision.acceptanceClauses
    : (() => {
      const oldAcceptanceByText = new Map<string, string[]>()
      for (const clause of revision.acceptanceClauses) {
        const matching = oldAcceptanceByText.get(clause.text) ?? []
        matching.push(String(clause.id))
        oldAcceptanceByText.set(clause.text, matching)
      }
      const usedAcceptanceIds = new Set<string>()
      return lines(acceptance).map((text, index) => {
        const preservedId = oldAcceptanceByText.get(text)?.shift()
        let id = preservedId ?? `acceptance-${String(index + 1)}`
        let suffix = 1
        while (usedAcceptanceIds.has(id) || (!preservedId && revision.acceptanceClauses.some(clause => String(clause.id) === id))) {
          id = `acceptance-${String(index + 1)}-${String(suffix++)}`
        }
        usedAcceptanceIds.add(id)
        return { id: id as never, text }
      })
    })()
  const baseUnchanged = revision.baseSelectionRule?.kind === baseKind && initialBaseValue === baseValue
  const baseSelectionRule = baseUnchanged
    ? revision.baseSelectionRule
    : baseKind === 'commit'
      ? { kind: 'commit' as const, commit: baseValue.trim() as never }
      : { kind: 'ref-head' as const, ref: baseValue.trim() }
  const originalSource = revision.verificationSource
  const sourceUnchanged = originalSource?.kind === verificationKind
    && (originalSource.kind === 'git-blob'
      ? originalSource.path === verificationPath
      : initialChecks.length === checks.length && checks.every((check, index) => {
        const original = initialChecks[index]
        return original !== undefined && check.id === original.id && check.name === original.name
          && check.program === original.program && check.argumentsText === original.argumentsText
          && check.cwd === original.cwd && check.timeoutMs === original.timeoutMs
          && check.severity === original.severity && check.expectedExitCodes === original.expectedExitCodes
      }))
  const verificationSource = sourceUnchanged
    ? originalSource
    : verificationKind === 'git-blob'
      ? { kind: 'git-blob' as const, path: verificationPath.trim() as never, format: 'delivery-verification-plan@1' as const }
      : {
        kind: 'contract-field' as const,
        checks: checks.map(check => check.original !== null
          ? {
            id: check.id as never,
            name: check.name === check.original.name ? check.original.name : check.name.trim(),
            argv: [check.program === check.original.argv[0] ? check.original.argv[0] : check.program.trim(), ...(check.argumentsText === check.original.argv.slice(1).join('\n') ? check.original.argv.slice(1) : argumentLines(check.argumentsText))] as const,
            cwd: (check.cwd === check.original.cwd ? check.original.cwd : check.cwd.trim()) as never,
            timeoutMs: check.timeoutMs === String(check.original.timeoutMs) ? check.original.timeoutMs : Number(check.timeoutMs),
            severity: check.severity,
            expectedExitCodes: check.expectedExitCodes === check.original.expectedExitCodes.join(', ')
              ? check.original.expectedExitCodes
              : check.expectedExitCodes.split(',').map(value => Number(value.trim())),
          }
          : {
            id: check.id as never,
            name: check.name.trim(),
            argv: [check.program.trim(), ...argumentLines(check.argumentsText)] as const,
            cwd: check.cwd.trim() as never,
            timeoutMs: Number(check.timeoutMs),
            severity: check.severity,
            expectedExitCodes: check.expectedExitCodes.split(',').map(value => Number(value.trim())),
          }),
      }
  const validationErrors = (): DeliveryKey[] => {
    const nextErrors: DeliveryKey[] = []
    if (title.trim() === '' || outcome.trim() === '' || allowedScope.length === 0 || acceptanceClauses.length === 0 || baseValue.trim() === '') nextErrors.push('case.error.required')
    if (baseKind === 'commit' && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(baseValue.trim())) nextErrors.push('case.error.commit')
    if (verificationKind === 'git-blob' && verificationPath.trim() === '') nextErrors.push('case.error.planPath')
    if (verificationKind === 'contract-field' && (!checks.length || checks.some(check => check.name.trim() === '' || check.program.trim() === '' || check.cwd.trim() === '' || !/^\d+$/u.test(check.timeoutMs) || Number(check.timeoutMs) <= 0 || check.expectedExitCodes.split(',').some(value => !/^\d+$/u.test(value.trim()))))) nextErrors.push('case.error.check')
    return nextErrors
  }
  const ready = validationErrors().length === 0 && !props.busy
  const updateCheck = (index: number, patch: Partial<CheckFields>) => {
    setChecks(current => current.map((check, candidate) => candidate === index ? { ...check, ...patch } : check))
  }
  const addCheck = () => {
    const oldCheckIds = revision.verificationSource?.kind === 'contract-field'
      ? revision.verificationSource.checks.map(check => String(check.id))
      : []
    const existingIds = new Set([...oldCheckIds, ...checks.map(check => check.id)])
    let index = checks.length + 1
    let id = `check-${String(index)}`
    while (existingIds.has(id)) id = `check-${String(++index)}`
    setChecks(current => [...current, { id, original: null, name: '', program: '', argumentsText: '', cwd: '.', timeoutMs: '30000', severity: 'required', expectedExitCodes: '0' }])
  }
  return (
    <form className={css.commandCard} aria-label={props.t('case.reviseTitle')} onSubmit={(event) => {
      event.preventDefault()
      const nextErrors = validationErrors()
      setErrors(nextErrors)
      if (!ready || nextErrors.length > 0) return
      const input = {
        title: title.trim(),
        revision: {
          outcome: outcome === initialOutcome ? revision.outcome : outcome.trim(),
          context: context === initialContext ? revision.context : context.trim(),
          allowedScope,
          forbiddenScope: revision.forbiddenScope,
          acceptanceClauses,
          openDecisions: revision.openDecisions,
          baseSelectionRule,
          verificationSource,
          referenceLinks: revision.referenceLinks,
        },
      }
      void props.reviseCase({
        ...input,
        caseId: String(props.card.case.id),
        expectedHeadRevisionId: String(props.card.headRevision.id),
      })
    }}>
      <h2>{props.t('case.reviseTitle')}</h2>
      <label><span>{props.t('case.title')}</span><input value={title} disabled={props.busy} onChange={(event) => { setTitle(event.currentTarget.value) }} /></label>
      <label><span>{props.t('case.outcome')}</span><textarea value={outcome} disabled={props.busy} onChange={(event) => { setOutcome(event.currentTarget.value) }} /></label>
      <label><span>{props.t('case.context')}</span><textarea value={context} disabled={props.busy} onChange={(event) => { setContext(event.currentTarget.value) }} /></label>
      <div className={css.twoFields}>
        <label><span>{props.t('case.scope')}</span><textarea value={scope} disabled={props.busy} onChange={(event) => { setScope(event.currentTarget.value) }} /></label>
        <label><span>{props.t('case.acceptance')}</span><textarea value={acceptance} disabled={props.busy} onChange={(event) => { setAcceptance(event.currentTarget.value) }} /></label>
      </div>
      <div className={css.twoFields}>
        <label><span>{props.t('case.baseKind')}</span><select value={baseKind} disabled={props.busy} onChange={(event) => { setBaseKind(event.currentTarget.value as BaseSelectionKind) }}><option value="ref-head">{props.t('case.base.refHead')}</option><option value="commit">{props.t('case.base.commit')}</option></select></label>
        <label><span>{props.t(baseKind === 'commit' ? 'case.commit' : 'case.ref')}</span><input value={baseValue} disabled={props.busy} onChange={(event) => { setBaseValue(event.currentTarget.value) }} /></label>
      </div>
      <label><span>{props.t('case.verificationSource')}</span><select value={verificationKind} disabled={props.busy} onChange={(event) => { setVerificationKind(event.currentTarget.value as VerificationSourceKind) }}><option value="git-blob">{props.t('case.source.gitBlob')}</option><option value="contract-field">{props.t('case.source.contractField')}</option></select></label>
      {verificationKind === 'git-blob'
        ? <label><span>{props.t('case.planPath')}</span><input value={verificationPath} disabled={props.busy} onChange={(event) => { setVerificationPath(event.currentTarget.value) }} /></label>
        : <fieldset className={css.clauses}>
          <legend>{props.t('case.inlineChecks')}</legend>
          {checks.map((check, index) => <section key={check.id} className={css.commandCard}>
            <label><span>{props.t('case.checkName')}</span><input value={check.name} disabled={props.busy} onChange={(event) => { updateCheck(index, { name: event.currentTarget.value }) }} /></label>
            <label><span>{props.t('case.checkProgram')}</span><input value={check.program} disabled={props.busy} onChange={(event) => { updateCheck(index, { program: event.currentTarget.value }) }} /></label>
            <label><span>{props.t('case.checkArguments')}</span><textarea value={check.argumentsText} disabled={props.busy} onChange={(event) => { updateCheck(index, { argumentsText: event.currentTarget.value }) }} /></label>
            <div className={css.twoFields}>
              <label><span>{props.t('case.checkCwd')}</span><input value={check.cwd} disabled={props.busy} onChange={(event) => { updateCheck(index, { cwd: event.currentTarget.value }) }} /></label>
              <label><span>{props.t('case.checkTimeout')}</span><input inputMode="numeric" value={check.timeoutMs} disabled={props.busy} onChange={(event) => { updateCheck(index, { timeoutMs: event.currentTarget.value }) }} /></label>
            </div>
            <div className={css.twoFields}>
              <label><span>{props.t('case.checkSeverity')}</span><select value={check.severity} disabled={props.busy} onChange={(event) => { updateCheck(index, { severity: event.currentTarget.value as InlineCheck['severity'] }) }}><option value="required">{props.t('case.check.required')}</option><option value="optional">{props.t('case.check.optional')}</option></select></label>
              <label><span>{props.t('case.checkExitCodes')}</span><input inputMode="numeric" value={check.expectedExitCodes} disabled={props.busy} onChange={(event) => { updateCheck(index, { expectedExitCodes: event.currentTarget.value }) }} /></label>
            </div>
            <button type="button" disabled={props.busy} onClick={() => { setChecks(current => current.filter((_check, candidate) => candidate !== index)) }}>{props.t('case.removeCheck')}</button>
          </section>)}
          <button type="button" disabled={props.busy} onClick={addCheck}>{props.t('case.addCheck')}</button>
        </fieldset>}
      {errors.map(error => <p key={error} className={css.muted} role="alert">{props.t(error)}</p>)}
      <button type="submit" disabled={props.busy}>{props.t('case.revise')}</button>
    </form>
  )
}

function CaseAuthority(
  props: Pick<DeliveryWorkspaceProps,
    'recordRequirementDecision' | 'publishIssue' | 'resolvePublication' | 't'> & {
      card: DeliveryCaseCard
      busy: boolean
    },
) {
  const [reason, setReason] = useState('')
  const [issueNumber, setIssueNumber] = useState('')
  const publication = props.card.publication
  const target = props.card.publicationTarget
  const decide = (decision: 'approved' | 'rejected' | 'deferred') => {
    void props.recordRequirementDecision({
      caseId: String(props.card.case.id),
      revisionId: String(props.card.headRevision.id),
      decision,
      reason: reason.trim(),
    })
  }
  return (
    <section className={css.commandCard} aria-label={props.t('case.list')}>
      <h2>{props.card.headRevision.title}</h2>
      <span className={css.cardLane} data-lane={props.card.lane}>{props.t(CASE_LANE_KEYS[props.card.lane])}</span>
      <p className={css.muted}>{props.card.headRevision.outcome ?? props.card.headRevision.context}</p>
      {!props.card.readiness.ready && <div className={css.attention} role="status">
        <strong>{props.t('case.readiness')}</strong>
        <ul>{props.card.readiness.reasons.map(reason => <li key={reason}>{props.t(READINESS_KEYS[reason])}</li>)}</ul>
      </div>}
      {props.card.requirementDecision === null
        ? <>
          <label><span>{props.t('case.reason')}</span><textarea value={reason} disabled={props.busy} onChange={(event) => { setReason(event.currentTarget.value) }} /></label>
          <div className={css.headerActions}>
            <button type="button" disabled={props.busy || reason.trim() === '' || !props.card.readiness.ready} onClick={() => { decide('approved') }}>{props.t('case.approve')}</button>
            <button type="button" disabled={props.busy || reason.trim() === ''} onClick={() => { decide('deferred') }}>{props.t('case.defer')}</button>
            <button type="button" disabled={props.busy || reason.trim() === ''} onClick={() => { decide('rejected') }}>{props.t('case.reject')}</button>
          </div>
        </>
        : <p className={css.muted}>{props.card.requirementDecision.reason}</p>}
      {target === null
        ? <p className={css.muted}>{props.t('case.noTarget')}</p>
        : <p className={css.muted}>{props.t('case.target', { target: `${target.owner}/${target.name}` })}</p>}
      {publication === null && props.card.requirementDecision?.decision === 'approved' && target !== null && (
        <button type="button" disabled={props.busy} onClick={() => { void props.publishIssue({ caseId: String(props.card.case.id), revisionId: String(props.card.headRevision.id) }) }}>{props.t('case.publish')}</button>
      )}
      {publication?.phase === 'prepared' && <button type="button" disabled={props.busy} onClick={() => { void props.publishIssue({ caseId: String(props.card.case.id), revisionId: String(props.card.headRevision.id) }) }}>{props.t('case.publish')}</button>}
      {publication?.phase === 'prepared' && <p className={css.muted}>{props.t('case.publication.prepared')}</p>}
      {publication?.phase === 'publishing' && <p className={css.muted}>{props.t('case.publication.publishing')}</p>}
      {publication?.phase === 'failed' && <>
        <p className={css.muted}>{props.t('case.publication.failed', { category: publication.failureCategory ?? '' })}</p>
        <button type="button" disabled={props.busy} onClick={() => { void props.publishIssue({ caseId: String(props.card.case.id), revisionId: String(props.card.headRevision.id) }) }}>{props.t('case.publish')}</button>
      </>}
      {publication?.phase === 'published' && publication.issue !== null && <a href={publication.issue.url} target="_blank" rel="noreferrer">{props.t('case.publication.published', { number: publication.issue.issueNumber })}</a>}
      {publication?.phase === 'unknown' && <>
        <p className={css.muted}>{props.t('case.publication.unknown')}</p>
        <label><span>{props.t('case.issueNumber')}</span><input inputMode="numeric" value={issueNumber} disabled={props.busy} onChange={(event) => { setIssueNumber(event.currentTarget.value) }} /></label>
        <button type="button" disabled={props.busy || !/^\d+$/u.test(issueNumber)} onClick={() => { void props.resolvePublication({ publicationId: String(publication.id), resolution: 'confirm-published', issueNumber: Number(issueNumber) }) }}>{props.t('case.confirmPublished')}</button>
      </>}
    </section>
  )
}

function PacketForm(props: Pick<DeliveryWorkspaceProps, 'createPacket' | 't'> & {
  contracts: readonly DeliveryWorkbenchCard['contractRevision'][]
  busy: boolean
}) {
  // PacketForm is mounted only when the caller has at least one eligible Contract.
  const [firstContract] = props.contracts as readonly [DeliveryWorkbenchCard['contractRevision'], ...DeliveryWorkbenchCard['contractRevision'][]]
  const [contractId, setContractId] = useState<string>(firstContract.id)
  const contract = props.contracts.find(candidate => candidate.id === contractId) ?? firstContract
  const [objective, setObjective] = useState(contract.outcome ?? '')
  const [allowed, setAllowed] = useState('')
  const [forbidden, setForbidden] = useState('')
  const [stop, setStop] = useState('')
  const [executor, setExecutor] = useState('codex')
  const [clauseIds, setClauseIds] = useState<string[]>(
    () => contract.acceptanceClauses.map(clause => String(clause.id)),
  )

  useEffect(() => {
    const next = props.contracts.find(candidate => candidate.id === contractId) ?? firstContract
    if (next.id !== contractId) setContractId(next.id)
    setObjective(next.outcome ?? '')
    setClauseIds(next.acceptanceClauses.map(clause => String(clause.id)))
  }, [contractId, props.contracts])

  const allowedPaths = pathRules(allowed)
  const forbiddenPaths = pathRules(forbidden)
  const ready = objective.trim() !== ''
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
      <>
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
                {candidate.title}
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
      </>
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
  const caseCards = snapshot?.cases ?? []
  const [lane, setLane] = useState<DeliveryLane | 'all'>('all')
  const [selectedCaseId, setSelectedCaseId] = useState(caseCards[0]?.case.id ?? '')
  const [selectedId, setSelectedId] = useState(snapshot?.cards[0]?.packet.id ?? '')
  const cardRefs = useRef(new Map<string, HTMLButtonElement>())

  const selectedCase = caseCards.find(card => card.case.id === selectedCaseId) ?? caseCards[0] ?? null
  const packetCards = selectedCase?.packets ?? snapshot?.cards ?? []
  const counts = useMemo(() => Object.fromEntries(LANES.map(candidate => [
    candidate,
    packetCards.filter(card => card.lane === candidate).length,
  ])) as Record<DeliveryLane, number>, [packetCards])
  const cards = packetCards.filter(card => lane === 'all' || card.lane === lane)
  const selected = cards.find(card => card.packet.id === selectedId) ?? cards[0] ?? null
  const packetContracts = caseCards.length === 0
    ? snapshot?.contractsWithoutPacket ?? []
    : selectedCase?.requirementDecision?.decision === 'approved' && selectedCase.packets.length === 0
      ? [selectedCase.headRevision]
      : []
  const busy = state.pending !== null || state.status === 'loading'

  useEffect(() => {
    if (selectedCase === null || selectedCase.case.id === selectedCaseId) return
    setSelectedCaseId(selectedCase.case.id)
  }, [selectedCase, selectedCaseId])

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
          {caseCards.length === 0
            ? <CaseCaptureForm createCase={props.createCase} t={props.t} busy={busy} />
            : <section className={css.caseShell}>
              <section className={css.caseList} aria-label={props.t('case.list')}>
                <div className={css.ledgerHead}>
                  <h2>{props.t('case.list')}</h2>
                  <span>{props.t('case.count', { count: caseCards.length })}</span>
                </div>
                {caseCards.map(card => <button
                  type="button"
                  key={card.case.id}
                  aria-pressed={selectedCase?.case.id === card.case.id}
                  data-active={selectedCase?.case.id === card.case.id || undefined}
                  onClick={() => { setSelectedCaseId(card.case.id) }}
                >
                  <span className={css.cardLane} data-lane={card.lane}>{props.t(CASE_LANE_KEYS[card.lane])}</span>
                  <strong>{card.headRevision.title}</strong>
                </button>)}
                <details>
                  <summary>{props.t('case.createTitle')}</summary>
                  <CaseCaptureForm createCase={props.createCase} t={props.t} busy={busy} />
                </details>
              </section>
              {selectedCase !== null && <div className={css.caseActions}>
                <CaseAuthority {...props} card={selectedCase} busy={busy} />
                <details>
                  <summary>{props.t('case.reviseTitle')}</summary>
                  <CaseForm card={selectedCase} reviseCase={props.reviseCase} t={props.t} busy={busy} />
                </details>
              </div>}
            </section>}
          <section className={css.commandShelf}>
            {packetContracts.length > 0 && <PacketForm
              contracts={packetContracts}
              createPacket={props.createPacket}
              t={props.t}
              busy={busy}
            />}
            <details className={css.secondaryAction}>
              <summary>{props.t('import.title')}</summary>
              <ImportForm importIssue={props.importIssue} t={props.t} busy={busy} />
            </details>
          </section>
          {caseCards.length === 0 && (
            <p className={css.empty}>{props.t('view.empty')}</p>
          )}
          {packetCards.length > 0 && <><nav className={css.trace} aria-label={props.t('ledger.title')}>
            <button type="button" aria-pressed={lane === 'all'} data-active={lane === 'all' || undefined} onClick={() => { setLane('all') }}>
              {props.t('lane.all')} {packetCards.length}
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
                      <span>{card.contractRevision.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            {selected === null
              ? <aside className={css.detailPane} aria-label={props.t('detail.title')}><p className={css.empty}>{props.t('detail.select')}</p></aside>
              : <PacketDetail {...props} card={selected} runtime={state} />}
          </section></>}
        </>
      )}
    </main>
  )
}

import { randomUUID } from 'node:crypto'
import type { Browser } from '@changanhua/dsh-browser'
import { WorkId, type AttemptOutcome, type OperatorWorkQueue, type WorkHandler, type WorkView } from '@changanhua/dsh-task-queue'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { acceptFailure, acceptSample, acknowledgeNotice, createRecord, hasNotificationCapacity, selectDue } from './records.ts'
import { MonitorError, observationGrant, readSample } from './sample.ts'
import { CreateMonitorSchema, MonitorCheckSchema, MonitorRecordSchema } from './schemas.ts'
import type { CreateMonitor, MonitorCheck, MonitorRecord } from './types.ts'

type Outcome = AttemptOutcome<'browser.monitor.check@1'>
type Table = KvTable<string, MonitorRecord>
const settled = () => {}

/** Bounds cover retained definitions and each finite read, independently of Queue's shared concurrency. */
export interface EngineOptions { readonly maxMonitors: number; readonly checkTimeoutMs: number; readonly now?: () => number }

/** Durable plan coordinator. The Domain owner closes storage only after this engine has drained. */
export class MonitorEngine {
  readonly handler: WorkHandler<'browser.monitor.check@1'>
  private readonly now: () => number
  private chain: Promise<void> = Promise.resolve()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly controllers = new Map<string, Set<AbortController>>()
  private readonly paused = new Set<string>()
  private readonly transitions = new Map<string, symbol>()
  private stopping = false
  private faulted = false
  private ticking: Promise<void> | undefined

  constructor(private readonly table: Table, private readonly browser: Pick<Browser, 'instances' | 'observe'>,
    private readonly queue: OperatorWorkQueue, private readonly options: EngineOptions) {
    this.now = options.now ?? Date.now
    for (const [key, record] of table.entries()) {
      if (key !== record.id || !MonitorRecordSchema.safeParse(record).success) throw new MonitorError('invalid_monitor_store')
    }
    this.handler = {
      kind: 'browser.monitor.check@1',
      resolveAdmission: (input) => {
        const check = MonitorCheckSchema.parse(input)
        const record = this.current(check)
        return Promise.resolve({ ...check, installationId: record.installationId })
      },
      resources: () => [],
      policy: () => ({ maxAttempts: 3 }),
      prepare: (resolved, { signal }) => {
        signal.throwIfAborted()
        const record = this.current(resolved)
        if (record.installationId !== resolved.installationId) throw new MonitorError('stale_check')
        return Promise.resolve(resolved)
      },
      start: (check, { signal }) => {
        const controller = new AbortController()
        const controllers = this.controllers.get(check.monitorId) ?? new Set<AbortController>()
        this.controllers.set(check.monitorId, controllers)
        controllers.add(controller)
        const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(this.options.checkTimeoutMs)])
        const done = this.track(this.run(check, combined)).finally(() => {
          controllers.delete(controller)
          if (!controllers.size) this.controllers.delete(check.monitorId)
        })
        return { done, cancel: async () => { controller.abort(); await done } }
      },
    }
  }

  /** Detached records are available only while the activation is healthy. */
  list(installationId: string): MonitorRecord[] {
    this.assertOpen()
    return [...this.table.entries()].map(([, record]) => record).filter(record => record.installationId === installationId)
      .map(record => structuredClone(record))
  }

  /** Persist an explicit plan before the first admission. Repeated request ids require identical intent. */
  create(input: CreateMonitor, authorize: () => void = settled): Promise<MonitorRecord> {
    authorize()
    this.assertOpen()
    const request = CreateMonitorSchema.parse(input)
    return this.track((async () => {
      const candidate = createRecord(request, 1, this.now())
      const known = await this.serial(() => {
        this.assertOpen()
        authorize()
        const previous = this.table.get(request.requestId)
        if (previous && previous.createDigest !== candidate.createDigest) throw new MonitorError('request_conflict')
        return Promise.resolve(previous && structuredClone(previous))
      })
      if (known) return known
      const grant = await observationGrant(this.browser, request.installationId, request.url)
      return this.serial(async () => {
        this.assertOpen()
        authorize()
        candidate.grantEpoch = grant.grantEpoch
        const previous = this.table.get(request.requestId)
        if (previous) {
          if (previous.createDigest !== candidate.createDigest) throw new MonitorError('request_conflict')
          return structuredClone(previous)
        }
        if (this.table.size >= this.options.maxMonitors) throw new MonitorError('monitor_capacity')
        await this.persist(() => this.table.put(candidate.id, MonitorRecordSchema.parse(candidate)))
        return structuredClone(candidate)
      })
    })())
  }

  /** Fence running reads synchronously; their eventual result cannot replace the paused revision. */
  pause(id: string, installationId: string, expectedRevision?: string, authorize: () => void = settled): Promise<MonitorRecord> {
    authorize()
    const prior = this.owned(id, installationId)
    if (expectedRevision !== undefined && prior.revision !== expectedRevision) throw new MonitorError('control_superseded')
    this.transitions.set(id, Symbol('pause'))
    this.paused.add(id)
    for (const controller of this.controllers.get(id) ?? []) controller.abort()
    return this.track((async () => {
      const result = await this.change(id, (record) => {
        authorize()
        if (expectedRevision !== undefined && record.revision !== expectedRevision) throw new MonitorError('control_superseded')
        return { ...record, enabled: false, revision: randomUUID(), pending: null }
      })
      if (prior.pending?.workId) await this.queue.cancel(WorkId(prior.pending.workId))
      return structuredClone(result)
    })())
  }

  /** A new explicit resume binds the plan to current authority; old work remains stale. */
  resume(id: string, installationId: string, expectedRevision?: string, authorize: () => void = settled): Promise<MonitorRecord> {
    authorize()
    const prior = this.owned(id, installationId)
    if (expectedRevision !== undefined && prior.revision !== expectedRevision) throw new MonitorError('control_superseded')
    const transition = Symbol('resume')
    this.transitions.set(id, transition)
    return this.track((async () => {
      const grant = await observationGrant(this.browser, installationId, prior.url)
      const result = await this.serial(async () => {
        this.assertOpen()
        authorize()
        if (this.transitions.get(id) !== transition) throw new MonitorError('control_superseded')
        if (expectedRevision !== undefined && this.table.get(id)?.revision !== expectedRevision) throw new MonitorError('control_superseded')
        for (const controller of this.controllers.get(id) ?? []) controller.abort()
        const now = this.now()
        const updated = await this.persist(() => this.table.update(id, record => MonitorRecordSchema.parse({ ...record,
          enabled: true, grantEpoch: grant.grantEpoch, revision: randomUUID(), pending: null,
          anchorAt: now, nextDue: now, lastCompletedSlot: null })))
        if (this.transitions.get(id) === transition) this.paused.delete(id)
        return updated
      })
      if (prior.pending?.workId) await this.queue.cancel(WorkId(prior.pending.workId))
      return structuredClone(result)
    })())
  }

  /** Remove a delivered notification only by its durable id. */
  acknowledge(id: string, installationId: string, noticeId: string, authorize: () => void = settled): Promise<void> {
    authorize()
    this.owned(id, installationId)
    return this.track(this.change(id, (record) => { authorize(); return acknowledgeNotice(record, noticeId) }).then(settled))
  }

  /** Coalesce timer callbacks. Each selected slot is durable before its idempotent Queue admission. */
  tick(): Promise<void> {
    this.assertOpen()
    this.ticking ??= this.track(this.scan()).finally(() => { this.ticking = undefined })
    return this.ticking
  }

  /** Stop admission, abort reads, then drain every owned operation before storage is released. */
  async close(): Promise<void> {
    this.stopping = true
    for (const controllers of this.controllers.values()) for (const controller of controllers) controller.abort()
    await Promise.allSettled([...this.operations])
    await this.chain
  }

  private async scan(): Promise<void> {
    for (const id of this.table.keys()) {
      this.assertOpen()
      let prior = this.table.get(id)
      if (prior?.settlement) {
        await this.settle(prior)
        prior = this.table.get(id)
      }
      if (prior?.settlement) continue
      if (this.paused.has(id)) continue
      if (!prior?.enabled) continue
      if (prior.pending) { await this.reconcile(prior); continue }
      if (prior.nextDue > this.now() || !hasNotificationCapacity(prior)) continue
      const selected = await this.change(id, record => selectDue(record, this.now()).record)
      if (selected.pending) await this.admit(selected)
    }
  }

  private async admit(record: MonitorRecord): Promise<void> {
    const pending = record.pending
    if (!pending) return
    const check = { monitorId: record.id, revision: pending.revision, slot: pending.slot }
    try {
      this.current(check)
      const workId = await this.queue.enqueue({ kind: 'browser.monitor.check@1', title: record.title, input: check,
        idempotencyKey: `browser-monitor:${record.id}:${check.revision}:${check.slot}` })
      const saved = await this.change(record.id, current => this.matches(current, check) && current.pending
        ? { ...current, pending: { ...current.pending, workId } } : this.accepted(current, check) && current.settlement
          ? { ...current, settlement: { ...current.settlement, workId } } : current)
      if (!this.matches(saved, check) && !this.recorded(saved, check)) await this.queue.cancel(workId)
    } catch (error) {
      if (!this.available(check)) return
      await this.recordFailure(check, error instanceof MonitorError ? error.code : 'queue_unavailable')
    }
  }

  private async reconcile(record: MonitorRecord): Promise<void> {
    const pending = record.pending
    if (!pending) return
    if (!pending.workId) { await this.admit(record); return }
    const check = { monitorId: record.id, revision: pending.revision, slot: pending.slot }
    const workId = WorkId(pending.workId)
    let view
    try { view = this.queue.get(workId) } catch { await this.recordFailure(check, 'queue_record_missing'); return }
    if (!workMatches(view, check)) {
      await this.recordFailure(check, 'queue_record_mismatch')
      return
    }
    if (view.state.status === 'unknown') {
      if (pending.recoveries >= 2) {
        await this.queue.resolveUnknown(workId, { kind: 'confirm-failed', failure: { category: 'monitor_recovery_exhausted',
          message: '有限只读检查无法恢复，请重新启用监控。', sideEffect: 'unknown', retriable: false } })
        await this.recordFailure(check, 'recovery_exhausted')
        return
      }
      await this.change(record.id, current => this.matches(current, check) && current.pending
        ? { ...current, pending: { ...current.pending, recoveries: pending.recoveries + 1 } } : current)
      if (!this.available(check)) return
      // This WorkKind only reads DOM and commits a slot-idempotent record. It cannot replay a browser write.
      await this.queue.resolveUnknown(workId, { kind: 'authorize-retry' })
    } else if (['failed', 'canceled', 'succeeded'].includes(view.state.status)) {
      await this.recordFailure(check, view.state.status === 'canceled' ? 'check_cancelled' : 'check_not_recorded')
    }
  }

  private async settle(record: MonitorRecord): Promise<void> {
    const receipt = record.settlement
    if (!receipt) return
    const check = { monitorId: record.id, revision: receipt.revision, slot: receipt.slot }
    const workId = receipt.workId ? WorkId(receipt.workId) : await this.queue.enqueue({
      kind: 'browser.monitor.check@1', title: record.title, input: check,
      idempotencyKey: `browser-monitor:${record.id}:${check.revision}:${check.slot}`,
    })
    if (!receipt.workId) await this.change(record.id, current => this.accepted(current, check) && current.settlement
      ? { ...current, settlement: { ...current.settlement, workId } } : current)
    const view = this.queue.get(workId)
    if (!workMatches(view, check)) throw new MonitorError('queue_record_mismatch')
    if (view.state.status === 'unknown') {
      if (receipt.recoveries >= 2) {
        await this.queue.resolveUnknown(workId, { kind: 'confirm-failed', failure: {
          category: 'monitor_receipt_unconfirmed', sideEffect: 'not-started', retriable: false,
          message: '检查结果已保存，但执行回执未能恢复。',
        } })
        await this.change(record.id, current => this.accepted(current, check) ? {
          ...current, settlement: null, enabled: false, revision: randomUUID(),
          lastFailure: { code: 'queue_receipt_unconfirmed', message: '检查结果已保存，但执行回执未能恢复，请核对后恢复监控。', at: this.now() },
        } : current)
        return
      }
      await this.change(record.id, current => this.accepted(current, check) && current.settlement
        ? { ...current, settlement: { ...current.settlement, recoveries: current.settlement.recoveries + 1 } } : current)
      this.assertOpen()
      const current = this.table.get(record.id)
      if (!current || !this.accepted(current, check)) return
      // The result is already durable. The retry settles Queue from that fact without another browser read.
      await this.queue.resolveUnknown(workId, { kind: 'authorize-retry' })
    } else if (['succeeded', 'failed', 'canceled'].includes(view.state.status)) {
      await this.change(record.id, current => this.accepted(current, check) ? { ...current, settlement: null } : current)
    }
  }

  private async run(check: MonitorCheck, signal: AbortSignal): Promise<Outcome> {
    try {
      signal.throwIfAborted()
      const record = this.current(check)
      if (this.recorded(record, check)) return this.cachedOutcome(record, check)
      const grant = await observationGrant(this.browser, record.installationId, record.url)
      this.current(check)
      signal.throwIfAborted()
      if (grant.grantEpoch !== record.grantEpoch) throw new MonitorError('authorization_changed')
      if (!grant.online) throw new MonitorError('browser_unavailable')
      const sample = await readSample(this.browser, record, signal, this.now)
      signal.throwIfAborted()
      const accepted = await this.change(record.id, current => this.available(check)
        ? acceptSample(current, check, sample, this.now()) : current)
      if (accepted.lastCompletedSlot !== check.slot) return { status: 'canceled' }
      return this.success(check, 'sampled')
    } catch (error) {
      if (this.storageFailed()) return { status: 'unknown', failure: {
        category: 'monitor_storage_failed', message: '检查结果未能确认持久化。', sideEffect: 'unknown', retriable: false } }
      if (!this.available(check)) return { status: 'canceled' }
      const code = signal.aborted ? 'check_interrupted' : error instanceof MonitorError ? error.code : 'check_failed'
      try { await this.recordFailure(check, code) } catch { return { status: 'unknown', failure: {
        category: 'monitor_storage_failed', message: '检查结果未能确认持久化。', sideEffect: 'unknown', retriable: false } } }
      return { status: 'failed', failure: { category: code, message: '本次浏览器检查未完成。', sideEffect: 'not-started', retriable: false } }
    }
  }

  private success(check: MonitorCheck, outcome: 'sampled' | 'already-recorded'): Outcome {
    return { status: 'succeeded', output: { monitorId: check.monitorId, slot: check.slot, outcome } }
  }

  private accepted(record: MonitorRecord, check: MonitorCheck): boolean {
    return record.settlement?.revision === check.revision && record.settlement.slot === check.slot
  }
  private recorded(record: MonitorRecord, check: MonitorCheck): boolean {
    return this.accepted(record, check) || record.revision === check.revision && record.lastCompletedSlot === check.slot
  }
  private cachedOutcome(record: MonitorRecord, check: MonitorCheck): Outcome {
    const failure = this.accepted(record, check) ? record.settlement?.failure : record.lastFailure
    return failure ? { status: 'failed', failure: { category: failure.code, message: '本次浏览器检查未完成。',
      sideEffect: 'not-started', retriable: false } } : this.success(check, 'already-recorded')
  }

  private async recordFailure(check: MonitorCheck, code: string): Promise<void> {
    await this.change(check.monitorId, (record) => {
      if (!this.available(check)) return record
      const next = acceptFailure(record, check, { code, message: failureMessage(code), at: this.now() }, this.now())
      return ['authorization_changed', 'observation_not_authorized', 'recovery_exhausted'].includes(code)
        ? { ...next, enabled: false, revision: randomUUID(), pending: null } : next
    })
  }

  private matches(record: MonitorRecord, check: MonitorCheck): boolean {
    return record.enabled && record.revision === check.revision && record.pending?.revision === check.revision
      && record.pending.slot === check.slot && !this.paused.has(record.id)
  }
  private available(check: MonitorCheck): boolean {
    const record = this.table.get(check.monitorId)
    return !this.stopping && !this.faulted && record !== undefined && this.matches(record, check)
  }
  private current(check: MonitorCheck): MonitorRecord {
    this.assertOpen()
    const record = this.table.get(check.monitorId)
    if (record && this.recorded(record, check)) return record
    if (!record || !this.matches(record, check)) throw new MonitorError('stale_check')
    return record
  }
  private owned(id: string, installationId: string): MonitorRecord {
    this.assertOpen()
    const record = this.table.get(id)
    if (!record || record.installationId !== installationId) throw new MonitorError('monitor_not_found')
    return record
  }
  private assertOpen(): void {
    if (this.stopping || this.faulted) throw new MonitorError(this.faulted ? 'monitor_storage_failed' : 'monitor_closed')
  }
  private storageFailed(): boolean { return this.faulted }
  private change(id: string, update: (record: MonitorRecord) => MonitorRecord): Promise<MonitorRecord> {
    return this.serial(async () => {
      this.assertOpen()
      const current = this.table.get(id)
      if (!current) throw new MonitorError('monitor_not_found')
      const next = MonitorRecordSchema.parse(update(current))
      return this.persist(() => this.table.update(id, () => next))
    })
  }
  private async persist<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch {
      this.faulted = true
      for (const controllers of this.controllers.values()) for (const controller of controllers) controller.abort()
      throw new MonitorError('monitor_storage_failed')
    }
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(operation)
    this.chain = result.then(settled, settled)
    return result
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.operations.add(promise)
    void promise.then(() => this.operations.delete(promise), () => this.operations.delete(promise))
    return promise
  }
}

function failureMessage(code: string): string {
  switch (code) {
    case 'authorization_changed': case 'observation_not_authorized': return '监控授权已变化，请重新授权后恢复。'
    case 'target_unavailable': return '未找到监控网页，请在已连接的浏览器中打开原网址。'
    case 'target_ambiguous': return '有多个标签页对应监控网址，无法确定检查目标。'
    case 'observation_truncated': return '网页正文超过检查上限，本次未作变化比较。'
    case 'browser_unavailable': return '浏览器离线或未返回可用内容，本次检查未完成。'
    default: return '本次检查未完成，已有比较结果保持不变。'
  }
}

function isMonitorWork(kind: string): boolean { return kind === 'browser.monitor.check@1' }

function workMatches(view: WorkView, check: MonitorCheck): boolean {
  const intent = MonitorCheckSchema.safeParse(view.work.intent)
  return isMonitorWork(view.work.kind) && intent.success && intent.data.monitorId === check.monitorId
    && intent.data.revision === check.revision && intent.data.slot === check.slot
}

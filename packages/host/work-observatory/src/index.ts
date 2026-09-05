/** Host-authoritative Work Observatory accounting and Remote projection. */

import { Context, Service } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import s from '@deepseek-ai/schemastery'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { MAX_QUERY_SPAN_MS, summarizeIntervals, type WorkInterval } from './projection.ts'
import { workObservatoryDomainSpec } from './spec.ts'
import type {
  WorkObservatoryAgentStep,
  WorkObservatoryClientSample,
  WorkObservatoryClientState,
} from './spec.ts'
import type {
  ClientObservation,
  WorkObservatoryRange,
  WorkObservatoryRangeRequest,
  WorkObservatorySessionSummary,
} from './types.ts'

export type * from './types.ts'
export {
  workObservatoryAgentStep,
  workObservatoryClientSample,
  workObservatoryClientState,
  workObservatoryDomainSpec,
} from './spec.ts'
export { MAX_QUERY_SPAN_MS, mergeIntervals, summarizeIntervals } from './projection.ts'

/** Deployment bounds for durable activity evidence. */
export interface Config {
  /** Whole days to retain browser transitions and completed Session steps. */
  readonly retentionDays?: number
  /** Maximum browser document identities retained concurrently. */
  readonly maxClients?: number
  /** Maximum retained transition and step rows one range read may consume. */
  readonly maxQueryRecords?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workObservatory: WorkObservatory
  }
}

const DAY_MS = 24 * 60 * 60 * 1_000
const PRUNE_INTERVAL_MS = 60 * 60 * 1_000
const DEFAULT_RETENTION_DAYS = 90
const DEFAULT_MAX_CLIENTS = 128
const DEFAULT_MAX_QUERY_RECORDS = 10_000
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

interface SessionIntervals {
  projectPath?: string
  human: WorkInterval[]
  agent: WorkInterval[]
}

function positiveInteger(name: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new TypeError(`work-observatory: ${name} must be a positive safe integer`)
  }
  return resolved
}

function sampleKey(clientId: string, seq: number): string {
  return recordKey('sample', clientId, String(seq))
}

function stepKey(sessionId: SessionId, turn: number, step: number): string {
  return recordKey('step', String(sessionId), String(turn), String(step))
}

/** Stable path-safe key for per-record storage backends. */
function recordKey(kind: string, ...parts: string[]): string {
  return `${kind}_${createHash('sha256').update(parts.join('\0')).digest('hex')}`
}

function sessionPath(session: Session | undefined): string | undefined {
  return session?.header.cwd
}

function validateObservation(observation: ClientObservation): void {
  if (!CLIENT_ID_RE.test(observation.clientId)) {
    throw new TypeError('work-observatory: clientId must be 1-128 URL-safe characters')
  }
  if (!Number.isSafeInteger(observation.seq) || observation.seq < 0) {
    throw new TypeError('work-observatory: seq must be a non-negative safe integer')
  }
  if (observation.active && !observation.visible) {
    throw new TypeError('work-observatory: active requires visible')
  }
}

/** Host service owning durable browser samples, Session-step projection, and range reads. */
export class WorkObservatory extends TypertRemoteService {
  static inject = ['storageDomain', 'sessions']

  static Config: s<Config> = s.object({
    retentionDays: s.number().step(1).min(1).default(DEFAULT_RETENTION_DAYS),
    maxClients: s.number().step(1).min(1).default(DEFAULT_MAX_CLIENTS),
    maxQueryRecords: s.number().step(1).min(1).default(DEFAULT_MAX_QUERY_RECORDS),
  })

  private readonly retentionMs: number
  private readonly maxClients: number
  private readonly maxQueryRecords: number
  private samples?: KvTable<string, WorkObservatoryClientSample>
  private clients?: KvTable<string, WorkObservatoryClientState>
  private steps?: KvTable<string, WorkObservatoryAgentStep>
  private operationTail: Promise<void> = Promise.resolve()
  private readonly pendingAgentWrites = new Set<Promise<void>>()
  private accepting = true
  private lastPrunedAt = 0

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'workObservatory')
    this.retentionMs = positiveInteger('retentionDays', config.retentionDays, DEFAULT_RETENTION_DAYS) * DAY_MS
    this.maxClients = positiveInteger('maxClients', config.maxClients, DEFAULT_MAX_CLIENTS)
    this.maxQueryRecords = positiveInteger(
      'maxQueryRecords', config.maxQueryRecords, DEFAULT_MAX_QUERY_RECORDS,
    )
  }

  /** Open the storage domain, adopt existing Session history, and subscribe to live events. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workObservatoryDomainSpec)
    this.samples = domain.table('samples')
    this.clients = domain.table('clients')
    this.steps = domain.table('steps')
    this.lastPrunedAt = Date.now()
    await this.prune(this.lastPrunedAt)
    for (const session of this.ctx.sessions.list()) this.adoptSession(session)
    this.ctx.on('session/created', (session) => { this.adoptSession(session) })
    this.ctx.on('session/event', (session, event) => { this.projectAgentEvent(session, event) })
    this.ctx.effect(() => async () => {
      this.accepting = false
      await this.operationTail
      await Promise.all(this.pendingAgentWrites)
      await domain.close()
    }, 'work-observatory.domainClose')
  }

  /**
   * Accept one Host-stamped browser state transition or heartbeat.
   * @param observation - monotonic browser state without a client timestamp.
   * @returns whether the sequence was newer than the last accepted observation.
   */
  @Remote('observeClient')
  observeClient(observation: ClientObservation): Promise<{ readonly accepted: boolean }> {
    validateObservation(observation)
    return this.enqueue(async () => {
      const now = Date.now()
      if (now - this.lastPrunedAt >= PRUNE_INTERVAL_MS) {
        await this.prune(now)
        this.lastPrunedAt = now
      }
      const clients = this.requireClients()
      const previous = clients.get(observation.clientId)
      if (previous !== undefined && observation.seq <= previous.lastSeq) return { accepted: false }
      if (previous === undefined && clients.size >= this.maxClients) {
        await this.prune(now)
        if (clients.size >= this.maxClients) {
          throw new Error(`work-observatory: client limit ${this.maxClients} reached`)
        }
      }
      const session = observation.sessionId === undefined
        ? undefined
        : this.ctx.sessions.get(observation.sessionId)
      const projectPath = sessionPath(session)
      const stateChanged = previous === undefined
        || previous.visible !== observation.visible
        || previous.active !== observation.active
        || previous.sessionId !== observation.sessionId
        || previous.projectPath !== projectPath
      const sample: WorkObservatoryClientSample = {
        clientId: observation.clientId,
        seq: observation.seq,
        observedAt: now,
        visible: observation.visible,
        active: observation.active,
        ...(observation.sessionId === undefined ? {} : { sessionId: observation.sessionId }),
        ...(projectPath === undefined ? {} : { projectPath }),
      }
      if (stateChanged) {
        await this.requireSamples().put(sampleKey(observation.clientId, observation.seq), sample)
      }
      await clients.put(observation.clientId, {
        lastSeq: observation.seq,
        lastObservedAt: now,
        stateStartedAt: stateChanged ? now : previous.stateStartedAt,
        visible: observation.visible,
        active: observation.active,
        ...(observation.sessionId === undefined ? {} : { sessionId: observation.sessionId }),
        ...(projectPath === undefined ? {} : { projectPath }),
      })
      return { accepted: true }
    })
  }

  /**
   * Read a bounded range; totals and Session rows derive from the same interval algebra.
   * @param request - finite epoch range and optional canonical project path.
   * @returns normalized timelines, headline totals, and contributing Session rows.
   */
  @Remote('readRange')
  async readRange(request: WorkObservatoryRangeRequest): Promise<WorkObservatoryRange> {
    if (!Number.isFinite(request.from) || !Number.isFinite(request.to) || request.from >= request.to) {
      throw new Error('Work Observatory range requires finite from < to')
    }
    if (request.to - request.from > MAX_QUERY_SPAN_MS) {
      throw new Error('Work Observatory range cannot exceed 31 days')
    }
    await this.operationTail
    const samples = [...this.requireSamples().entries()].map(([, sample]) => sample)
    const steps = [...this.requireSteps().entries()].map(([, step]) => step)
    if (samples.length + steps.length > this.maxQueryRecords) {
      throw new Error(`work-observatory: query record limit ${this.maxQueryRecords} exceeded`)
    }
    const humanActive: WorkInterval[] = []
    const pageVisible: WorkInterval[] = []
    const agentRunning: WorkInterval[] = []
    const sessions = new Map<SessionId, SessionIntervals>()
    for (const group of this.groupSamples(samples).values()) {
      for (let index = 0; index + 1 < group.length; index += 1) {
        const current = group[index]
        const next = group[index + 1]
        if (current === undefined || next === undefined) continue
        if (current.projectPath !== request.projectPath && request.projectPath !== undefined) continue
        const interval = { start: current.observedAt, end: next.observedAt }
        if (current.visible) pageVisible.push(interval)
        if (current.active) {
          humanActive.push(interval)
          if (current.sessionId !== undefined) {
            const row = this.sessionIntervals(sessions, current.sessionId, current.projectPath)
            row.human.push(interval)
          }
        }
      }
    }
    for (const [, state] of this.requireClients().entries()) {
      if (state.projectPath !== request.projectPath && request.projectPath !== undefined) continue
      const interval = { start: state.stateStartedAt, end: state.lastObservedAt }
      if (state.visible) pageVisible.push(interval)
      if (state.active) {
        humanActive.push(interval)
        if (state.sessionId !== undefined) {
          this.sessionIntervals(sessions, state.sessionId, state.projectPath).human.push(interval)
        }
      }
    }
    const now = Date.now()
    for (const step of steps) {
      if (step.projectPath !== request.projectPath && request.projectPath !== undefined) continue
      const interval = { start: step.startedAt, end: step.endedAt ?? Math.min(now, request.to) }
      agentRunning.push(interval)
      this.sessionIntervals(sessions, step.sessionId, step.projectPath).agent.push(interval)
    }
    const projection = summarizeIntervals({
      from: request.from, to: request.to, humanActive, pageVisible, agentRunning,
    })
    const sessionRows: WorkObservatorySessionSummary[] = []
    for (const [sessionId, values] of sessions) {
      const sessionProjection = summarizeIntervals({
        from: request.from,
        to: request.to,
        humanActive: values.human,
        pageVisible: [],
        agentRunning: values.agent,
      })
      if (sessionProjection.summary.humanActiveMs === 0 && sessionProjection.summary.agentRunningMs === 0) continue
      sessionRows.push({
        sessionId,
        ...(values.projectPath === undefined ? {} : { projectPath: values.projectPath }),
        humanActiveMs: sessionProjection.summary.humanActiveMs,
        agentRunningMs: sessionProjection.summary.agentRunningMs,
        togetherMs: sessionProjection.summary.togetherMs,
      })
    }
    sessionRows.sort((left, right) => String(left.sessionId).localeCompare(String(right.sessionId)))
    return {
      from: request.from,
      to: request.to,
      ...(request.projectPath === undefined ? {} : { projectPath: request.projectPath }),
      ...projection,
      sessions: sessionRows,
    }
  }

  private groupSamples(
    samples: readonly WorkObservatoryClientSample[],
  ): Map<string, WorkObservatoryClientSample[]> {
    const groups = new Map<string, WorkObservatoryClientSample[]>()
    for (const sample of samples) {
      const group = groups.get(sample.clientId)
      if (group === undefined) groups.set(sample.clientId, [sample])
      else group.push(sample)
    }
    for (const group of groups.values()) {
      group.sort((left, right) => left.observedAt - right.observedAt || left.seq - right.seq)
    }
    return groups
  }

  private sessionIntervals(
    rows: Map<SessionId, SessionIntervals>,
    sessionId: SessionId,
    projectPath: string | undefined,
  ): SessionIntervals {
    let row = rows.get(sessionId)
    if (row === undefined) {
      row = { ...(projectPath === undefined ? {} : { projectPath }), human: [], agent: [] }
      rows.set(sessionId, row)
    }
    return row
  }

  private adoptSession(session: Session): void {
    for (const event of session.events) this.projectAgentEvent(session, event)
  }

  private projectAgentEvent(session: Session, event: SessionEvent): void {
    if (event.type !== 'step/start' && event.type !== 'step/end') return
    const write = this.enqueue(() => this.recordAgentEvent(session, event))
    this.pendingAgentWrites.add(write)
    void write.finally(() => { this.pendingAgentWrites.delete(write) }).catch((error: unknown) => {
      this.ctx.logger.warn(`work-observatory: Agent step projection failed: ${String(error)}`)
    })
  }

  private async recordAgentEvent(
    session: Session,
    event: SessionEvent<'step/start' | 'step/end'>,
  ): Promise<void> {
    const table = this.requireSteps()
    const key = stepKey(session.id, event.data.turn, event.data.step)
    if (event.type === 'step/start') {
      await table.put(key, {
        sessionId: session.id,
        turn: event.data.turn,
        step: event.data.step,
        startedAt: event.time,
        ...(sessionPath(session) === undefined ? {} : { projectPath: sessionPath(session) }),
      })
      return
    }
    if (table.get(key) === undefined) return
    await table.update(key, current => ({ ...current, endedAt: event.time }))
  }

  private async prune(now: number): Promise<void> {
    const cutoff = now - this.retentionMs
    const samples = this.requireSamples()
    const grouped = this.groupSamples([...samples.entries()].map(([, sample]) => sample))
    for (const group of grouped.values()) {
      const old = group.filter(sample => sample.observedAt < cutoff)
      const hasRecentTransition = group.some(sample => sample.observedAt >= cutoff)
      const removable = hasRecentTransition ? old.slice(0, -1) : old
      for (const sample of removable) {
        await samples.delete(sampleKey(sample.clientId, sample.seq))
      }
    }
    for (const [key, step] of this.requireSteps().entries()) {
      if (step.endedAt !== undefined && step.endedAt < cutoff) await this.requireSteps().delete(key)
    }
    for (const [clientId, state] of this.requireClients().entries()) {
      if (state.lastObservedAt < cutoff) await this.requireClients().delete(clientId)
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new Error('work-observatory is closing'))
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private requireSamples(): KvTable<string, WorkObservatoryClientSample> {
    if (this.samples === undefined) throw new Error('work-observatory is not ready')
    return this.samples
  }

  private requireClients(): KvTable<string, WorkObservatoryClientState> {
    if (this.clients === undefined) throw new Error('work-observatory is not ready')
    return this.clients
  }

  private requireSteps(): KvTable<string, WorkObservatoryAgentStep> {
    if (this.steps === undefined) throw new Error('work-observatory is not ready')
    return this.steps
  }
}

export default WorkObservatory

/** Run-bound control logic shared by the Host route and its tests. */

export interface ControlSessionEvent {
  readonly seq: number
  readonly type: string
  readonly [key: string]: unknown
}

export interface ControlSessionDependencies {
  create(request: {
    readonly cwd?: string
    readonly sessionId?: string
    readonly agentPreset?: string
  }): Promise<{ readonly sessionId: string; readonly agentPreset?: string }>
  prompt(request: {
    readonly requestId: string
    readonly sessionId: string
    readonly mode: 'queue' | 'steer'
    readonly content: readonly [{ readonly type: 'text'; readonly text: string }]
  }, signal: AbortSignal): Promise<{ readonly accepted: true }>
  inspect(sessionId: string, signal?: AbortSignal): Promise<{
    readonly meta: Readonly<Record<string, unknown>>
    readonly events: readonly ControlSessionEvent[]
  }>
  getAgent(sessionId: string): {
    readonly status: 'idle' | 'running'
    whenIdle(): Promise<void>
  } | undefined
}

export interface DshControlPlaneOptions {
  readonly runId: string
  readonly sessions: ControlSessionDependencies
  readonly browser?: ControlBrowserDependencies
  readonly cordis?: ControlCordisDependencies
  readonly maxWriteReceipts?: number
}

export interface ControlBrowserDependencies {
  instances(): Promise<readonly Readonly<Record<string, unknown>>[]>
  execute(operation: {
    readonly sessionId: string
    readonly installationId: string
    readonly action: Readonly<{ readonly kind: string; readonly [key: string]: unknown }>
  }, signal: AbortSignal): Promise<Readonly<Record<string, unknown>>>
}

export interface ControlCordisDependencies {
  inventory(): readonly Readonly<Record<string, unknown>>[]
}

export interface ControlRequest {
  readonly runId: string
  readonly requestId: string
  readonly method:
    | 'session_open'
    | 'session_prompt'
    | 'session_wait'
    | 'session_events'
    | 'session_observe'
    | 'cordis_inspect'
    | 'browser_instances'
    | 'browser_tabs'
    | 'browser_snapshot'
    | 'browser_entry_inspect'
    | 'evidence_export'
  readonly params: Readonly<Record<string, unknown>>
}

interface CachedWrite {
  readonly fingerprint: string
  readonly result: Promise<unknown>
}

/** A single connector run may claim exactly one Session. */
export class DshControlPlane {
  private readonly writes = new Map<string, CachedWrite>()
  private sessionId: string | undefined
  private installationId: string | undefined
  private visibleInstallations = new Set<string>()
  private visibleTabs = new Set<number>()
  private latestSnapshot: Readonly<Record<string, unknown>> | undefined
  private latestPage: Readonly<Record<string, unknown>> | undefined
  private writeCount = 0
  private waitCount = 0
  private readCount = 0

  constructor(private readonly options: DshControlPlaneOptions) {}

  /** Dispatch one authenticated, run-bound operation. */
  async handle(request: ControlRequest, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    if (request.runId !== this.options.runId) {
      return Promise.reject(new Error('runId does not match this control run'))
    }
    switch (request.method) {
      case 'session_open':
      case 'session_prompt':
        return await this.idempotentWrite(request, signal)
      case 'session_wait':
        this.waitCount++
        return await this.sessionWait(request.params, signal)
      case 'session_events':
        this.readCount++
        return await this.sessionEvents(request.params, signal)
      case 'session_observe':
        this.readCount++
        return await this.sessionObserve(request.params, signal)
      case 'cordis_inspect':
        this.readCount++
        return this.cordisInspect(request.params)
      case 'browser_instances':
        this.readCount++
        return await this.browserInstances(request.params)
      case 'browser_tabs':
        this.readCount++
        return await this.browserTabs(request.params, signal)
      case 'browser_snapshot':
        this.readCount++
        return await this.browserSnapshot(request.params, signal)
      case 'browser_entry_inspect':
        this.readCount++
        return await this.browserEntryInspect(request.params, signal)
      case 'evidence_export':
        this.readCount++
        return await this.evidenceExport(request.params, signal)
    }
  }

  private idempotentWrite(request: ControlRequest, signal: AbortSignal): Promise<unknown> {
    const fingerprint = JSON.stringify({ method: request.method, params: request.params })
    const existing = this.writes.get(request.requestId)
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new Error('requestId was already used for a different write'))
      }
      return existing.result
    }
    if (this.writes.size >= (this.options.maxWriteReceipts ?? 256)) {
      return Promise.reject(new Error('write receipt capacity is exhausted'))
    }
    const result = request.method === 'session_open'
      ? this.open(request.params)
      : this.prompt(request.requestId, request.params, signal)
    this.writeCount++
    this.writes.set(request.requestId, { fingerprint, result })
    return result
  }

  private async open(params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const requested = optionalString(params.sessionId, 'sessionId')
    if (this.sessionId !== undefined && requested !== undefined && requested !== this.sessionId) {
      throw new Error('session is not bound to this control run')
    }
    const created = await this.options.sessions.create({
      ...optionalString(params.cwd, 'cwd') === undefined ? {} : { cwd: params.cwd as string },
      ...requested === undefined ? {} : { sessionId: requested },
      ...optionalString(params.agentPreset, 'agentPreset') === undefined
        ? {}
        : { agentPreset: params.agentPreset as string },
    })
    if (this.sessionId !== undefined && created.sessionId !== this.sessionId) {
      throw new Error('session is not bound to this control run')
    }
    this.sessionId = created.sessionId
    return { ...created, runId: this.options.runId }
  }

  private prompt(
    requestId: string,
    params: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<{ readonly accepted: true }> {
    const sessionId = requiredString(params.sessionId, 'sessionId')
    this.assertSession(sessionId)
    const text = requiredString(params.text, 'text')
    const mode = params.mode ?? 'queue'
    if (mode !== 'queue' && mode !== 'steer') throw new Error('mode must be queue or steer')
    return this.options.sessions.prompt({
      requestId,
      sessionId,
      mode,
      content: [{ type: 'text', text }],
    }, signal)
  }

  private async sessionEvents(
    params: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const sessionId = requiredString(params.sessionId, 'sessionId')
    this.assertSession(sessionId)
    const inspected = await this.options.sessions.inspect(sessionId, signal)
    const afterSeq = optionalInteger(params.afterSeq, 'afterSeq', -1)
    const limit = optionalInteger(params.limit, 'limit', 200, 1, 1000)
    const events = inspected.events.filter(event => event.seq > afterSeq).slice(-limit)
    return { sessionId, cursor: inspected.events.at(-1)?.seq ?? -1, events }
  }

  private assertSession(sessionId: string): void {
    if (this.sessionId === undefined || this.sessionId !== sessionId) {
      throw new Error('session is not bound to this control run')
    }
  }

  private async sessionObserve(
    params: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const sessionId = requiredString(params.sessionId, 'sessionId')
    this.assertSession(sessionId)
    const inspected = await this.options.sessions.inspect(sessionId, signal)
    const status = this.options.sessions.getAgent(sessionId)?.status ?? 'idle'
    const attention = pendingUserQuestion(inspected.events)
    const last = inspected.events.at(-1)
    const phase = attention === undefined ? phaseOf(status, last) : 'waiting_for_attention'
    return {
      runId: this.options.runId,
      sessionId,
      status,
      phase,
      cursor: last?.seq ?? -1,
      ...(attention === undefined ? {} : { attention }),
    }
  }

  private async browserInstances(params: Readonly<Record<string, unknown>>): Promise<unknown> {
    this.assertSession(requiredString(params.sessionId, 'sessionId'))
    const browser = this.requiredBrowser()
    const instances = await browser.instances()
    this.visibleInstallations = new Set(instances.flatMap((instance) => {
      const id = instance.installationId
      return typeof id === 'string' && id.length > 0 ? [id] : []
    }))
    return { instances: instances.map(instance => structuredClone(instance)) }
  }

  private async browserTabs(
    params: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const sessionId = requiredString(params.sessionId, 'sessionId')
    this.assertSession(sessionId)
    const installationId = requiredString(params.installationId, 'installationId')
    if (!this.visibleInstallations.has(installationId)) {
      throw new Error('installation is not present in the latest browser instance observation')
    }
    if (this.installationId !== undefined && this.installationId !== installationId) {
      throw new Error('installation is not bound to this control run')
    }
    this.installationId = installationId
    const result = await this.requiredBrowser().execute({
      sessionId,
      installationId,
      action: { kind: 'tabs' },
    }, signal)
    this.visibleTabs = observedTabIds(result)
    return result
  }

  private async browserSnapshot(
    params: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const sessionId = requiredString(params.sessionId, 'sessionId')
    this.assertSession(sessionId)
    const installationId = requiredString(params.installationId, 'installationId')
    if (this.installationId !== installationId) {
      throw new Error('installation is not bound to this control run')
    }
    const tabId = requiredInteger(params.tabId, 'tabId')
    if (!this.visibleTabs.has(tabId)) {
      throw new Error('page is not present in the latest browser tab observation')
    }
    const frameId = requiredInteger(params.frameId, 'frameId')
    const action: { kind: string; [key: string]: unknown } = { kind: 'snapshot', tabId, frameId }
    for (const field of [
      'query', 'offset', 'limit', 'textLimit', 'tree',
      'includeOptions', 'treeCursor', 'treeLimit',
    ]) {
      if (params[field] !== undefined) action[field] = params[field]
    }
    const result = await this.requiredBrowser().execute({ sessionId, installationId, action }, signal)
    this.latestSnapshot = result
    this.latestPage = observedPage(result)
    return result
  }

  private browserEntryInspect(
    params: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    const sessionId = requiredString(params.sessionId, 'sessionId')
    this.assertSession(sessionId)
    const installationId = requiredString(params.installationId, 'installationId')
    if (this.installationId !== installationId) {
      throw new Error('installation is not bound to this control run')
    }
    if (this.latestPage === undefined) {
      throw new Error('entry inspection requires a successful current-page snapshot')
    }
    const action: { kind: string; [key: string]: unknown } = {
      kind: 'entry_inspect',
      page: structuredClone(this.latestPage),
      regionSelector: requiredString(params.regionSelector, 'regionSelector'),
      selector: requiredString(params.selector, 'selector'),
    }
    for (const field of ['titleSelector', 'linkSelector', 'sampleLimit']) {
      if (params[field] !== undefined) action[field] = params[field]
    }
    return this.requiredBrowser().execute({ sessionId, installationId, action }, signal)
  }

  private requiredBrowser(): ControlBrowserDependencies {
    if (this.options.browser === undefined) throw new Error('browser service is unavailable')
    return this.options.browser
  }

  private async sessionWait(
    params: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const sessionId = requiredString(params.sessionId, 'sessionId')
    this.assertSession(sessionId)
    const afterSeq = optionalInteger(params.afterSeq, 'afterSeq', -1)
    const timeoutMs = optionalInteger(params.timeoutMs, 'timeoutMs', 30_000, 1, 60_000)
    const agent = this.options.sessions.getAgent(sessionId)
    const timedOut = agent === undefined ? false : await waitForIdle(agent, timeoutMs, signal)
    const inspected = await this.options.sessions.inspect(sessionId, signal)
    return {
      sessionId,
      status: this.options.sessions.getAgent(sessionId)?.status ?? 'idle',
      cursor: inspected.events.at(-1)?.seq ?? -1,
      timedOut,
      events: inspected.events.filter(event => event.seq > afterSeq),
    }
  }

  private cordisInspect(params: Readonly<Record<string, unknown>>): unknown {
    const sessionId = requiredString(params.sessionId, 'sessionId')
    this.assertSession(sessionId)
    const plugins = (this.options.cordis?.inventory() ?? [])
      .filter(plugin => plugin.agentId === sessionId)
      .map(plugin => structuredClone(plugin))
    return { plugins }
  }

  private async evidenceExport(
    params: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const sessionId = requiredString(params.sessionId, 'sessionId')
    this.assertSession(sessionId)
    const inspected = await this.options.sessions.inspect(sessionId, signal)
    const browser = this.options.browser
    const instances = browser === undefined ? [] : await browser.instances()
    return {
      runId: this.options.runId,
      binding: {
        sessionId,
        ...(this.installationId === undefined ? {} : { installationId: this.installationId }),
      },
      session: {
        meta: structuredClone(inspected.meta),
        cursor: inspected.events.at(-1)?.seq ?? -1,
        events: inspected.events.map(event => structuredClone(event)),
      },
      cordis: this.cordisInspect({ sessionId }),
      browser: {
        instances: instances.map(instance => structuredClone(instance)),
        ...(this.latestSnapshot === undefined ? {} : { latestSnapshot: structuredClone(this.latestSnapshot) }),
      },
      operations: { reads: this.readCount, writes: this.writeCount, waits: this.waitCount },
    }
  }
}

function phaseOf(
  status: 'idle' | 'running',
  event: ControlSessionEvent | undefined,
): 'idle' | 'running' | 'completed' | 'failed' {
  if (status === 'running') return 'running'
  if (event?.type !== 'turn/end' || !isRecord(event.data) || !isRecord(event.data.reason)) return 'idle'
  return event.data.reason.kind === 'complete' ? 'completed' : 'failed'
}

function pendingUserQuestion(events: readonly ControlSessionEvent[]): Readonly<Record<string, unknown>> | undefined {
  const calls = new Map<string, Readonly<Record<string, unknown>>>()
  const results = new Set<string>()
  for (const event of events) {
    if (!isRecord(event.data)) continue
    const callId = event.data.callId
    if (typeof callId !== 'string' || callId.length === 0) continue
    if (event.type === 'tool/result') {
      results.add(callId)
      continue
    }
    if (event.type === 'tool/call' && event.data.name === 'ask_user_question') {
      calls.set(callId, event.data)
    }
  }
  const pending = [...calls.entries()].find(([callId]) => !results.has(callId))
  if (pending === undefined) return undefined
  const [callId, data] = pending
  const raw = data.arguments
  if (typeof raw !== 'string') return { kind: 'user_question', callId }
  try {
    const parsed = JSON.parse(raw) as unknown
    return isRecord(parsed) && Array.isArray(parsed.questions)
      ? { kind: 'user_question', callId, questions: structuredClone(parsed.questions) }
      : { kind: 'user_question', callId }
  } catch {
    return { kind: 'user_question', callId }
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, field)
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
  return value as number
}

function optionalInteger(
  value: unknown,
  field: string,
  fallback: number,
  minimum = -1,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined) return fallback
  const parsed = requiredIntegerAllowing(value, field, minimum)
  if (parsed > maximum) throw new Error(`${field} must be at most ${String(maximum)}`)
  return parsed
}

function requiredIntegerAllowing(value: unknown, field: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${field} must be a safe integer greater than or equal to ${String(minimum)}`)
  }
  return value as number
}

async function waitForIdle(
  agent: { readonly status: 'idle' | 'running'; whenIdle(): Promise<void> },
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (agent.status === 'idle') return false
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => { resolve('timeout') }, timeoutMs)
  })
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => { reject(signal.reason ?? new DOMException('Aborted', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    const result = await Promise.race([
      agent.whenIdle().then(() => 'idle' as const),
      timeout,
      cancelled,
    ])
    return result === 'timeout'
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (abort !== undefined) signal.removeEventListener('abort', abort)
  }
}

function observedTabIds(result: Readonly<Record<string, unknown>>): Set<number> {
  const value = result.value
  if (result.outcome !== 'observed' || typeof value !== 'object' || value === null || Array.isArray(value)) {
    return new Set()
  }
  const tabs = (value as Record<string, unknown>).tabs
  if (!Array.isArray(tabs)) return new Set()
  return new Set(tabs.flatMap((tab) => {
    if (typeof tab !== 'object' || tab === null || Array.isArray(tab)) return []
    const tabId = (tab as Record<string, unknown>).tabId
    return Number.isSafeInteger(tabId) && (tabId as number) >= 0 ? [tabId as number] : []
  }))
}

function observedPage(result: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
  const value = result.value
  if (result.outcome !== 'observed' || !isRecord(value) || !isRecord(value.page)) return undefined
  const page = value.page
  if (!Number.isSafeInteger(page.tabId) || !Number.isSafeInteger(page.frameId)
    || typeof page.documentId !== 'string' || page.documentId.length === 0
    || typeof page.url !== 'string' || page.url.length === 0) return undefined
  return structuredClone(page)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

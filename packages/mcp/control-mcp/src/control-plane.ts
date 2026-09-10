/** Run-bound control logic shared by the Host route and its tests. */
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import type { ControlAttentions } from './attention.ts'

export interface ControlSessionEvent {
  readonly seq: number
  readonly type: string
  readonly [key: string]: unknown
}

export interface ControlSessionDependencies {
  subscribe?(sessionId: string, notify: () => void): () => void
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
  cancel(request: { readonly sessionId: string }): { readonly accepted: true }
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
  readonly runtime?: () => Promise<Readonly<Record<string, unknown>>>
  readonly runtimeInspect?: ControlRuntimeInspectDependencies
  readonly sessions: ControlSessionDependencies
  readonly browser?: ControlBrowserDependencies
  readonly attention?: Pick<ControlAttentions, 'list' | 'subscribe' | 'answer'>
  readonly cordis?: ControlCordisDependencies
  readonly maxWriteReceipts?: number
}

export interface ControlRuntimeInspectDependencies {
  plugins(): Promise<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>
  capabilities(sessionId: string): Promise<Readonly<Record<string, unknown>>>
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
    | 'runtime_status'
    | 'runtime_inspect'
    | 'request_receipt'
    | 'session_open'
    | 'session_prompt'
    | 'session_wait'
    | 'session_events'
    | 'session_observe'
    | 'session_attention_answer'
    | 'session_cancel'
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
  readonly method: ControlRequest['method']
  readonly result: Promise<unknown>
  readonly receipt: Promise<WriteReceipt>
}

type WriteReceipt =
  | { readonly status: 'fulfilled'; readonly value: unknown }
  | { readonly status: 'rejected'; readonly error: { readonly message: string; readonly code?: string } }

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

  /** Return the single Session claimed by this run, if one has been opened. */
  boundSessionId(): string | undefined {
    return this.sessionId
  }

  /** Dispatch one authenticated, run-bound operation. */
  async handle(request: ControlRequest, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    if (request.runId !== this.options.runId) {
      return Promise.reject(new Error('runId does not match this control run'))
    }
    switch (request.method) {
      case 'runtime_status':
        this.readCount++
        return { runId: this.options.runId, sessionId: this.sessionId ?? null,
          identity: await this.options.runtime?.() ?? null }
      case 'runtime_inspect':
        this.readCount++
        return await this.runtimeInspect(request.params)
      case 'request_receipt':
        this.readCount++
        return await this.requestReceipt(request.params)
      case 'session_open':
      case 'session_prompt':
      case 'session_attention_answer':
      case 'session_cancel':
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
    const result = request.method === 'session_open' ? this.open(request.params)
      : request.method === 'session_attention_answer' ? this.sessionAttentionAnswer(request.params, signal)
        : request.method === 'session_cancel' ? this.sessionCancel(request.params)
          : this.prompt(request.requestId, request.params, signal)
    const receipt = result.then<WriteReceipt, WriteReceipt>(
      value => ({ status: 'fulfilled', value }),
      (error: unknown) => ({ status: 'rejected', error: errorValue(error) }),
    )
    this.writeCount++
    this.writes.set(request.requestId, { fingerprint, method: request.method, result, receipt })
    return result
  }

  private async requestReceipt(params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const requestId = requiredString(params.requestId, 'requestId')
    const write = this.writes.get(requestId)
    if (write === undefined) return { requestId, found: false }
    return { requestId, found: true, method: write.method, ...await write.receipt }
  }

  private async runtimeInspect(params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const view = requiredString(params.view, 'view')
    const query = optionalString(params.query, 'query')?.toLocaleLowerCase('en-US')
    const limit = optionalInteger(params.limit, 'limit', 100, 1, 200)
    const inspect = this.options.runtimeInspect
    if (inspect === undefined) throw new Error('runtime inspection is unavailable')
    if (view === 'plugins') {
      const snapshot = await inspect.plugins()
      const entries = Array.isArray(snapshot.entries) ? snapshot.entries : []
      return boundedMatches('plugins', entries, query, limit)
    }
    if (view === 'capabilities') {
      if (this.sessionId === undefined) throw new Error('capability inspection requires a bound Session')
      const snapshot = await inspect.capabilities(this.sessionId)
      return {
        view,
        sessionId: this.sessionId,
        skills: boundedMatches('skills', Array.isArray(snapshot.skills) ? snapshot.skills : [], query, limit),
        tools: boundedMatches('tools', Array.isArray(snapshot.tools) ? snapshot.tools : [], query, limit),
        mcpServers: boundedMatches(
          'mcpServers', Array.isArray(snapshot.mcpServers) ? snapshot.mcpServers : [], query, limit,
        ),
      }
    }
    throw new Error('view must be plugins or capabilities')
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
    return { sessionId, ...eventPage(inspected.events, afterSeq, limit) }
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
    return this.observationFor(sessionId, inspected.events)
  }

  private observationFor(sessionId: string, events: readonly ControlSessionEvent[]) {
    const status = this.options.sessions.getAgent(sessionId)?.status ?? 'idle'
    const attention = this.options.attention?.list(sessionId) ?? []
    const phase = attention.length > 0 ? 'waiting_for_attention' : phaseOf(status, events)
    return {
      runId: this.options.runId,
      sessionId,
      status,
      phase,
      cursor: events.at(-1)?.seq ?? -1,
      attention,
    }
  }

  private async sessionAttentionAnswer(
    params: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const sessionId = requiredString(params.sessionId, 'sessionId')
    this.assertSession(sessionId)
    const attentionId = requiredString(params.attentionId, 'attentionId')
    if (this.options.attention === undefined) throw new Error('attention service is unavailable')
    signal.throwIfAborted()
    return this.options.attention.answer(sessionId, attentionId, { answers: parseAttentionAnswers(params.answers) })
  }

  private sessionCancel(params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const sessionId = requiredString(params.sessionId, 'sessionId')
    this.assertSession(sessionId)
    return Promise.resolve(this.options.sessions.cancel({ sessionId }))
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
    const timedOut = await this.waitForSettlement(sessionId, timeoutMs, signal)
    const inspected = await this.options.sessions.inspect(sessionId, signal)
    const status = this.options.sessions.getAgent(sessionId)?.status ?? 'idle'
    const attention = this.options.attention?.list(sessionId) ?? []
    return {
      sessionId,
      status,
      phase: attention.length > 0 ? 'waiting_for_attention' : phaseOf(status, inspected.events),
      attention,
      timedOut,
      ...eventPage(inspected.events, afterSeq, optionalInteger(params.limit, 'limit', 200, 1, 1000)),
    }
  }

  private async waitForSettlement(sessionId: string, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) throw signal.reason
    const settled = () => this.options.sessions.getAgent(sessionId)?.status !== 'running'
      || (this.options.attention?.list(sessionId).length ?? 0) > 0
    if (settled()) return false
    const wake = Promise.withResolvers<boolean>()
    const notify = () => { if (settled()) wake.resolve(false) }
    const offSession = this.options.sessions.subscribe?.(sessionId, notify)
    const offAttention = this.options.attention?.subscribe(notify)
    const abort = () => { wake.reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => { wake.resolve(true) }, timeoutMs)
    // Consumers without an event subscription retain the existing whole-agent idle wait.
    const agent = this.options.sessions.getAgent(sessionId)
    if (offSession === undefined && agent !== undefined) void agent.whenIdle().then(notify, wake.reject)
    try {
      if (signal.aborted) abort()
      else notify()
      return await wake.promise
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      offSession?.()
      offAttention?.()
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
      identity: await this.options.runtime?.() ?? null,
      observation: this.observationFor(sessionId, inspected.events),
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
  events: readonly ControlSessionEvent[],
): string {
  if (status === 'running') return 'running'
  const boundary = events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
  if (boundary === undefined) return 'idle'
  if (boundary.type === 'turn/start' || !isRecord(boundary.data) || !isRecord(boundary.data.reason)) return 'unknown'
  const kind = boundary.data.reason.kind
  if (kind === 'completed') return 'completed'
  if (kind === 'error') return 'failed'
  if (kind === 'aborted') return 'cancelled'
  if (kind === 'blocked' || kind === 'interrupted' || kind === 'max-tokens') return kind
  return 'unknown'
}

function eventPage(events: readonly ControlSessionEvent[], afterSeq: number, limit: number) {
  const page = events.filter(event => event.seq > afterSeq).slice(0, limit)
  const cursor = page.at(-1)?.seq ?? afterSeq
  const latestSeq = events.at(-1)?.seq ?? -1
  return { cursor, latestSeq, hasMore: cursor < latestSeq, events: page }
}

function errorValue(error: unknown): { readonly message: string; readonly code?: string } {
  const message = error instanceof Error ? error.message : String(error)
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? { message, code: error.code }
    : { message }
}

function boundedMatches(view: string, values: readonly unknown[], query: string | undefined, limit: number) {
  const matching = query === undefined ? values : values.filter(value =>
    JSON.stringify(value).toLocaleLowerCase('en-US').includes(query))
  return { view, total: values.length, matched: matching.length, truncated: matching.length > limit,
    entries: structuredClone(matching.slice(0, limit)) }
}

function parseAttentionAnswers(value: unknown): AskUserQuestionAnswer['answers'] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32
    || Buffer.byteLength(JSON.stringify(value)) > 65_536) throw new Error('answers must be a bounded non-empty array')
  return value.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0
      || !Array.isArray(item.selected) || item.selected.some(option => typeof option !== 'string')) {
      throw new Error(`answers[${String(index)}] must contain id and string selected values`)
    }
    if (item.custom !== undefined && typeof item.custom !== 'string') {
      throw new Error(`answers[${String(index)}].custom must be a string`)
    }
    return {
      id: item.id,
      selected: [...item.selected] as string[],
      ...(item.custom === undefined ? {} : { custom: item.custom }),
    }
  })
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

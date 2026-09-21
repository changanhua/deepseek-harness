import { z } from 'zod'
import type { SessionController, SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { BrowserPage } from '@changanhua/dsh-browser'
import type { BrowserSessionTargetBinding, BrowserSessionTargetState } from '@changanhua/dsh-browser-task'

const sessionId = z.string().min(1).max(256)
const address = z.object({ kind: z.literal('session'), sessionId }).strict()
const list = z.object({ cursor: z.string().max(1024).optional() }).strict()
const create = z.object({ sessionId: sessionId.optional(), cwd: z.string().min(1).max(4096).optional(),
  agentPreset: z.string().min(1).max(128).regex(/^[a-z][a-z0-9-]*$/u).optional() }).strict()
const promptPart = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1).max(64 * 1024) }).strict(),
  z.object({ type: z.literal('image'), mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/u).min(4).max(8 * 1024 * 1024), name: z.string().min(1).max(256).optional() }).strict(),
])
const prompt = z.object({ requestId: z.string().min(1).max(256), sessionId, mode: z.enum(['queue', 'steer']),
  content: z.array(promptPart).min(1).max(8), clientTimeZone: z.string().max(128).optional(),
  expectedTargetRevision: z.number().int().nonnegative().optional() }).strict()
const cancel = z.object({ sessionId }).strict()
const modelCatalog = z.object({}).strict()
const selectModel = z.object({ sessionId, provider: z.string().min(1).max(256), model: z.string().min(1).max(256),
  reasoningEffort: z.string().min(1).max(128).optional() }).strict()
const commandExecute = z.object({ sessionId, line: z.string().min(1).max(64 * 1024) }).strict()
const page = z.object({ address, throughSeq: z.number().int().nonnegative(), beforeSeq: z.number().int().nonnegative().optional(),
  maxMessages: z.number().int().positive().max(512).optional() }).strict()
const attachment = z.object({ sessionId, attachmentId: z.string().min(1).max(256) }).strict()
const follow = z.object({ streamId: z.uuid({ version: 'v4' }), request: z.object({
  address, maxMessages: z.number().int().positive().max(512).optional(), assistantStream: z.literal(true).optional(),
}).strict() }).strict()
const unfollow = z.object({ streamId: z.uuid({ version: 'v4' }) }).strict()
const targetPage = z.object({ tabId: z.number().int().nonnegative(), frameId: z.number().int().nonnegative(),
  documentId: z.string().min(1).max(128), url: z.url().max(8192)
    .refine(value => ['http:', 'https:'].includes(new URL(value).protocol)) }).strict()
const targetRead = z.object({ sessionId }).strict()
const targetBind = z.object({ sessionId, expectedRevision: z.number().int().nonnegative(), page: targetPage }).strict()
const targetClear = z.object({ sessionId, expectedRevision: z.number().int().nonnegative() }).strict()
const functionIdentity = z.object({ pluginId: z.string().min(1).max(256), expectedPackageId: z.string().min(1).max(256),
  expectedPluginRunId: z.string().min(1).max(256) }).strict()
const functionList = z.object({}).strict()
/** The browser client never chooses a runner owner, Agent, or capability. */
const functionRun = z.object({ requestId: z.uuid({ version: 'v4' }), functionId: z.string().min(1).max(256),
  expectedVersion: z.string().min(1).max(256), expectedRunId: z.string().min(1).max(256).nullable(),
  sessionId, expectedTargetRevision: z.number().int().nonnegative().nullable() }).strict()
const functionEdit = functionRun.omit({ expectedRunId: true }).extend({ instruction: z.string().trim().min(1).max(8192) }).strict()
const functionCommandStatus = z.object({ requestId: z.uuid({ version: 'v4' }) }).strict()

type Controller = Pick<SessionController,
  'list' | 'create' | 'prompt' | 'cancel' | 'page' | 'attachment' | 'follow' | 'modelCatalog' | 'selectModel'>
export interface BrowserSessionTargets {
  read(sessionId: string, signal: AbortSignal): BrowserSessionTargetState | Promise<BrowserSessionTargetState>
  bind(sessionId: string, request: {
    readonly expectedRevision: number
    readonly installationId: string
    readonly page: BrowserPage
  }, signal: AbortSignal): BrowserSessionTargetBinding | Promise<BrowserSessionTargetBinding>
  clear(sessionId: string, expectedRevision: number, signal: AbortSignal): BrowserSessionTargetState | Promise<BrowserSessionTargetState>
}

/** Source-free function state needed to fence a human command to one exact run. */
export interface BrowserFunctionInspection {
  readonly pluginId: string
  readonly packageId: string
  readonly activeRun?: { readonly packageId: string; readonly pluginRunId: string }
}

/** Minimal runner facet available to the authenticated browser-function gateway. */
export interface BrowserFunctionRunner {
  listForInstallation(owner: { readonly installationId: string; readonly grantEpoch: number }): readonly BrowserFunctionInspection[]
  inspectForInstallation(
    owner: { readonly installationId: string; readonly grantEpoch: number },
    pluginId: string,
  ): BrowserFunctionInspection | undefined
  stopForInstallation(owner: { readonly installationId: string; readonly grantEpoch: number }, request: {
    readonly pluginId: string
    readonly expectedPackageId: string
    readonly expectedPluginRunId: string
  }): Promise<unknown>
  runForInstallation(agent: unknown, owner: { readonly installationId: string; readonly grantEpoch: number }, request: {
    readonly requestId: string
    readonly pluginId: string
    readonly expectedPackageId: string
    readonly expectedPluginRunId?: string
    readonly expectedTargetRevision?: number | null
  }): Promise<unknown>
  prepareEditForInstallation(agent: unknown, owner: { readonly installationId: string; readonly grantEpoch: number }, request: {
    readonly requestId: string
    readonly pluginId: string
    readonly expectedPackageId: string
    readonly expectedTargetRevision?: number | null
    readonly instruction: string
  }): Promise<unknown>
  revokePreparedEdit?(requestId: string): Promise<void> | void
  commandStatusForInstallation(owner: { readonly installationId: string; readonly grantEpoch: number }, requestId: string): unknown
  revokeInstallation(owner: { readonly installationId: string; readonly grantEpoch: number }): Promise<void> | void
}

/** Narrow SessionController facet used to resolve the exact Session Agent and enqueue one edit prompt. */
export interface BrowserFunctionSessions {
  resolveAgent(sessionId: SessionId): Promise<{ readonly agent: unknown } | { readonly error: unknown }>
  prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<unknown>
}

const failure = (code: string, message = code) => Object.assign(new Error(message), { code, message })
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
const checked = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value)
  if (!result.success) throw failure('bad_request', 'invalid session request')
  return result.data
}

/** One authenticated browser peer's bounded SessionController facade. */
export class BrowserSessions {
  private readonly calls = new Set<{ abort: AbortController; underlying: Promise<unknown> }>()
  private readonly follows = new Map<string, { streamId: string; abort: AbortController; task: Promise<void> }>()
  private closed = false
  private followLane = Promise.resolve()
  private disposal: Promise<void> | undefined

  constructor(
    private readonly controller: Controller,
    private readonly options: {
      permit: () => boolean
      send: (frame: unknown) => void
      maxFrameBytes?: number
      maxFollows?: number
      installationId?: string
      targets?: BrowserSessionTargets
      /** Optional Host command registry projected through the authenticated Session identity. */
      commands?: {
        execute: (sessionId: string, line: string, signal: AbortSignal) => Promise<unknown>
      }
    },
  ) {}

  private permit(): void {
    if (this.closed) throw failure('cancelled')
    if (!this.options.permit()) throw failure('forbidden', 'session permission is not active')
  }

  private async call(method: keyof Controller, request: unknown): Promise<unknown> {
    const invoke = this.controller[method] as unknown as (request: unknown, signal: AbortSignal) => Promise<unknown>
    return this.invoke(signal => invoke.call(this.controller, request, signal))
  }

  /** Track one Session operation so connection disposal cancels and joins it. */
  private async invoke<T>(work: (signal: AbortSignal) => T | Promise<T>): Promise<T> {
    this.permit()
    const abort = new AbortController()
    let underlying: Promise<T>
    try { underlying = Promise.resolve(work(abort.signal)) } catch (error) {
      underlying = Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    const entry = { abort, underlying }
    this.calls.add(entry)
    let rejectCancelled!: (error: Error) => void
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject })
    const onAbort = () =>{  rejectCancelled(failure('cancelled')) }
    abort.signal.addEventListener('abort', onAbort, { once: true })
    try {
      let value: T
      try { value = await Promise.race([underlying, cancelled]) } catch (error) {
        if (abort.signal.aborted) throw failure('cancelled')
        throw error
      }
      this.permit()
      return structuredClone(value)
    } finally {
      abort.signal.removeEventListener('abort', onAbort)
      underlying.finally(() => { this.calls.delete(entry) }).catch(() => {})
    }
  }

  async handle(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'session.list': return this.call('list', checked(list, params))
      case 'session.create': return this.call('create', checked(create, params))
      case 'session.prompt': {
        const input = checked(prompt, params)
        const { expectedTargetRevision, ...request } = input
        if (expectedTargetRevision !== undefined
          && (await this.readTarget(input.sessionId)).revision !== expectedTargetRevision) {
          throw failure('target_changed', 'browser target revision changed')
        }
        return this.call('prompt', request)
      }
      case 'session.cancel': return this.call('cancel', checked(cancel, params))
      case 'session.modelCatalog':
        checked(modelCatalog, params)
        return this.invoke(() => this.controller.modelCatalog())
      case 'session.selectModel': return this.call('selectModel', checked(selectModel, params))
      case 'commands.execute': {
        const input = checked(commandExecute, params)
        const commands = this.options.commands
        if (commands === undefined) throw failure('command_unavailable', 'session commands are unavailable')
        return this.invoke(signal => commands.execute(input.sessionId, input.line, signal))
      }
      case 'session.page': return this.call('page', checked(page, params))
      case 'session.attachment': return this.call('attachment', checked(attachment, params))
      case 'session.follow': return this.startFollow(checked(follow, params))
      case 'session.unfollow': return this.stopFollow(checked(unfollow, params))
      case 'session.target.read': return this.readTarget(checked(targetRead, params).sessionId)
      case 'session.target.bind': {
        const input = checked(targetBind, params)
        return this.invoke(async (signal) => {
          const { targets, installationId } = this.targetAuthority()
          return targets.bind(input.sessionId, { expectedRevision: input.expectedRevision,
            installationId, page: input.page }, signal)
        })
      }
      case 'session.target.clear': {
        const input = checked(targetClear, params)
        return this.invoke((signal) => {
          const { targets } = this.targetAuthority()
          return targets.clear(input.sessionId, input.expectedRevision, signal)
        })
      }
      default: throw failure('method_not_found', 'unknown session method')
    }
  }

  private targetAuthority(): { targets: BrowserSessionTargets; installationId: string } {
    if (this.options.targets === undefined || this.options.installationId === undefined) {
      throw failure('target_unavailable', 'browser target service is unavailable')
    }
    return { targets: this.options.targets, installationId: this.options.installationId }
  }

  private async readTarget(id: string): Promise<BrowserSessionTargetState> {
    return this.invoke((signal) => {
      const { targets } = this.targetAuthority()
      return targets.read(id, signal)
    })
  }

  private async startFollow(input: z.infer<typeof follow>): Promise<{ streamId: string }> {
    return this.serialFollow(async () => {
      this.permit()
      await this.stopOneFollow(input.streamId)
      this.permit()
      if (this.follows.size >= (this.options.maxFollows ?? 8)) throw failure('too_many_follows')
      const abort = new AbortController()
      const entry = { streamId: input.streamId, abort, task: Promise.resolve() }
      entry.task = Promise.resolve().then(() => this.pump(input.streamId, input.request, abort, entry))
      this.follows.set(input.streamId, entry)
      void entry.task.finally(() => {
        if (this.follows.get(input.streamId) === entry) this.follows.delete(input.streamId)
      })
      return { streamId: input.streamId }
    })
  }

  private async stopFollow(input: z.infer<typeof unfollow>): Promise<{ streamId: string }> {
    return this.serialFollow(async () => {
      this.permit()
      await this.stopOneFollow(input.streamId)
      this.permit()
      return { streamId: input.streamId }
    })
  }

  private serialFollow<T>(action: () => Promise<T>): Promise<T> {
    const result = this.followLane.then(action, action)
    this.followLane = result.then(() => {}, () => {})
    return result
  }

  private async stopOneFollow(streamId: string): Promise<void> {
    const current = this.follows.get(streamId)
    if (!current) return
    this.follows.delete(streamId)
    current.abort.abort()
    await current.task.catch(() => {})
  }

  private async pump(streamId: string, request: z.infer<typeof follow>['request'], abort: AbortController,
    entry: { streamId: string; abort: AbortController; task: Promise<void> }): Promise<void> {
    try {
      this.permit()
      for await (const event of this.controller.follow({
        address: { kind: 'session', sessionId: SessionId(request.address.sessionId) },
        ...(request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages }),
        ...(request.assistantStream === true ? { assistantStream: true as const } : {}),
      }, abort.signal)) {
        if (abort.signal.aborted || this.closed || this.follows.get(streamId) !== entry || !this.options.permit()) break
        const frame = { type: 'event', streamId, event: structuredClone(event) }
        if (bytes(frame) > (this.options.maxFrameBytes ?? 512 * 1024)) throw failure('stream_error', 'frame_too_large')
        this.options.send(frame)
      }
    } catch (error) {
      const reportable = !abort.signal.aborted && !this.closed && this.follows.get(streamId) === entry && this.options.permit()
      abort.abort()
      if (reportable) {
        const message = (error instanceof Error ? error.message : 'stream failed').slice(0, 1024)
        try { this.options.send({ type: 'event', streamId, error: { code: 'stream_error', message } }) } catch { /* peer is gone */ }
      }
    }
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.closed = true
    const calls = [...this.calls]
    for (const call of calls) call.abort.abort()
    this.disposal = (async () => {
      await this.serialFollow(async () => {
        await Promise.all([...this.follows.keys()].map(streamId => this.stopOneFollow(streamId)))
      })
      await Promise.allSettled(calls.map(call => call.underlying))
    })()
    return this.disposal
  }
}

/**
 * Browser-owned function commands.  The owner is deliberately captured from
 * the authenticated grant instead of accepting an owner or Session from RPC.
 */
export class BrowserFunctions {
  private readonly owner: { readonly installationId: string; readonly grantEpoch: number }

  constructor(
    private readonly runner: BrowserFunctionRunner,
    private readonly sessions: BrowserFunctionSessions,
    options: { readonly installationId: string; readonly grantEpoch: number; readonly permit: () => boolean },
  ) {
    this.owner = { installationId: options.installationId, grantEpoch: options.grantEpoch }
    this.permit = options.permit
  }

  private readonly permit: () => boolean

  async handle(method: string, params: unknown): Promise<unknown> {
    this.requirePermit()
    switch (method) {
      case 'function.list': {
        checked(functionList, params)
        const value = this.runner.listForInstallation(this.owner)
        this.requirePermit()
        return { functions: structuredClone(value) }
      }
      case 'function.inspect': {
        const input = checked(functionIdentity, params)
        return { function: this.inspectCurrent(input) }
      }
      case 'function.stop': {
        const input = checked(functionIdentity, params)
        this.inspectCurrent(input)
        const result = await this.runner.stopForInstallation(this.owner, input)
        this.requirePermit()
        if (result === null || typeof result !== 'object' || (result as { ok?: unknown }).ok !== true) {
          throw failure('function_stop_failed', 'function could not be stopped')
        }
        return { stopped: true, pluginId: input.pluginId }
      }
      case 'function.run': return this.run(checked(functionRun, params))
      case 'function.edit': return this.edit(checked(functionEdit, params))
      case 'function.command.status': {
        const input = checked(functionCommandStatus, params)
        const result = await this.runner.commandStatusForInstallation(this.owner, input.requestId)
        this.requirePermit()
        return structuredClone(result)
      }
      default: throw failure('method_not_found', 'unknown function method')
    }
  }

  private async run(input: z.infer<typeof functionRun>): Promise<unknown> {
    const agent = await this.resolveAgent(input.sessionId)
    const result = await this.runner.runForInstallation(agent, this.owner, {
      requestId: input.requestId, pluginId: input.functionId, expectedPackageId: input.expectedVersion,
      ...(input.expectedRunId === null ? {} : { expectedPluginRunId: input.expectedRunId }),
      ...(input.expectedTargetRevision === null ? {} : { expectedTargetRevision: input.expectedTargetRevision }),
    })
    this.requirePermit()
    return this.requireCommandSuccess(result)
  }

  private async edit(input: z.infer<typeof functionEdit>): Promise<unknown> {
    const agent = await this.resolveAgent(input.sessionId)
    const prepared = await this.runner.prepareEditForInstallation(agent, this.owner, {
      requestId: input.requestId, pluginId: input.functionId, expectedPackageId: input.expectedVersion,
      ...(input.expectedTargetRevision === null ? {} : { expectedTargetRevision: input.expectedTargetRevision }),
      instruction: input.instruction,
    })
    try {
      this.requireCommandSuccess(prepared)
      this.requirePermit()
      await this.sessions.prompt({ requestId: input.requestId, sessionId: input.sessionId, mode: 'queue', content: [{ type: 'text', text: input.instruction }] } as unknown as SessionPromptRequest,
        new AbortController().signal)
      this.requirePermit()
      return this.requireCommandSuccess(prepared)
    } catch (error) {
      await this.runner.revokePreparedEdit?.(input.requestId)
      throw error
    }
  }

  private async resolveAgent(id: string): Promise<unknown> {
    this.requirePermit()
    const result = await this.sessions.resolveAgent(SessionId(id))
    this.requirePermit()
    if (!('agent' in result)) throw failure('session_unavailable', 'session agent is unavailable')
    return result.agent
  }

  private requireCommandSuccess(value: unknown): unknown {
    if (value !== null && typeof value === 'object' && (value as { ok?: unknown }).ok === false) {
      const receipt = value as { reason?: unknown; message?: unknown }
      throw failure(typeof receipt.reason === 'string' ? receipt.reason : 'function_command_failed',
        typeof receipt.message === 'string' ? receipt.message : 'function command failed')
    }
    return structuredClone(value)
  }

  private inspectCurrent(input: z.infer<typeof functionIdentity>): BrowserFunctionInspection {
    const value = this.runner.inspectForInstallation(this.owner, input.pluginId)
    this.requirePermit()
    if (value === undefined || value.packageId !== input.expectedPackageId
      || value.activeRun?.packageId !== input.expectedPackageId
      || value.activeRun.pluginRunId !== input.expectedPluginRunId) {
      throw failure('function_changed', 'function package or run changed')
    }
    return structuredClone(value)
  }

  private requirePermit(): void {
    if (!this.permit()) throw failure('forbidden', 'function permission is not active')
  }
}

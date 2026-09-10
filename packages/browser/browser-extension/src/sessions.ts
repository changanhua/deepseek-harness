import { z } from 'zod'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'

const sessionId = z.string().min(1).max(256)
const address = z.object({ kind: z.literal('session'), sessionId }).strict()
const list = z.object({ cursor: z.string().max(1024).optional() }).strict()
const create = z.object({ sessionId: sessionId.optional(), cwd: z.string().min(1).max(4096).optional() }).strict()
const promptPart = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1).max(64 * 1024) }).strict(),
  z.object({ type: z.literal('image'), mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/u).min(4).max(8 * 1024 * 1024), name: z.string().min(1).max(256).optional() }).strict(),
])
const prompt = z.object({ requestId: z.string().min(1).max(256), sessionId, mode: z.enum(['queue', 'steer']),
  content: z.array(promptPart).min(1).max(8), clientTimeZone: z.string().max(128).optional() }).strict()
const cancel = z.object({ sessionId }).strict()
const page = z.object({ address, throughSeq: z.number().int().nonnegative(), beforeSeq: z.number().int().nonnegative().optional(),
  maxMessages: z.number().int().positive().max(512).optional() }).strict()
const attachment = z.object({ sessionId, attachmentId: z.string().min(1).max(256) }).strict()
const follow = z.object({ streamId: z.uuid({ version: 'v4' }), request: z.object({ address, maxMessages: z.number().int().positive().max(512).optional() }).strict() }).strict()
const unfollow = z.object({ streamId: z.uuid({ version: 'v4' }) }).strict()

type Controller = Pick<SessionController, 'list' | 'create' | 'prompt' | 'cancel' | 'page' | 'attachment' | 'follow'>

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
  private follow: { streamId: string; abort: AbortController; task: Promise<void> } | undefined
  private closed = false
  private followLane = Promise.resolve()
  private disposal: Promise<void> | undefined

  constructor(
    private readonly controller: Controller,
    private readonly options: { permit: () => boolean; send: (frame: unknown) => void; maxFrameBytes?: number },
  ) {}

  private permit(): void {
    if (this.closed) throw failure('cancelled')
    if (!this.options.permit()) throw failure('forbidden', 'session permission is not active')
  }

  private async call(method: keyof Controller, request: unknown): Promise<unknown> {
    this.permit()
    const abort = new AbortController()
    const invoke = this.controller[method] as unknown as (request: unknown, signal: AbortSignal) => Promise<unknown>
    const underlying = Promise.resolve(invoke.call(this.controller, request, abort.signal))
    const entry = { abort, underlying }
    this.calls.add(entry)
    let rejectCancelled!: (error: Error) => void
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject })
    const onAbort = () =>{  rejectCancelled(failure('cancelled')) }
    abort.signal.addEventListener('abort', onAbort, { once: true })
    try {
      let value: unknown
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
      case 'session.prompt': return this.call('prompt', checked(prompt, params))
      case 'session.cancel': return this.call('cancel', checked(cancel, params))
      case 'session.page': return this.call('page', checked(page, params))
      case 'session.attachment': return this.call('attachment', checked(attachment, params))
      case 'session.follow': return this.startFollow(checked(follow, params))
      case 'session.unfollow': return this.stopFollow(checked(unfollow, params))
      default: throw failure('method_not_found', 'unknown session method')
    }
  }

  private async startFollow(input: z.infer<typeof follow>): Promise<{ streamId: string }> {
    return this.serialFollow(async () => {
      this.permit()
      await this.stopCurrentFollow()
      this.permit()
      const abort = new AbortController()
      const task = Promise.resolve().then(() => this.pump(input.streamId, input.request, abort))
      this.follow = { streamId: input.streamId, abort, task }
      return { streamId: input.streamId }
    })
  }

  private async stopFollow(input: z.infer<typeof unfollow>): Promise<{ streamId: string }> {
    return this.serialFollow(async () => {
      this.permit()
      if (this.follow?.streamId === input.streamId) await this.stopCurrentFollow()
      this.permit()
      return { streamId: input.streamId }
    })
  }

  private serialFollow<T>(action: () => Promise<T>): Promise<T> {
    const result = this.followLane.then(action, action)
    this.followLane = result.then(() => {}, () => {})
    return result
  }

  private async stopCurrentFollow(): Promise<void> {
    const current = this.follow
    if (!current) return
    this.follow = undefined
    current.abort.abort()
    await current.task.catch(() => {})
  }

  private async pump(streamId: string, request: z.infer<typeof follow>['request'], abort: AbortController): Promise<void> {
    try {
      this.permit()
      for await (const event of this.controller.follow({
        address: { kind: 'session', sessionId: SessionId(request.address.sessionId) },
        ...(request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages }),
      }, abort.signal)) {
        if (abort.signal.aborted || this.closed || this.follow?.streamId !== streamId || !this.options.permit()) break
        const frame = { type: 'event', streamId, event: structuredClone(event) }
        if (bytes(frame) > (this.options.maxFrameBytes ?? 512 * 1024)) throw failure('stream_error', 'frame_too_large')
        this.options.send(frame)
      }
    } catch (error) {
      const reportable = !abort.signal.aborted && !this.closed && this.follow?.streamId === streamId && this.options.permit()
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
      await this.serialFollow(() => this.stopCurrentFollow())
      await Promise.allSettled(calls.map(call => call.underlying))
    })()
    return this.disposal
  }
}

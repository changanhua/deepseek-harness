/** Loopback-only HTTP client used by the stdio MCP adapter. */

import type { ControlRequest } from './control-plane.ts'
import { randomUUID } from 'node:crypto'

export interface DshControlHttpClientOptions {
  readonly origin: string
  readonly token: string
  readonly runId: string
  readonly fetch?: typeof globalThis.fetch
}

/** Structured Host refusal surfaced to an MCP tool result. */
export class DshControlRemoteError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'DshControlRemoteError'
  }
}

export class DshControlHttpClient {
  private readonly origin: URL
  private readonly send: typeof globalThis.fetch
  private cookie: string | undefined
  private authentication: Promise<string> | undefined

  constructor(private readonly options: DshControlHttpClientOptions) {
    this.origin = loopbackOrigin(options.origin)
    if (options.token.length === 0) throw new Error('token must be a non-empty string')
    if (options.runId.length === 0) throw new Error('runId must be a non-empty string')
    this.send = options.fetch ?? globalThis.fetch
  }

  /** Call one fixed control method through the Host's authenticated exact route. */
  async call(
    method: ControlRequest['method'],
    params: Readonly<Record<string, unknown>>,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (requestId.length === 0) throw new Error('requestId must be a non-empty string')
    const rpcId = randomUUID()
    const body = JSON.stringify({
      type: 'client-request', rpcId, method: 'invoke',
      payload: { runId: this.options.runId, requestId, method, params },
    })
    let response = await this.post(body, await this.authenticate(signal), signal)
    if (response.status === 401) {
      this.cookie = undefined
      response = await this.post(body, await this.authenticate(signal), signal)
    }
    const reply = await parseReply(response, rpcId)
    if (!reply.ok) throw new DshControlRemoteError(reply.error.code, reply.error.message)
    return reply.value
  }

  private post(body: string, cookie: string, signal?: AbortSignal): Promise<Response> {
    return this.send(new URL('/dsh-control/invoke', this.origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  private authenticate(signal?: AbortSignal): Promise<string> {
    if (this.cookie !== undefined) return Promise.resolve(this.cookie)
    this.authentication ??= this.exchange(signal).finally(() => { this.authentication = undefined })
    return this.authentication
  }

  private async exchange(signal?: AbortSignal): Promise<string> {
    const url = new URL('/', this.origin)
    url.searchParams.set('token', this.options.token)
    const response = await this.send(url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      ...(signal === undefined ? {} : { signal }),
    })
    const setCookie = response.headers.get('set-cookie')
    const cookie = setCookie?.split(';', 1)[0]?.trim()
    if (response.status !== 303 || cookie === undefined || !cookie.includes('=')) {
      throw new Error(`DSH control authentication failed with HTTP ${String(response.status)}`)
    }
    this.cookie = cookie
    return cookie
  }
}

type ControlReply =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

async function parseReply(response: Response, rpcId: string): Promise<ControlReply> {
  let value: unknown
  try {
    value = await response.json()
  } catch (error: unknown) {
    throw new Error(`DSH control route returned invalid JSON with HTTP ${String(response.status)}`, { cause: error })
  }
  if (!isRecord(value) || value.type !== 'server-response' || value.rpcId !== rpcId || !isRecord(value.result)) {
    throw new Error('DSH control route returned an invalid reply')
  }
  const result = value.result
  if (result.ok === true) return { ok: true, value: result.value }
  const error = result.error
  if (!isRecord(error) || typeof error.code !== 'string' || typeof error.message !== 'string') {
    throw new Error('DSH control route returned an invalid failure')
  }
  return { ok: false, error: { code: error.code, message: error.message } }
}

function loopbackOrigin(input: string): URL {
  const url = new URL(input)
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
  if (url.protocol !== 'http:' || !loopback || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error('origin must use HTTP on a loopback host with no path, query, or credentials')
  }
  return url
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

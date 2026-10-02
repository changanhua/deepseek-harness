import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import * as observer from './fixtures/acceptance-observer.mjs'
import { createTransportGuard } from './fixtures/acceptance-transport.mjs'
import type { AdmittedRequest } from './fixtures/acceptance-transport.mjs'

type StreamHandler = (options: unknown, next: () => AsyncIterable<unknown>) => AsyncIterable<unknown>

it('rejects over-budget inputs before dispatch and retains the request count across observer restart', async () => {
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'dsh-initiative-admission-'))
  const config = { cwd: evidenceRoot, evidenceRoot, provider: 'fixture', model: 'fixture', maxRequests: 5,
    mode: 'keyless', endpoint: 'http://127.0.0.1:1', maxInputBytes: 65536, maxOutputTokens: 8000 }
  const disposals: Array<() => void> = []
  const install = async () => {
    const handlers = new Map<string, StreamHandler>()
    let guard: ((exec: { name: string }) => string | undefined) | undefined
    await observer.apply({ workspaceRegistry: { create: async () => {} },
      tools: { guard: (value: typeof guard) => { guard = value } },
      effect: (value: () => () => void) => { disposals.push(value()) },
      on: (name: string, value: StreamHandler) => { handlers.set(name, value) }, provide: () => {} }, config)
    return { stream: handlers.get('llm/stream')!, guard: guard! }
  }
  let dispatches = 0
  async function* next() { dispatches++; yield { type: 'finish', reason: { kind: 'stop' } } }
  const drain = async (stream: StreamHandler, options: unknown) => {
    for await (const _chunk of stream(options, next)) { /* consume the complete bounded stream */ }
  }
  const input = { provider: 'fixture', model: 'fixture', tools: [], maxTokens: 8000 }
  try {
    const first = await install()
    expect(first.guard({ name: 'initiative_record' })).toBeUndefined()
    expect(first.guard({ name: 'bash' })).toBeDefined()
    await expect(drain(first.stream, { ...input, maxTokens: 8001 })).rejects.toThrow('admission bound')
    await expect(drain(first.stream, { ...input, maxTokens: undefined })).rejects.toThrow('admission bound')
    await expect(drain(first.stream, { ...input, system: 'x'.repeat(65536) })).rejects.toThrow('admission bound')
    expect(dispatches).toBe(0)
    await drain(first.stream, input)
    await expect(drain(first.stream, input)).rejects.toThrow('admission bound')
    const restarted = await install()
    await expect(drain(restarted.stream, input)).rejects.toThrow('admission bound')
    expect(dispatches).toBe(1)
  } finally { for (const dispose of disposals.reverse()) dispose() }
})

it('bounds actual UTF-8 HTTP bodies, transport retries and persisted attempts before any request', async () => {
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'dsh-initiative-transport-'))
  const config = { evidenceRoot, endpoint: 'http://127.0.0.1:1', model: 'fixture' }
  let calls = 0
  const upstream = async () => { calls++; return new Response('{}', { status: calls === 1 ? 500 : 200 }) }
  const guard = await createTransportGuard(config, upstream)
  const candidate: AdmittedRequest = { phase: 'candidate', ordinal: 1 }
  const assessment: AdmittedRequest = { phase: 'assessment', ordinal: 2 }
  const body = { model: 'fixture', thinking: { type: 'disabled' }, max_tokens: 4096, messages: [] }
  const send = (logical: AdmittedRequest, value = body, target = `${config.endpoint}/chat/completions`) =>
    guard.withRequest(logical, () => guard.fetch(target, { method: 'POST', body: JSON.stringify(value) }))
  await expect(guard.fetch(`${config.endpoint}/chat/completions`, { method: 'POST', body: JSON.stringify(body) })).rejects.toThrow('unadmitted')
  await expect(send(candidate, body, 'https://api.deepseek.com/chat/completions')).rejects.toThrow('unadmitted')
  await expect(send(candidate, { ...body, max_tokens: 4097 })).rejects.toThrow('admission bound')
  await expect(send(candidate, { ...body, messages: ['汉'.repeat(30000)] } as unknown as typeof body)).rejects.toThrow('admission bound')
  expect(calls).toBe(0)
  // A failure plus three internal retry attempts consume the entire Candidate allocation.
  for (let index = 0; index < 4; index++) await send(candidate)
  await expect(send(candidate)).rejects.toThrow('admission bound')
  await send(assessment, { ...body, max_tokens: 8000 })
  await expect(send(assessment, { ...body, max_tokens: 8000 })).rejects.toThrow('admission bound')
  expect(calls).toBe(5)
  const restarted = await createTransportGuard(config, upstream)
  await expect(restarted.withRequest(assessment, () => restarted.fetch(`${config.endpoint}/chat/completions`,
    { method: 'POST', body: JSON.stringify(body) }))).rejects.toThrow('admission bound')
  expect(calls).toBe(5)
})

it('fails closed at the controller entry without approval, credentials or an isolated keyless route', async () => {
  const { runAcceptance } = await import('./fixtures/acceptance-scenario.ts')
  await expect(runAcceptance('unused', {}, 'paid')).rejects.toThrow('explicit approval')
  await expect(runAcceptance('unused', { DSH_INITIATIVE_REAL_ACCEPTANCE: 'approved' }, 'paid')).rejects.toThrow('credential')
  await expect(runAcceptance('unused', { DEEPSEEK_API_KEY: 'fixture' }, 'paid')).rejects.toThrow('explicit approval')
  await expect(runAcceptance('unused', { DEEPSEEK_API_KEY: 'keyless-fixture-only' }, 'keyless')).rejects.toThrow('loopback fixture')
})

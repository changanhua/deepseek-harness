import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createTransportGuard } from './acceptance-transport.mjs'

export const name = 'initiative-acceptance-observer'
export const inject = ['llm', 'tools', 'commands', 'sessions', 'workspaceRegistry', 'initiative', 'planning', 'requirementAssessment']

// Test-only controller entry: never installed in a shipped profile or exposed as a Tool.
export async function apply(ctx, config) {
  try { return await install(ctx, config) }
  catch (error) { await writeFile(join(config.evidenceRoot, 'observer-error.txt'), String(error.stack)); throw error }
}

async function install(ctx, config) {
  if (config.mode === 'paid' && (process.env.DSH_INITIATIVE_REAL_ACCEPTANCE !== 'approved' || !process.env.DEEPSEEK_API_KEY?.trim()))
    throw new Error('Real-provider observer requires explicit approval and credential')
  if (config.mode === 'paid' ? config.endpoint !== 'https://api.deepseek.com'
    : config.mode !== 'keyless' || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(config.endpoint))
    throw new Error('Acceptance observer denies unapproved route')
  await mkdir(config.evidenceRoot, { recursive: true })
  await ctx.workspaceRegistry.create(config.cwd)
  const originalFetch = globalThis.fetch
  const transport = await createTransportGuard(config, originalFetch)
  globalThis.fetch = transport.fetch
  ctx.effect(() => () => { if (globalThis.fetch === transport.fetch) globalThis.fetch = originalFetch })
  const requestPath = join(config.evidenceRoot, 'requests.json')
  let requests = []
  try { requests = JSON.parse(await readFile(requestPath, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const allowed = new Set(['initiative_read', 'initiative_record'])
  try { ctx.tools.guard(exec => allowed.has(exec.name) ? undefined : 'Acceptance permits Candidate read and record only') }
  catch (error) { await writeFile(join(config.evidenceRoot, 'observer-error.txt'), String(error.stack)); throw error }
  ctx.on('agent/session-start', ({ agent }) => {
    try { agent.ctx.tools.restrict({ allow: [...allowed] }) }
    catch (error) { void writeFile(join(config.evidenceRoot, 'observer-error.txt'), String(error.stack)); throw error }
  })
  ctx.on('llm/stream', async function* (options, next) {
    if (options.provider !== config.provider || options.model !== config.model) throw new Error('Acceptance route mismatch')
    const material = JSON.stringify({ ...options, signal: undefined })
    const bytes = Buffer.byteLength(material, 'utf8')
    const tools = options.tools ?? []
    const phase = tools.length === 0 ? 'assessment' : 'candidate'
    const phaseLimit = phase === 'candidate' ? (config.maxCandidateRequests ?? 4) : 1
    const outputLimit = phase === 'candidate' ? 4096 : config.maxOutputTokens
    if (requests.length >= config.maxRequests || requests.filter(value => value.phase === phase).length >= phaseLimit
      || bytes > config.maxInputBytes || !Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1 || options.maxTokens > outputLimit)
      throw new Error('Acceptance request admission bound exceeded')
    const request = { ordinal: requests.length + 1, phase, provider: options.provider, model: options.model,
      inputBytes: bytes, maxTokens: options.maxTokens, startedAt: new Date().toISOString(),
      inputSha256: createHash('sha256').update(material).digest('hex'),
      backendIdentity: 'unavailable: this adapter does not expose provider response model identity',
      toolNames: tools.map(tool => tool.name), status: 'started' }
    requests.push(request)
    await writeFile(join(config.evidenceRoot, `request-${request.ordinal}.json`), material)
    await writeFile(requestPath, JSON.stringify(requests, null, 2))
    let iterator
    try {
      iterator = next()[Symbol.asyncIterator]()
      while (true) {
        const part = await transport.withRequest(request, () => iterator.next())
        if (part.done) break
        const chunk = part.value
        if (chunk.type === 'usage') request.usage = chunk.usage
        if (chunk.type === 'finish') {
          request.finishKind = chunk.reason.kind
          request.status = chunk.reason.kind === 'stop' || chunk.reason.kind === 'tool-calls' ? 'completed' : 'failed'
          if (chunk.reason.failure) request.failureCode = chunk.reason.failure.code
        }
        yield chunk
      }
    } catch (error) { request.status = 'failed'; request.failureCode = error.code ?? error.name; throw error }
    finally {
      try { if (iterator?.return) await transport.withRequest(request, () => iterator.return()) }
      finally {
        if (request.status === 'started') request.status = 'incomplete'
        request.endedAt = new Date().toISOString()
        await writeFile(requestPath, JSON.stringify(requests, null, 2))
      }
    }
  }, { prepend: true })
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    if (messages.length !== 1 || messages[0].source.kind !== 'user') return next()
    const content = messages[0].content
    if (content.length !== 1 || content[0].type !== 'text' || !content[0].text.startsWith('/initiative ')) return next()
    const execution = await ctx.commands.execute(agent, content[0].text, [], signal)
    await ctx.sessions.flush(agent.session)
    await writeFile(join(config.evidenceRoot, 'command-result.json'), JSON.stringify({ input: content[0].text, ...execution }))
    return { kind: 'reject' }
  }, { prepend: true })
  ctx.provide('initiativeAcceptanceReady', true)
}

import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Fixture-only monotonic gate at the actual adapter HTTP boundary, including hidden retries.
export async function createTransportGuard(config, upstream = globalThis.fetch) {
  const active = new AsyncLocalStorage()
  const ledgerPath = join(config.evidenceRoot, 'http-attempts.json')
  let attempts = []
  try { attempts = JSON.parse(await readFile(ledgerPath, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!Array.isArray(attempts)) throw new Error('Invalid transport ledger')
  let tail = Promise.resolve()
  const persist = () => {
    const snapshot = JSON.stringify(attempts, null, 2)
    const write = tail.then(() => writeFile(ledgerPath, snapshot))
    tail = write.catch(() => {})
    return write
  }
  const guardedFetch = async (url, init) => {
    const logical = active.getStore()
    if (!logical || String(url) !== `${config.endpoint}/chat/completions` || init?.method !== 'POST' || typeof init.body !== 'string')
      throw new Error('Acceptance denies unadmitted HTTP transport')
    init.signal?.throwIfAborted()
    const bytes = Buffer.byteLength(init.body, 'utf8')
    const body = JSON.parse(init.body)
    const phaseLimit = logical.phase === 'candidate' ? (config.maxCandidateRequests ?? 4) : 1
    const outputLimit = logical.phase === 'candidate' ? 4096 : 8000
    if (attempts.length >= (config.maxRequests ?? 5) || attempts.filter(value => value.phase === logical.phase).length >= phaseLimit
      || bytes > 65536 || body.model !== config.model || body.thinking?.type !== 'disabled'
      || !Number.isSafeInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > outputLimit)
      throw new Error('Acceptance HTTP admission bound exceeded')
    const attempt = { ordinal: attempts.length + 1, logicalOrdinal: logical.ordinal, phase: logical.phase,
      inputBytes: bytes, inputSha256: createHash('sha256').update(init.body).digest('hex'),
      model: body.model, maxTokens: body.max_tokens, status: 'started', startedAt: new Date().toISOString() }
    attempts.push(attempt)
    await writeFile(join(config.evidenceRoot, `http-body-${attempt.ordinal}.json`), init.body)
    await persist() // A durable conservative reservation precedes any provider request.
    init.signal?.throwIfAborted()
    try {
      const response = await upstream(url, { ...init, redirect: 'error' })
      attempt.status = response.ok ? 'response-received' : 'http-error'
      attempt.httpStatus = response.status
      return response
    } catch (error) { attempt.status = 'failed'; attempt.failureCode = error.code ?? error.name; throw error }
    finally { attempt.endedAt = new Date().toISOString(); await persist() }
  }
  return { fetch: guardedFetch, withRequest: (request, action) => active.run(request, action) }
}

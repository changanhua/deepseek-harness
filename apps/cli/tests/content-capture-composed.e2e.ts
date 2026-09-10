/** Composed P1c validation: real Connection + Gateway + Session + Content capture over HTTP. */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

const root = resolve(import.meta.dirname, '../../..')
const builtBin = resolve(root, 'apps/cli/lib/bin.js')
const lib = (group: string, name: string): string => resolve(root, 'packages', group, name, 'lib/index.js')
const builtContentDomain = lib('content', 'content-domain')
const builtContentSession = lib('content', 'content-session')
const builtContentRemote = lib('content', 'content-remote')
const builtStorageSqlite = lib('storage', 'storage-sqlite')
const builtConnection = lib('client', 'connection')
const builtGateway = lib('api', 'gateway')
const builtTypertRegistry = lib('typert', 'registry')
const probeFixture = pathToFileURL(resolve(import.meta.dirname, 'fixtures/content-capture-probe.mjs')).href
const timeoutMs = 90_000

// The composed web profile mounts these node libraries directly; a missing
// bundle otherwise surfaces as an opaque host load failure after spawn, so
// the test fails with the build command before starting any server.
const requiredLibraries = [builtBin, builtConnection, builtGateway, builtTypertRegistry, builtStorageSqlite,
  builtContentDomain, builtContentSession, builtContentRemote]

interface RunningWeb {
  readonly child: ChildProcess
  readonly launchUrl: string
  readonly output: () => string
}

interface HttpResult {
  readonly status: number
  readonly body: string
}

interface SeedResult {
  readonly seeded: boolean
  readonly sessionId?: string
  readonly messageId?: string
}

interface CaptureReceipt {
  readonly operationId: string
  readonly entryId: string
  readonly entryRevision: number
  readonly draftRevision: number | null
  readonly versionId: string | null
}

/** The shipped web composition already mounts the content stack; the overlay injects only the capture probe. */
async function seedComposition(dshHome: string): Promise<string> {
  const patchFile = join(dshHome, 'content-capture.patch.yml')
  await writeFile(patchFile, [
    '- insert:',
    '    - id: content-capture-probe',
    `      name: ${probeFixture}`,
    '',
  ].join('\n'))
  return patchFile
}

function compositionEnvironment(dshHome: string, seed: boolean): NodeJS.ProcessEnv {
  return {
    DSH_AGENTS_HOME: join(root, '.agents'),
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: '1',
    ...(seed ? { DSH_CAPTURE_PROBE_PHASE: 'seed', DSH_CAPTURE_PROBE_RESULT: join(dshHome, 'capture-seed.json') } : {}),
  }
}

async function startWeb(dshHome: string, port: number, patchFile: string, seed: boolean): Promise<RunningWeb> {
  const launch = resolveExampleLaunch({
    srcBin: resolve(root, 'apps/cli/src/bin.ts'),
    libBin: builtBin,
    configArgs: ['web', '--patch', patchFile, '--no-open', '--port', String(port)],
    mode: 'lib',
    env: compositionEnvironment(dshHome, seed),
  })
  const child = spawn(launch.command, launch.args, {
    cwd: root,
    env: { ...scrubbedParentEnv(), ...launch.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  const launchUrl = await new Promise<string>((resolveUrl, fail) => {
    let settled = false
    const finish = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fail(error)
    }
    const timer = setTimeout(() => {
      finish(new Error(`composed web did not become ready:\n${output.slice(-4000)}`))
    }, timeoutMs)
    const append = (chunk: Buffer | string): void => {
      output = `${output}${String(chunk)}`.slice(-100_000)
      const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
      if (!settled && match?.[1] !== undefined) {
        settled = true
        clearTimeout(timer)
        resolveUrl(match[1])
      }
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.once('error', finish)
    child.once('exit', (code) => {
      finish(new Error(`composed web exited before readiness (${String(code)}):\n${output.slice(-4000)}`))
    })
  })
  return { child, launchUrl, output: () => output }
}

async function stopWeb(running: RunningWeb): Promise<void> {
  if (running.child.exitCode !== null) return
  const exited = new Promise<void>((resolveExit) => { running.child.once('exit', () => { resolveExit() }) })
  running.child.kill('SIGTERM')
  const forced = setTimeout(() => { running.child.kill('SIGKILL') }, 10_000)
  forced.unref()
  await exited
}

async function waitForSeed(dshHome: string): Promise<SeedResult> {
  const seedFile = join(dshHome, 'capture-seed.json')
  const deadline = Date.now() + 30_000
  for (;;) {
    if (existsSync(seedFile)) {
      const parsed = JSON.parse(await readFile(seedFile, 'utf8')) as SeedResult
      if (parsed.seeded && parsed.sessionId !== undefined && parsed.messageId !== undefined) return parsed
    }
    if (Date.now() >= deadline) throw new Error('capture probe never wrote its seed result')
    await new Promise(resolveSeed => setTimeout(resolveSeed, 50))
  }
}

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) resolveClose()
      else rejectClose(error)
    })
  })
  return port
}

function post(port: number, host: string, endpoint: string, payload: unknown, cookie?: string): Promise<HttpResult> {
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: 'composed-capture',
    method: endpoint,
    payload,
  })
  return new Promise((resolveRequest, rejectRequest) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/${endpoint}`,
      method: 'POST',
      headers: {
        host,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...cookie === undefined ? {} : { cookie },
      },
    }, (res) => {
      const chunks: Uint8Array[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => {
        resolveRequest({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.once('error', rejectRequest)
    req.end(body)
  })
}

type RemoteOutcome = { readonly value: unknown } | { readonly code: string }

/** Poll the authenticated status read until the content medium settles. */
async function waitForReady(port: number, host: string, cookie: string): Promise<void> {
  let last: RemoteOutcome = { code: 'timeout' }
  for (let i = 0; i < 100; i += 1) {
    last = await call(port, host, cookie, 'contentRemote/status', { args: {} })
    const phase = ('value' in last ? (last.value as { phase?: string } | undefined)?.phase : undefined)
    if (phase === 'ready' || phase === 'unavailable' || 'code' in last) break
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  if (!('value' in last) || (last.value as { phase: string }).phase !== 'ready') {
    throw new Error(`content did not become ready: ${JSON.stringify(last).slice(0, 300)}`)
  }
}

async function call(port: number, host: string, cookie: string, endpoint: string, payload: unknown): Promise<RemoteOutcome> {
  const response = await post(port, host, endpoint, payload, cookie)
  expect(response.status).toBe(200)
  const parsed = JSON.parse(response.body) as {
    type: string
    result?: { ok: true; value: unknown } | { ok: false; error?: { code?: string } }
  }
  expect(parsed.type).toBe('server-response')
  if (parsed.result === undefined) throw new Error(`composed call lost its result: ${response.body.slice(0, 400)}`)
  if (parsed.result.ok) return { value: parsed.result.value }
  return { code: parsed.result.error?.code ?? JSON.stringify(parsed.result).slice(0, 400) }
}

describe.skipIf(!existsSync(builtBin) || !existsSync(builtContentRemote))
('composed human Content capture over the real web stack', () => {
  it('captures a completed Session reply through an authenticated browser request and survives a restart', { timeout: timeoutMs * 2 + 40_000 }, async () => {
    const missingLibraries = requiredLibraries.filter(path => !existsSync(path))
    if (missingLibraries.length > 0) {
      throw new Error(`composed capture validation is missing built libraries (${missingLibraries.join(', ')}). Run \`pnpm run build:lib\` first.`)
    }
    const dshHome = await mkdtemp(join(process.platform === 'win32' ? homedir() : tmpdir(), 'dsh-content-capture-composed-'))
    const patchFile = await seedComposition(dshHome)
    const port = await reservePort()
    let first: RunningWeb | undefined
    let second: RunningWeb | undefined
    try {
      first = await startWeb(dshHome, port, patchFile, true)
      const firstUrl = new URL(first.launchUrl)

      // Real browser login: the token exchange sets the persistent cookie.
      const exchange = await fetch(first.launchUrl, { redirect: 'manual' })
      expect(exchange.status).toBe(303)
      const setCookie = exchange.headers.get('set-cookie')
      if (setCookie === null) throw new Error('composed web omitted Set-Cookie')
      const cookie = setCookie.split(';', 1)[0]!

      // An unauthenticated request is refused before any content is touched.
      expect((await post(port, firstUrl.host, 'contentRemote/status', {})).status).toBe(401)

      const seed = await waitForSeed(dshHome)
      expect(seed.sessionId).toBeDefined()
      expect(seed.messageId).toBeDefined()

      // An authenticated read through the same fence must succeed first; the
      // content medium opens asynchronously, so poll until it settles.
      await waitForReady(port, firstUrl.host, cookie)

      const operationId = 'capture-composed-0001'
      const captured = await call(port, firstUrl.host, cookie, 'contentRemote/capture', {
        args: { input: { operationId, sessionId: seed.sessionId, messageId: seed.messageId } },
      })
      if (!('value' in captured)) throw new Error(`capture failed: ${captured.code}`)
      const receipt = captured.value as CaptureReceipt
      expect(receipt).toMatchObject({ operationId, entryRevision: 1, draftRevision: null })
      expect(receipt.entryId).toMatch(/^source_/u)
      expect(typeof receipt.versionId).toBe('string')

      // The same operationId replays the stored receipt.
      expect(await call(port, firstUrl.host, cookie, 'contentRemote/capture', {
        args: { input: { operationId, sessionId: seed.sessionId, messageId: seed.messageId } },
      })).toEqual({ value: receipt })

      // A new operationId over the same source returns the canonical creation receipt.
      expect(await call(port, firstUrl.host, cookie, 'contentRemote/capture', {
        args: { input: { operationId: 'capture-composed-0002', sessionId: seed.sessionId, messageId: seed.messageId } },
      })).toEqual({ value: receipt })

      // A forged authority field never reaches Content: the wire descriptor
      // strips it, and the source idempotency answer is unchanged.
      expect(await call(port, firstUrl.host, cookie, 'contentRemote/capture', {
        args: { input: { operationId: 'capture-composed-0003', sessionId: seed.sessionId, messageId: seed.messageId, isHuman: true } },
      })).toEqual({ value: receipt })

      // A payload the wire accepts but the domain schema rejects settles as
      // invalid_request without touching the library.
      expect(await call(port, firstUrl.host, cookie, 'contentRemote/capture', {
        args: { input: { operationId: 'capture-composed-0004', sessionId: seed.sessionId, messageId: '' } },
      })).toEqual({ code: 'invalid_request' })

      await stopWeb(first)
      first = undefined

      second = await startWeb(dshHome, port, patchFile, false)
      const secondUrl = new URL(second.launchUrl)

      await waitForReady(port, secondUrl.host, cookie)

      expect(await call(port, secondUrl.host, cookie, 'contentRemote/receipt', {
        args: { entryId: receipt.entryId, operationId },
      })).toEqual({ value: receipt })

      const entry = await call(port, secondUrl.host, cookie, 'contentRemote/get', {
        args: { entryId: receipt.entryId },
      })
      if (!('value' in entry)) throw new Error(`get failed: ${entry.code}`)
      expect(entry.value).toMatchObject({
        source: { type: 'session-message' },
        versions: [{ body: '组合验证捕获的纯文本回复' }],
      })
    } catch (error) {
      const evidence = [first?.output(), second?.output()].filter(value => value !== undefined).join('\n')
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${evidence.slice(-4000)}`, { cause: error })
    } finally {
      if (second !== undefined) await stopWeb(second)
      if (first !== undefined) await stopWeb(first)
      await rm(dshHome, { recursive: true, force: true })
    }
  })
})

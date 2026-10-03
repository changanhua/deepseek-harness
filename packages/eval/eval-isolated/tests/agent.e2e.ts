import { openSync, closeSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { expect, test } from 'vitest'
import { WindowsRoleBoundary } from '../src/windows.ts'
import type { WindowsRoleProcess } from '../src/windows.ts'
import { observeVolumeMapping } from '../src/path-adapter.ts'
import { RoleChannel } from '../src/channel.ts'
import { superviseRoleProcess } from '../src/controller.ts'
import { createGuardedModelBroker } from '../src/broker.ts'
import { createRoleObserver } from '../src/observer.ts'
import LocalBudget from '../../../budget/budget-local/src/index.ts'
import * as BudgetBridge from '../../../budget/budget-llm/src/index.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { stageProfileFixture } from './runtime-fixture.ts'

test.skipIf(process.platform !== 'win32' || process.arch !== 'x64').each([false, true])('runs and gracefully closes a real isolated Agent: canceled=%s', async (cancel) => {
  const root = await mkdtemp(join(tmpdir(), 'eval-agent-boundary-'))
  const runtime = join(root, 'runtime'), home = join(root, 'home'), data = join(home, 'data'), broker = join(data, 'broker')
  await mkdir(broker, { recursive: true })
  const boundary = WindowsRoleBoundary.create(`dsh.eval.test.${randomUUID()}`)
  const channel = await RoleChannel.create(broker, 1024 * 1024)
  const descriptors: number[] = []
  let child: WindowsRoleProcess | undefined
  const ctx = new Context(), backend = new MemoryStorageBackend()
  const cancellation = new AbortController()
  let requests = 0
  const server = createServer((_request, response) => { requests++; if (cancel) cancellation.abort(); response.end('READY') })
  try {
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing address')
    const endpoint = `http://127.0.0.1:${address.port}`
    class Adapter extends LlmAdapter {
      async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        const text = await (await fetch(endpoint, { signal: options.signal ?? null })).text()
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', { guarantees: ['single-writer', 'commit-sync', 'private-root'], kv: backend.kv, close: () => backend.close() })
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['host-broker'], new Adapter())
    await ctx.plugin(LocalBudget, { maxScopes: 8, maxReservations: 32, maxLedgerBytes: 128 * 1024 })
    await ctx.plugin(BudgetBridge)
    const scope = await ctx.budget.createScope({ id: 'eval-budget', kind: 'session', subjectId: 'eval-subject', parentId: null,
      limits: { requests: 1, inputTokens: 5000, outputTokens: 100, totalTokens: 5100, wallTimeMs: 60000 }, onExhausted: 'deny' }, () => {})
    const packages = ['@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-agent-presets', '@deepseek-ai/dsh-skill',
      '@deepseek-ai/dsh-session-persistence-jsonl', '@changanhua/dsh-eval']
    const launched = await stageProfileFixture(runtime, home, '', packages)
    const presetRoot = join(runtime, 'presets'), preset = join(presetRoot, 'eval-minimal')
    await mkdir(preset, { recursive: true })
    const composition = '[]\n'
    const route = { id: 'route', provider: 'host-broker', model: 'fixture', parameters: { maxTokens: 32 },
      preset: { id: 'eval-minimal', source: 'preset:system', digest: createHash('sha256').update(composition).digest('hex') } }
    await writeFile(join(preset, 'agent.cordis.yml'), composition)
    const profile = join(home, 'profiles/eval-fixture')
    const rows = [
      { id: 'llm', name: '@deepseek-ai/dsh-llm' },
      { id: 'sessions', name: '@deepseek-ai/dsh-session' },
      { id: 'projections', name: '@deepseek-ai/dsh-session-projection' },
      { id: 'prompt', name: '@deepseek-ai/dsh-system-prompt' },
      { id: 'tools', name: '@deepseek-ai/dsh-tools', config: { mode: 'native' } },
      { id: 'agents', name: '@deepseek-ai/dsh-agent' },
      { id: 'loop', name: '@deepseek-ai/dsh-agent-loop', config: { agents: [] } },
      { id: 'skills', name: '@deepseek-ai/dsh-skill' },
      { id: 'persistence', name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(data, 'sessions'), compression: 'none' } },
      { id: 'presets', name: '@deepseek-ai/dsh-agent-presets', config: { default: 'eval-minimal', includeShippedRoot: false,
        includeUserRoot: false, roots: [{ path: presetRoot, trust: 'system' }] } },
      { id: 'worker', name: pathToFileURL(join(runtime, 'worker.js')).href, config: { channelDirectory: broker,
        maxFrameBytes: 1024 * 1024, timeoutMs: 15_000, cleanupTimeoutMs: 5000, sessionId: 'eval-subject', prompt: 'Reply with exactly READY.',
        route } },
    ]
    await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: rows }]))
    await boundary.grant(runtime, false)
    await boundary.grant(home, true)
    await boundary.grant(data, true)
    const output = join(root, 'stdout'), error = join(root, 'stderr'), input = join(root, 'input')
    const observer = createRoleObserver(randomUUID(), 'eval-subject')
    await writeFile(input, observer.bootstrap)
    const stdio = { stdin: openSync(input, 'r'), stdout: openSync(output, 'wx'), stderr: openSync(error, 'wx') }
    descriptors.push(...Object.values(stdio))
    child = boundary.launch({ kind: 'core', executable: launched.executable, args: ['--preserve-symlinks', '--preserve-symlinks-main',
      '--import', pathToFileURL(launched.startup).href, launched.entrypoint, '--profile', 'eval-fixture'], cwd: data,
    env: { SystemRoot: process.env.SystemRoot!, LOCALAPPDATA: data, TEMP: data, TMP: data, USERPROFILE: home,
      DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_EVAL_VOLUME_MAP: JSON.stringify(observeVolumeMapping(root.slice(0, 2))) }, stdio })
    const supervised = await superviseRoleProcess(child, channel, { sessionId: 'eval-subject', maxRequests: 8, observer,
      ready: async () => {
        await writeFile(input, '')
        expect(await readFile(input, 'utf8')).toBe('')
        await boundary.grant(home, false)
      },
      model: createGuardedModelBroker(ctx, { route, budget: scope.reference, sessionId: 'eval-subject',
        maxResponseBytes: 8192, maxAttempts: 2 }) }, { executionMs: 20_000, graceMs: 5000, stopMs: 10_000 }, cancellation.signal)
    expect(supervised, await readFile(error, 'utf8')).toMatchObject({ status: cancel ? 'uncertain' : 'reported', quiescent: true, exitCode: 0 })
    const protocol = supervised.protocol!
    expect(requests).toBe(1)
    expect(protocol.accounting).toMatchObject([{ status: cancel ? 'uncertain' : 'settled', evidence: [{ dispatched: true,
      reservation: { phase: cancel ? 'unknown' : 'settled' } }] }])
    expect(protocol.rawReports.complete).toMatchObject({ sessionId: 'eval-subject', canceled: cancel, flushed: true })
    expect(protocol.rawReports.complete).toMatchObject({ trace: expect.arrayContaining([
      expect.objectContaining({ type: 'turn/end' }) as unknown,
    ]) as unknown, environment: { platform: 'win32', arch: 'x64' } })
    if (!cancel) expect(protocol.rawReports.complete).toMatchObject({ output: 'READY', reason: { kind: 'completed' } })
    const files = await readdir(join(data, 'sessions'), { recursive: true })
    const log = files.find(file => file.endsWith('.jsonl'))
    expect(log).toBeDefined()
    const persisted = await readFile(join(data, 'sessions', log!), 'utf8')
    if (cancel) expect(persisted.split('\n').filter(Boolean).map(line => JSON.parse(line) as unknown)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'parent' } } } })]))
    else expect(persisted).toContain('READY')
  } finally {
    if (child) { child.terminate(); await child.wait(10_000) }
    await channel.close()
    for (const fd of descriptors) closeSync(fd)
    boundary.close()
    await ctx.fiber.dispose()
    await backend.close()
    await new Promise<void>((resolve, reject) => { server.close((error) =>{  if (error) reject(error); else resolve() }) })
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

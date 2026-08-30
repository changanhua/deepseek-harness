import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalDelivery from '@deepseek-ai/dsh-delivery-local'
import LocalDeliveryEvidence from '@deepseek-ai/dsh-delivery-evidence-local'
import DeliveryRemote from '@deepseek-ai/dsh-delivery-remote'
import * as DeliveryTaskQueue from '@deepseek-ai/dsh-delivery-task-queue'
import GitLocalRepositoryWorkspace from '@deepseek-ai/dsh-repo-workspace-git-local'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import {
  createVerifiedOperatorAuthority,
} from '@deepseek-ai/dsh-task-queue'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import LocalTaskQueue from '@deepseek-ai/dsh-task-queue-local'
import { describe, expect, it, vi } from 'vitest'

// The controlled app-server boundary is deliberately the only fake.  Queue,
// Delivery, Evidence, Git and Remote are all the production providers.
let runnerPath = 'src/accepted.txt'
let runnerMode: 'complete' | 'hang' | 'cleanup' | 'no-checkpoint' = 'complete'
let runnerDisposed = 0
let runnerChild: import('node:child_process').ChildProcess | undefined
const runnerCwds: string[] = []
vi.mock('@deepseek-ai/dsh-subagent-codex/app-server-run', async () => ({
  CODEX_APP_SERVER_PERMISSION_MODES: ['never'],
  async startCodexAppServerRun(request: { readonly cwd: string; readonly signal: AbortSignal }) {
    runnerCwds.push(request.cwd)
    const childProcess = await import('node:child_process')
    runnerChild = childProcess.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    await mkdir(join(request.cwd, runnerPath.includes('/') ? runnerPath.slice(0, runnerPath.lastIndexOf('/')) : '.'), { recursive: true })
    await writeFile(join(request.cwd, runnerPath), 'controlled\n')
    const mode: string = runnerMode
    let result
    if (mode === 'hang') {
      result = new Promise((resolve) => {
        request.signal.addEventListener('abort', () => {
          resolve({ stopReason: 'aborted', output: [] })
        }, { once: true })
      })
    } else {
      result = Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: JSON.stringify(mode === 'no-checkpoint' ? { disposition: 'blocked', summary: 'blocked', completedWork: [], remainingWork: ['checkpoint required'], blocker: 'no checkpoint', nextSmallestAction: 'checkpoint' } : { disposition: 'completed', summary: 'controlled change', completedWork: ['controlled'], remainingWork: [] }) }] })
    }
    return { result, async dispose() { runnerDisposed++; runnerChild?.kill(); await new Promise(resolve => runnerChild?.once('exit', resolve)); if (mode === 'cleanup') throw new Error('controlled cleanup uncertainty') } }
  },
}))

const run = promisify(execFile)
const bundleRoot = join(import.meta.dirname, '..')
const uiDeliveryHost = { apply(): void {} }

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for Queue state')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function git(directory: string, ...args: string[]): Promise<string> {
  return (await run('git', ['-C', directory, ...args])).stdout.trim()
}

async function repositoryFixture(temp: string): Promise<{ repository: string; commit: string }> {
  const repository = join(temp, 'repository')
  await mkdir(repository)
  await git(repository, 'init', '--initial-branch=main')
  await git(repository, 'config', 'user.email', 'acceptance@example.test')
  await git(repository, 'config', 'user.name', 'Acceptance')
  await writeFile(join(repository, 'README.md'), 'control checkout\n')
  await git(repository, 'add', '.')
  await git(repository, 'commit', '-m', 'base')
  return { repository, commit: await git(repository, 'rev-parse', 'HEAD') }
}

async function bootDelivery(temp: string, repository: string): Promise<Context> {
  const configPath = join(temp, 'cordis.yml')
  const patch = (await readFile(join(bundleRoot, 'cordis.patch.yml'), 'utf8'))
    .replace("!!js dshHomePath('personal-delivery/evidence')", JSON.stringify(join(temp, 'evidence')))
    .replace('!!js process.cwd()', JSON.stringify(repository))
    .replace("!!js dshHomePath('personal-delivery/worktrees')", JSON.stringify(join(temp, 'worktrees')))
    .replace(/^- insert:\r?\n/mu, '').replace(/^    /gmu, '')
  await writeFile(configPath, [
    "- { id: storage, name: '@deepseek-ai/dsh-storage' }",
    "- id: storage-json\n  name: '@deepseek-ai/dsh-storage-json'\n  config:\n    root: " + JSON.stringify(join(temp, 'storage')),
    "- id: storage-domain\n  name: '@deepseek-ai/dsh-storage-domain'\n  config:\n    backend: json",
    "- { id: subprocess, name: '@deepseek-ai/dsh-subprocess-local' }",
    "- id: task-queue\n  name: '@deepseek-ai/dsh-task-queue-local'\n  config:\n    queueRoot: " + JSON.stringify(join(temp, 'queue')) + '\n    maxConcurrent: 1\n    resourceCapacity:\n      agent-run: 1', patch,
  ].join('\n'))
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage], ['@deepseek-ai/dsh-storage-json', StorageJson], ['@deepseek-ai/dsh-storage-domain', StorageDomain], ['@deepseek-ai/dsh-subprocess-local', LocalSubprocess], ['@deepseek-ai/dsh-task-queue-local', LocalTaskQueue], ['@deepseek-ai/dsh-delivery-local', LocalDelivery], ['@deepseek-ai/dsh-delivery-evidence-local', LocalDeliveryEvidence], ['@deepseek-ai/dsh-repo-workspace-git-local', GitLocalRepositoryWorkspace], ['@deepseek-ai/dsh-delivery-task-queue', DeliveryTaskQueue], ['@deepseek-ai/dsh-delivery-remote', DeliveryRemote], ['@deepseek-ai/dsh-client-ui-delivery', uiDeliveryHost],
  ])
  const ctx = new Context(); ctx.baseUrl = pathToFileURL(temp).href + '/'
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string) { const value = modules.get(specifier); if (value === undefined) throw new Error(specifier); return value } } as never
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } }); await ctx.loader.await()
  return ctx
}

function brief(command = 'process.exit(0)') { return `<!-- dsh-delivery-work-brief@1 -->
\`\`\`yaml
format: dsh-delivery-work-brief@1
outcome: Controlled safety acceptance.
context: Real local providers with a controlled external Codex boundary.
allowedScope: [src/accepted.txt]
forbiddenScope: [outside]
acceptanceClauses: [{ id: accepted, text: controlled }]
openDecisions: []
baseSelectionRule: { kind: ref-head, ref: refs/heads/main }
verificationSource:
  kind: contract-field
  checks: [{ id: gate, name: gate, argv: [node, -e, "${command}"], cwd: ., timeoutMs: 5000, severity: required, expectedExitCodes: [0] }]
referenceLinks: []
\`\`\`` }

async function completeChain(temp: string, command = 'process.exit(0)', stopAfterChange = false, objective = 'controlled') {
  const { repository } = await repositoryFixture(temp); await mkdir(join(repository, 'src'))
  await writeFile(join(repository, 'src', 'base.txt'), 'base\n'); await git(repository, 'add', '.'); await git(repository, 'commit', '-m', 'source')
  const ctx = await bootDelivery(temp, repository)
  const remote = ctx.get('deliveryRemote') as unknown as { internals: { fetch: typeof fetch }; importIssue(a: unknown, s: AbortSignal): Promise<{ id: string }>; createPacket(a: unknown, s: AbortSignal): Promise<{ id: string }>; startChange(a: unknown, s: AbortSignal): Promise<{ id: string; queueWorkId: string }>; startVerification(a: unknown, s: AbortSignal): Promise<{ id: string; queueWorkId: string }>; recordDecision(a: unknown, s: AbortSignal): Promise<unknown> }
  remote.internals.fetch = vi.fn(async () => new Response(JSON.stringify({ number: 7, html_url: 'https://github.com/example/project/issues/7', repository_url: 'https://api.github.com/repos/example/project', updated_at: '2026-08-30T12:00:00.000Z', title: 'safety', body: brief(command) }), { headers: { 'content-type': 'application/json' } }))
  const signal = new AbortController().signal; const revision = await remote.importIssue({ issueUrl: 'https://github.com/example/project/issues/7', repositoryId: 'workspace' }, signal)
  const packet = await remote.createPacket({ contractRevisionId: revision.id, packet: { objective, allowedPaths: [{ kind: 'subtree', path: 'src' }], forbiddenPaths: [], acceptanceClauseIds: ['accepted'], stopConditions: ['stop'], executorPreference: { mode: 'required', executorId: 'codex' } } }, signal)
  const change = await remote.startChange({ packetId: packet.id, executorId: 'codex' }, signal); const operator = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
  if (stopAfterChange) return { ctx, remote, packet, change, verification: undefined as never, signal, evidence: join(temp, 'evidence', 'objects', 'sha256'), operator, repository }
  await waitFor(() => operator.get(change.queueWorkId as never).state.status === 'succeeded')
  const verification = await remote.startVerification({ packetId: packet.id, changeBindingId: change.id }, signal)
  await waitFor(() => ['succeeded', 'failed'].includes(operator.get(verification.queueWorkId as never).state.status))
  return { ctx, remote, packet, change, verification, signal, evidence: join(temp, 'evidence', 'objects', 'sha256'), operator, repository }
}

describe('Personal Delivery MVP safety acceptance', () => {
  it('4: bundle cancellation disposes the controlled child and records one canceled Delivery attempt', { timeout: 15_000 }, async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dsh-delivery-live-cancel-')); runnerMode = 'hang'; runnerDisposed = 0
    let chain: Awaited<ReturnType<typeof completeChain>> | undefined
    try {
      chain = await completeChain(temp, 'process.exit(0)', true)
      await waitFor(() => chain!.operator.get(chain!.change.queueWorkId as never).state.status === 'running')
      await waitFor(() => runnerChild !== undefined)
      await chain.operator.cancel(chain.change.queueWorkId as never)
      await waitFor(() => chain!.operator.get(chain!.change.queueWorkId as never).state.status === 'canceled')
      const view = chain.operator.get(chain.change.queueWorkId as never)
      expect(view.attempts).toHaveLength(1); expect(runnerDisposed).toBe(1)
      expect(runnerChild?.exitCode !== null || runnerChild?.signalCode !== null).toBe(true)
    } finally { runnerMode = 'complete'; await chain?.ctx.fiber.dispose(); await rm(temp, { recursive: true, force: true }) }
  })

  it('5: a real post-start cleanup uncertainty preserves the Attempt workspace and stays Attention after reboot', { timeout: 20_000 }, async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dsh-delivery-unknown-')); runnerMode = 'cleanup'; runnerCwds.length = 0
    let chain: Awaited<ReturnType<typeof completeChain>> | undefined
    let reopened: Context | undefined
    try {
      chain = await completeChain(temp, 'process.exit(0)', true)
      await waitFor(() => chain!.operator.get(chain!.change.queueWorkId as never).state.status === 'unknown')
      const view = chain.operator.get(chain.change.queueWorkId as never)
      expect(view.attempts).toHaveLength(1)
      expect(view.state.attemptCount).toBe(1)
      expect(chain.operator.pendingAttentions()).toHaveLength(1)
      expect(runnerCwds).toHaveLength(1)
      expect(existsSync(runnerCwds[0]!)).toBe(true)
      expect(await readFile(join(chain.repository, 'README.md'), 'utf8')).toBe('control checkout\n')

      await chain.ctx.fiber.dispose(); chain = undefined
      runnerMode = 'complete'
      reopened = await bootDelivery(temp, join(temp, 'repository'))
      const operator = reopened.taskQueue.forOperator(createVerifiedOperatorAuthority())
      const afterReboot = operator.get(view.work.id)
      expect(afterReboot.state.status).toBe('unknown')
      expect(afterReboot.attempts).toHaveLength(1)
      expect(operator.pendingAttentions()).toHaveLength(1)
      expect(runnerCwds).toHaveLength(1)
      expect(existsSync(runnerCwds[0]!)).toBe(true)
    } finally { runnerMode = 'complete'; await chain?.ctx.fiber.dispose(); await reopened?.fiber.dispose(); await rm(temp, { recursive: true, force: true }) }
  })

  it('6: a real blocked change claim without a checkpoint cannot create verification Work or binding', { timeout: 15_000 }, async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dsh-delivery-no-checkpoint-')); runnerMode = 'no-checkpoint'
    let chain: Awaited<ReturnType<typeof completeChain>> | undefined
    try {
      chain = await completeChain(temp, 'process.exit(0)', true)
      await waitFor(() => chain!.operator.get(chain!.change.queueWorkId as never).state.status === 'succeeded')
      expect(chain.operator.get(chain.change.queueWorkId as never).result).toMatchObject({ output: { completionClaim: { disposition: 'blocked', checkpointCommit: null } } })
      await expect(chain.remote.startVerification({
        packetId: chain.packet.id,
        changeBindingId: chain.change.id,
      }, chain.signal)).rejects.toMatchObject({
        failure: { details: { domainCode: 'change-output-invalid' } },
      })
      expect(chain.operator.list().filter(view => view.work.kind === 'code.verify@1')).toEqual([])
      expect(chain.ctx.delivery.snapshot().dispatchBindings.filter(binding => binding.kind === 'code.verify@1')).toEqual([])
    } finally { runnerMode = 'complete'; await chain?.ctx.fiber.dispose(); await rm(temp, { recursive: true, force: true }) }
  })

  it('7: failed command, forbidden change, missing evidence and digest corruption all refuse human acceptance', { timeout: 30_000 }, async () => {
    const variants = [
      { name: 'failed command', command: 'process.exit(1)', path: 'src/accepted.txt', corrupt: undefined },
      { name: 'forbidden path', command: 'process.exit(0)', path: 'outside.txt', corrupt: undefined },
      { name: 'missing evidence', command: 'process.exit(0)', path: 'src/accepted.txt', corrupt: 'missing' },
      { name: 'digest mismatch', command: 'process.exit(0)', path: 'src/accepted.txt', corrupt: 'mismatch' },
    ] as const
    for (const variant of variants) {
      const temp = await mkdtemp(join(tmpdir(), 'dsh-delivery-reject-')); runnerPath = variant.path
      let chain: Awaited<ReturnType<typeof completeChain>> | undefined
      try {
        chain = await completeChain(temp, variant.command)
        if (variant.corrupt !== undefined) {
          const object = (await readdir(chain.evidence))[0]
          if (object === undefined) throw new Error('expected verifier evidence')
          const target = join(chain.evidence, object)
          if (variant.corrupt === 'missing') await unlink(target)
          else await writeFile(target, 'corrupt evidence\n')
        }
        await expect(chain.remote.recordDecision({ packetId: chain.packet.id, changeBindingId: chain.change.id, verificationBindingId: chain.verification.id, decision: 'accepted', reason: variant.name, decisionNonce: variant.name }, chain.signal)).rejects.toThrow(/Delivery/u)
        expect(chain.ctx.delivery.snapshot().acceptanceDecisions).toEqual([])
      } finally { await chain?.ctx.fiber.dispose(); await rm(temp, { recursive: true, force: true }) }
    }
    runnerPath = 'src/accepted.txt'
  })

  it('8: two real Packet changes use distinct Attempt worktrees and leave the control checkout untouched', { timeout: 20_000 }, async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dsh-delivery-worktrees-')); runnerCwds.length = 0
    let chain: Awaited<ReturnType<typeof completeChain>> | undefined
    try {
      chain = await completeChain(temp, 'process.exit(0)', true, 'first controlled packet')
      await waitFor(() => chain!.operator.get(chain!.change.queueWorkId as never).state.status === 'succeeded')
      const revision = chain.ctx.delivery.snapshot().contractRevisions[0]!
      const secondPacket = await chain.remote.createPacket({
        contractRevisionId: revision.id,
        packet: { objective: 'second controlled packet', allowedPaths: [{ kind: 'subtree', path: 'src' }], forbiddenPaths: [], acceptanceClauseIds: ['accepted'], stopConditions: ['stop'], executorPreference: { mode: 'required', executorId: 'codex' } },
      }, chain.signal)
      const secondChange = await chain.remote.startChange({ packetId: secondPacket.id, executorId: 'codex' }, chain.signal)
      await waitFor(() => chain!.operator.get(secondChange.queueWorkId as never).state.status === 'succeeded')
      expect(runnerCwds).toHaveLength(2)
      expect(runnerCwds[0]).not.toBe(runnerCwds[1])
      expect(runnerCwds.every(cwd => cwd !== chain!.repository)).toBe(true)
      expect(await readFile(join(chain.repository, 'README.md'), 'utf8')).toBe('control checkout\n')
    } finally { await chain?.ctx.fiber.dispose(); await rm(temp, { recursive: true, force: true }) }
  })
})

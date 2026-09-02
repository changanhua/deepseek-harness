import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
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
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import LocalTaskQueue from '@deepseek-ai/dsh-task-queue-local'
import { createVerifiedOperatorAuthority } from '@deepseek-ai/dsh-task-queue'
import {
  AcceptanceClauseId,
  VerificationCheckId,
  canonicalDigest,
} from '@deepseek-ai/dsh-delivery-protocol'
import { describe, expect, it, vi } from 'vitest'

const codexGate = vi.hoisted(() => {
  let started = Promise.withResolvers<true>()
  let released = Promise.withResolvers<true>()
  return {
    hold: false,
    reset() {
      started = Promise.withResolvers<true>()
      released = Promise.withResolvers<true>()
    },
    markStarted() { started.resolve(true) },
    waitStarted() { return started.promise },
    release() { released.resolve(true) },
    waitRelease() { return released.promise },
  }
})

// The app-server is the only nondeterministic boundary.  The real Delivery
// runner still owns the lease, checkpoint, evidence, Queue result, and cleanup.
vi.mock('@deepseek-ai/dsh-subagent-codex/app-server-run', async () => {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  return {
    CODEX_APP_SERVER_PERMISSION_MODES: ['never'],
    async startCodexAppServerRun(request: { readonly cwd: string }) {
      await fs.mkdir(path.join(request.cwd, 'src'), { recursive: true })
      await fs.writeFile(path.join(request.cwd, 'src', 'accepted.txt'), 'accepted\\n')
      if (codexGate.hold) {
        codexGate.markStarted()
        await codexGate.waitRelease()
      }
      return {
        result: Promise.resolve({
          stopReason: 'completed',
          output: [{
            type: 'text',
            text: JSON.stringify({
              disposition: 'completed',
              summary: 'Created the accepted Delivery change.',
              completedWork: ['Created src/accepted.txt.'],
              remainingWork: ['None.'],
            }),
          }],
        }),
        async dispose() {},
      }
    },
  }
})

const run = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const uiDeliveryHost = { apply(): void {} }
const testCredentialsHost = {
  apply(ctx: Context): void {
    ctx.provide('credentials', {
      async describe(ref: string) {
        const configured = process.env[ref]?.trim() !== ''
          && process.env[ref] !== undefined
        return { configured, source: configured ? 'env' : undefined, writable: false }
      },
      async resolve(ref: string) {
        const value = process.env[ref]
        return value === undefined || value.trim() === '' ? undefined : { value, source: 'env' }
      },
    } as never)
  },
}
const issueUrl = 'https://github.com/example/project/issues/42'

interface DeliveryRemoteOperations {
  createCase(input: Record<string, unknown>, signal: AbortSignal): Promise<{
    readonly case: { readonly id: string; readonly headRevisionId: string }
    readonly revision: { readonly id: string }
  }>
  recordRequirementDecision(input: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
  publishIssue(input: { readonly caseId: string; readonly revisionId: string }, signal: AbortSignal): Promise<{
    readonly id: string
    readonly phase: string
    readonly issue: { readonly issueNumber: number; readonly url: string } | null
  }>
  importIssue(input: { readonly issueUrl: string }, signal: AbortSignal): Promise<{ readonly id: string }>
  createPacket(
    input: { readonly contractRevisionId: string; readonly packet: Record<string, unknown> },
    signal: AbortSignal,
  ): Promise<{ readonly id: string; readonly baseCommit: string }>
  startChange(
    input: { readonly packetId: string; readonly executorId: string },
    signal: AbortSignal,
  ): Promise<{ readonly id: string; readonly queueWorkId: string | null }>
  startVerification(
    input: { readonly packetId: string; readonly changeBindingId: string },
    signal: AbortSignal,
  ): Promise<{ readonly id: string; readonly queueWorkId: string | null }>
  recordDecision(
    input: {
      readonly packetId: string
      readonly changeBindingId: string
      readonly verificationBindingId: string
      readonly decision: 'accepted'
      readonly reason: string
      readonly decisionNonce: string
    },
    signal: AbortSignal,
  ): Promise<{ readonly decision: string }>
}

interface GitHubCanaryConfig {
  readonly owner: string
  readonly name: string
  readonly credentialRef: string
  readonly label: string
}

function workBrief(): string {
  return `<!-- dsh-delivery-work-brief@1 -->
\`\`\`yaml
format: dsh-delivery-work-brief@1
outcome: Create one governed acceptance file.
context: This controlled E2E uses a deterministic Codex transport boundary.
allowedScope: [src/accepted.txt]
forbiddenScope: [outside the governed worktree]
acceptanceClauses:
  - id: acceptance-file
    text: The accepted file exists only in the Attempt-owned worktree.
openDecisions: []
baseSelectionRule: { kind: ref-head, ref: refs/heads/main }
verificationSource:
  kind: contract-field
  checks:
    - id: node-smoke
      name: Node smoke
      argv: [node, -e, "process.exit(0)"]
      cwd: .
      timeoutMs: 5000
      severity: required
      expectedExitCodes: [0]
referenceLinks: []
\`\`\``
}

function issue(body = workBrief(), updatedAt = '2026-08-30T12:00:00.000Z') {
  return {
    number: 42,
    html_url: issueUrl,
    repository_url: 'https://api.github.com/repos/example/project',
    updated_at: updatedAt,
    title: 'Governed Personal Delivery acceptance',
    body,
  }
}

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for Delivery Queue settlement')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function git(directory: string, ...args: string[]): Promise<void> {
  await run('git', ['-C', directory, ...args])
}

async function boot(temp: string, repository: string, canary?: GitHubCanaryConfig): Promise<Context> {
  const configPath = join(temp, 'cordis.yml')
  let patch = (await readFile(join(root, 'cordis.patch.yml'), 'utf8')).replaceAll('\r\n', '\n')
    .replace("!!js dshHomePath('personal-delivery/evidence')", JSON.stringify(join(temp, 'evidence')))
    .replace('!!js process.cwd()', JSON.stringify(repository))
    .replace("!!js dshHomePath('personal-delivery/worktrees')", JSON.stringify(join(temp, 'worktrees')))
  if (canary !== undefined) {
    const deliveryRemoteRow = `    - id: delivery-remote
      name: '@deepseek-ai/dsh-delivery-remote'
      config:
        repositoryId: workspace`
    patch = patch.replace(
      deliveryRemoteRow,
      `${deliveryRemoteRow}\n        githubTargets:\n          workspace:\n            owner: ${JSON.stringify(canary.owner)}\n            name: ${JSON.stringify(canary.name)}\n            credentialRef: ${JSON.stringify(canary.credentialRef)}\n            labels:\n              - ${JSON.stringify(canary.label)}`,
    )
  }
  patch = patch
    .replace(/^- insert:\r?\n/mu, '').replace(/^    /gmu, '')
  await writeFile(configPath, [
    "- { id: storage, name: '@deepseek-ai/dsh-storage' }",
    "- id: storage-json\n  name: '@deepseek-ai/dsh-storage-json'\n  config:\n    root: " + JSON.stringify(join(temp, 'storage')),
    "- id: storage-domain\n  name: '@deepseek-ai/dsh-storage-domain'\n  config:\n    backend: json",
    "- { id: credentials, name: '@test/dsh-credentials' }",
    "- { id: subprocess, name: '@deepseek-ai/dsh-subprocess-local' }",
    "- id: task-queue\n  name: '@deepseek-ai/dsh-task-queue-local'\n  config:\n    queueRoot: " + JSON.stringify(join(temp, 'queue')) + '\n    maxConcurrent: 1\n    resourceCapacity:\n      agent-run: 1', patch,
  ].join('\n'))
  const modules = new Map<string, unknown>([
    ['@test/dsh-credentials', testCredentialsHost],
    ['@deepseek-ai/dsh-storage', Storage], ['@deepseek-ai/dsh-storage-json', StorageJson], ['@deepseek-ai/dsh-storage-domain', StorageDomain], ['@deepseek-ai/dsh-subprocess-local', LocalSubprocess], ['@deepseek-ai/dsh-task-queue-local', LocalTaskQueue], ['@deepseek-ai/dsh-delivery-local', LocalDelivery], ['@deepseek-ai/dsh-delivery-evidence-local', LocalDeliveryEvidence], ['@deepseek-ai/dsh-repo-workspace-git-local', GitLocalRepositoryWorkspace], ['@deepseek-ai/dsh-delivery-task-queue', DeliveryTaskQueue], ['@deepseek-ai/dsh-delivery-remote', DeliveryRemote], ['@deepseek-ai/dsh-client-ui-delivery', uiDeliveryHost],
  ])
  const ctx = new Context(); ctx.baseUrl = pathToFileURL(temp).href + '/'
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string) { const value = modules.get(specifier); if (value === undefined) throw new Error(specifier); return value } } as never
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } }); await ctx.loader.await()
  return ctx
}

const realGitHubCanary = process.env.DSH_DELIVERY_GITHUB_CANARY_APPROVED === '1' ? it : it.skip

function requiredGitHubCanaryConfig(): GitHubCanaryConfig {
  const repository = process.env.DSH_DELIVERY_GITHUB_CANARY_REPOSITORY ?? ''
  const [owner, name, extra] = repository.split('/')
  const credentialRef = process.env.DSH_DELIVERY_GITHUB_CANARY_CREDENTIAL_REF ?? ''
  const label = process.env.DSH_DELIVERY_GITHUB_CANARY_LABEL ?? ''
  if (owner === undefined || owner === '' || name === undefined || name === '' || extra !== undefined) {
    throw new Error('DSH_DELIVERY_GITHUB_CANARY_REPOSITORY must be one approved owner/name repository')
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(credentialRef)) {
    throw new Error('DSH_DELIVERY_GITHUB_CANARY_CREDENTIAL_REF must be one configured credential reference')
  }
  if (label.trim() === '') throw new Error('DSH_DELIVERY_GITHUB_CANARY_LABEL must name the approved canary label')
  return { owner, name, credentialRef, label }
}

describe('Personal Delivery acceptance harness', () => {
  it('passes the configured temporary Git checkout through Loader to the real workspace provider', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dsh-delivery-loader-probe-')); const repository = join(temp, 'repository'); let ctx: Context | undefined
    try {
      await mkdir(repository); await git(repository, 'init', '--initial-branch=main'); await git(repository, 'config', 'user.email', 'acceptance@example.test'); await git(repository, 'config', 'user.name', 'Acceptance'); await writeFile(join(repository, 'README.md'), 'base\n'); await git(repository, 'add', '.'); await git(repository, 'commit', '-m', 'base')
      ctx = await boot(temp, repository)
      expect((ctx.repoWorkspace as unknown as { repositories: Map<string, string> }).repositories.get('workspace')).toBe(resolve(repository))
      await expect(ctx.repoWorkspace.resolveBase({
        repositoryId: 'workspace' as never,
        selectionRule: { kind: 'ref-head', ref: 'refs/heads/main' },
      })).resolves.toMatchObject({ repositoryId: 'workspace' })
    } finally { await ctx?.fiber.dispose(); await rm(temp, { recursive: true, force: true }) }
  })

  it('covers Issue adoption, a real governed change and verification, acceptance, and restart', { timeout: 30_000 }, async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dsh-delivery-acceptance-'))
    const repository = join(temp, 'repository')
    let ctx: Context | undefined
    let reopened: Context | undefined
    try {
      await mkdir(repository)
      await git(repository, 'init', '--initial-branch=main')
      await git(repository, 'config', 'user.email', 'acceptance@example.test')
      await git(repository, 'config', 'user.name', 'Acceptance')
      await mkdir(join(repository, 'src'))
      await writeFile(join(repository, 'src', 'base.txt'), 'base\n')
      await git(repository, 'add', '.')
      await git(repository, 'commit', '-m', 'base')

      ctx = await boot(temp, repository)
      let remote = ctx.get('deliveryRemote') as unknown as DeliveryRemoteOperations
      let service = remote as unknown as { internals: { fetch: typeof fetch } }
      let snapshot = issue()
      service.internals.fetch = vi.fn(async () => new Response(JSON.stringify(snapshot), {
        headers: { 'content-type': 'application/json' },
      }))
      const signal = new AbortController().signal

      const firstRevision = await remote.importIssue({ issueUrl }, signal)
      // Scenario 3: repeated import is the same logical immutable revision.
      await expect(remote.importIssue({ issueUrl }, signal)).resolves.toMatchObject({ id: firstRevision.id })
      const deliveryCase = ctx.delivery.snapshot().deliveryCases.find(candidate => candidate.headRevisionId === firstRevision.id)
      if (deliveryCase === undefined) throw new Error('Imported revision has no owning Delivery Case')
      await ctx.delivery.recordRequirementDecision({
        idempotencyKey: `approve:${deliveryCase.id}:${firstRevision.id}`,
        caseId: deliveryCase.id,
        revisionId: deliveryCase.headRevisionId,
        decision: 'approved',
        reason: 'Controlled primary acceptance approved the imported requirement.',
        actorId: 'acceptance-operator',
        decisionNonce: `approve:${firstRevision.id}`,
      })
      await expect(ctx.repoWorkspace.resolveBase({
        repositoryId: 'workspace' as never,
        selectionRule: { kind: 'ref-head', ref: 'refs/heads/main' },
        signal,
      })).resolves.toBeDefined()
      const packet = await remote.createPacket({
        contractRevisionId: firstRevision.id,
        packet: {
          objective: 'Create the governed acceptance file.',
          allowedPaths: [{ kind: 'subtree', path: 'src' }],
          forbiddenPaths: [],
          acceptanceClauseIds: ['acceptance-file'],
          stopConditions: ['Stop after the accepted file is checkpointed.'],
          executorPreference: { mode: 'required', executorId: 'codex' },
        },
      }, signal)
      const operator = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
      // Scenario 3: Queue admission commits first, then an injected Delivery
      // binding failure forces the next Loader activation to replay the same key.
      operator.pause()
      const bindGate = Promise.withResolvers<true>()
      const bindDispatch = vi.spyOn(ctx.delivery, 'bindDispatch')
      bindDispatch.mockImplementationOnce(async () => {
        await bindGate.promise
        throw new Error('injected bind failure after Queue admission')
      })
      const interruptedStart = remote.startChange({ packetId: packet.id, executorId: 'codex' }, signal)
      await waitFor(() => operator.list().length === 1)
      const admittedWorkId = String(operator.list()[0]!.work.id)
      bindGate.resolve(true)
      await expect(interruptedStart).rejects.toMatchObject({ failure: { code: 'internal' } })
      expect(ctx.delivery.snapshot().dispatchBindings).toMatchObject([{ phase: 'submitting', queueWorkId: null }])
      bindDispatch.mockRestore()
      await ctx.fiber.dispose()
      ctx = undefined

      codexGate.reset()
      codexGate.hold = true
      const recovered = await boot(temp, repository)
      reopened = recovered
      const recoveredRemote: unknown = recovered.get('deliveryRemote')
      remote = recoveredRemote as DeliveryRemoteOperations
      service = remote as unknown as { internals: { fetch: typeof fetch } }
      service.internals.fetch = vi.fn(async () => new Response(JSON.stringify(snapshot), {
        headers: { 'content-type': 'application/json' },
      }))
      const reopenedOperator = recovered.taskQueue.forOperator(createVerifiedOperatorAuthority())
      await waitFor(() => recovered.delivery.snapshot().dispatchBindings[0]?.phase === 'bound')
      const change = recovered.delivery.snapshot().dispatchBindings[0]!
      expect(String(change.queueWorkId)).toBe(admittedWorkId)
      expect(reopenedOperator.list()).toHaveLength(1)
      await expect(remote.startChange({ packetId: packet.id, executorId: 'codex' }, signal))
        .resolves.toMatchObject({ id: change.id, queueWorkId: change.queueWorkId })
      expect(reopenedOperator.list()).toHaveLength(1)
      // Same persistence chain: same logical key but changed input is rejected.
      await expect(recovered.delivery.beginDispatch({
        idempotencyKey: change.idempotencyKey,
        packetId: packet.id as never,
        inputDigest: canonicalDigest({ packetId: packet.id, mutated: true }),
        kind: 'code.change@1',
        executorId: 'codex-mutated' as never,
      })).rejects.toMatchObject({ code: 'idempotency-conflict' })

      // Scenario 2: import a new revision while the old Packet's Codex run is live.
      await codexGate.waitStarted()
      snapshot = issue(workBrief().replace('Create one governed acceptance file.', 'Create a different later file.'), '2026-08-30T12:01:00.000Z')
      const editedRevision = await remote.importIssue({ issueUrl }, signal)
      expect(editedRevision.id).not.toBe(firstRevision.id)
      expect(recovered.delivery.getWorkPacket(packet.id as never)?.baseCommit).toBe(packet.baseCommit)
      codexGate.release()
      codexGate.hold = false
      await waitFor(() => reopenedOperator.get(change.queueWorkId as never).state.status === 'succeeded')
      expect(reopenedOperator.get(change.queueWorkId as never).attempts).toHaveLength(1)

      const verification = await remote.startVerification({ packetId: packet.id, changeBindingId: change.id }, signal)
      await waitFor(() => reopenedOperator.get(verification.queueWorkId as never).state.status === 'succeeded')
      const decision = await remote.recordDecision({
        packetId: packet.id,
        changeBindingId: change.id,
        verificationBindingId: verification.id,
        decision: 'accepted',
        reason: 'Controlled E2E verified the immutable evidence.',
        decisionNonce: 'acceptance-1',
      }, signal)
      expect(decision.decision).toBe('accepted')
      expect(reopenedOperator.get(change.queueWorkId as never).result).toMatchObject({
        output: { completionClaim: { changedPaths: ['src/accepted.txt'] } },
      })
      await expect(readFile(join(repository, 'src', 'accepted.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(recovered.delivery.snapshot().acceptanceDecisions).toHaveLength(1)

      await recovered.fiber.dispose()
      const finalContext = await boot(temp, repository)
      reopened = finalContext
      expect(finalContext.delivery.getWorkPacket(packet.id as never)).toMatchObject({ baseCommit: packet.baseCommit })
      expect(finalContext.delivery.snapshot().acceptanceDecisions).toHaveLength(1)
      const finalOperator = finalContext.taskQueue.forOperator(createVerifiedOperatorAuthority())
      expect(finalOperator.get(change.queueWorkId as never).state.status).toBe('succeeded')
      expect(finalOperator.get(verification.queueWorkId as never).state.status).toBe('succeeded')
    } finally {
      await ctx?.fiber.dispose()
      await reopened?.fiber.dispose()
      await rm(temp, { recursive: true, force: true })
    }
  })

  it('carries one human Case through approval, execution, verification, acceptance, and restart', { timeout: 30_000 }, async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dsh-delivery-case-acceptance-'))
    const repository = join(temp, 'repository')
    let ctx: Context | undefined
    let reopened: Context | undefined
    try {
      await mkdir(repository)
      await git(repository, 'init', '--initial-branch=main')
      await git(repository, 'config', 'user.email', 'case-acceptance@example.test')
      await git(repository, 'config', 'user.name', 'Case Acceptance')
      await mkdir(join(repository, 'src'))
      await writeFile(join(repository, 'src', 'base.txt'), 'base\n')
      await git(repository, 'add', '.')
      await git(repository, 'commit', '-m', 'case acceptance base')

      codexGate.hold = false
      ctx = await boot(temp, repository)
      const remote = ctx.get('deliveryRemote') as unknown as DeliveryRemoteOperations
      const signal = new AbortController().signal
      const clauseId = AcceptanceClauseId('human-case-accepted-file')
      const created = await remote.createCase({
        title: 'Deliver one governed local Case',
        revision: {
          outcome: 'Create the accepted file through the governed Delivery path.',
          context: 'The Case starts locally and needs no GitHub Issue identity.',
          allowedScope: ['src/accepted.txt'],
          forbiddenScope: ['outside the Attempt-owned worktree'],
          acceptanceClauses: [{ id: clauseId, text: 'The governed accepted file exists in the checkpoint.' }],
          openDecisions: [],
          baseSelectionRule: { kind: 'ref-head', ref: 'refs/heads/main' },
          verificationSource: {
            kind: 'contract-field',
            checks: [{
              id: VerificationCheckId('human-case-node-smoke'),
              name: 'Node smoke',
              argv: ['node', '-e', 'process.exit(0)'],
              cwd: '.',
              timeoutMs: 5_000,
              severity: 'required',
              expectedExitCodes: [0],
            }],
          },
          referenceLinks: [],
        },
      }, signal)
      await remote.recordRequirementDecision({
        caseId: created.case.id,
        revisionId: created.revision.id,
        decision: 'approved',
        reason: 'The exact local revision is ready for governed execution.',
      }, signal)
      const packet = await remote.createPacket({
        contractRevisionId: created.revision.id,
        packet: {
          objective: 'Create the governed accepted file.',
          allowedPaths: [{ kind: 'subtree', path: 'src' }],
          forbiddenPaths: [],
          acceptanceClauseIds: [clauseId],
          stopConditions: ['Stop after the accepted file is checkpointed.'],
          executorPreference: { mode: 'required', executorId: 'codex' },
        },
      }, signal)
      const operator = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
      const change = await remote.startChange({ packetId: packet.id, executorId: 'codex' }, signal)
      await waitFor(() => operator.get(change.queueWorkId as never).state.status === 'succeeded')
      const verification = await remote.startVerification({
        packetId: packet.id,
        changeBindingId: change.id,
      }, signal)
      await waitFor(() => operator.get(verification.queueWorkId as never).state.status === 'succeeded')
      await expect(remote.recordDecision({
        packetId: packet.id,
        changeBindingId: change.id,
        verificationBindingId: verification.id,
        decision: 'accepted',
        reason: 'The independent verdict and immutable evidence satisfy the Case.',
        decisionNonce: 'human-case-acceptance-1',
      }, signal)).resolves.toMatchObject({ decision: 'accepted' })

      await ctx.fiber.dispose()
      ctx = undefined
      reopened = await boot(temp, repository)
      expect(reopened.delivery.getCase(created.case.id as never)).toMatchObject({
        id: created.case.id,
        headRevisionId: created.revision.id,
      })
      expect(reopened.delivery.getContractRevision(created.revision.id as never)).toMatchObject({
        title: 'Deliver one governed local Case',
      })
      expect(reopened.delivery.getWorkPacket(packet.id as never)).toMatchObject({ id: packet.id })
      expect(reopened.delivery.snapshot().requirementDecisions).toHaveLength(1)
      expect(reopened.delivery.snapshot().acceptanceDecisions).toHaveLength(1)
    } finally {
      await ctx?.fiber.dispose()
      await reopened?.fiber.dispose()
      await rm(temp, { recursive: true, force: true })
    }
  })

  realGitHubCanary('publishes one approved Case to the explicitly authorized GitHub canary and survives restart', { timeout: 60_000 }, async () => {
    const canary = requiredGitHubCanaryConfig()
    const temp = await mkdtemp(join(tmpdir(), 'dsh-delivery-github-canary-'))
    const repository = join(temp, 'repository')
    let ctx: Context | undefined
    let reopened: Context | undefined
    try {
      await mkdir(repository)
      await git(repository, 'init', '--initial-branch=main')
      await git(repository, 'config', 'user.email', 'delivery-canary@example.test')
      await git(repository, 'config', 'user.name', 'Delivery Canary')
      await writeFile(join(repository, 'README.md'), 'delivery canary\n')
      await git(repository, 'add', '.')
      await git(repository, 'commit', '-m', 'delivery canary base')

      ctx = await boot(temp, repository, canary)
      const reference = credentialRef(canary.credentialRef)
      await expect(ctx.credentials.describe(reference)).resolves.toMatchObject({ configured: true })
      const credential = await ctx.credentials.resolve(reference)
      if (credential === undefined) throw new Error(`credential reference '${canary.credentialRef}' is not configured`)
      const repositoryResponse = await globalThis.fetch(`https://api.github.com/repos/${canary.owner}/${canary.name}`, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${credential.value}`,
          'x-github-api-version': '2026-03-10',
        },
      })
      expect(repositoryResponse.status).toBe(200)
      const repositoryBody = await repositoryResponse.json() as { readonly full_name?: string }
      expect(repositoryBody.full_name).toBe(`${canary.owner}/${canary.name}`)

      const remote = ctx.get('deliveryRemote') as unknown as DeliveryRemoteOperations
      const signal = new AbortController().signal
      const suffix = new Date().toISOString().replaceAll(/[:.]/gu, '-')
      const created = await remote.createCase({
        title: `[DSH Delivery Canary] ${suffix}`,
        revision: {
          outcome: 'Prove one exact Delivery revision publishes once and survives Host reconstruction.',
          context: `Explicit canary for ${canary.owner}/${canary.name} with label ${canary.label}.`,
          allowedScope: ['packages/bundle/personal-delivery'],
          forbiddenScope: ['credentials', 'production issue backlogs'],
          acceptanceClauses: [{
            id: AcceptanceClauseId('github-canary-published-once'),
            text: 'One GitHub Issue contains the exact Delivery marker and digest.',
          }],
          openDecisions: [],
          baseSelectionRule: { kind: 'ref-head', ref: 'refs/heads/main' },
          verificationSource: {
            kind: 'contract-field',
            checks: [{
              id: VerificationCheckId('github-canary-node-version'),
              name: 'Node runtime is available',
              argv: ['node', '--version'],
              cwd: '.',
              timeoutMs: 5_000,
              severity: 'required',
              expectedExitCodes: [0],
            }],
          },
          referenceLinks: [],
        },
      }, signal)
      await remote.recordRequirementDecision({
        caseId: created.case.id,
        revisionId: created.revision.id,
        decision: 'approved',
        reason: 'The operator explicitly approved this disposable canary revision.',
      }, signal)
      const published = await remote.publishIssue({
        caseId: created.case.id,
        revisionId: created.revision.id,
      }, signal)
      expect(published.phase).toBe('published')
      expect(published.issue).not.toBeNull()
      const durable = ctx.delivery.getIssuePublication(published.id as never)
      if (durable?.phase !== 'published' || durable.issue === null) {
        throw new Error('GitHub canary did not commit one published Delivery binding')
      }
      const issueResponse = await globalThis.fetch(
        `https://api.github.com/repos/${canary.owner}/${canary.name}/issues/${String(durable.issue.issueNumber)}`,
        {
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${credential.value}`,
            'x-github-api-version': '2026-03-10',
          },
        },
      )
      expect(issueResponse.status).toBe(200)
      const issueBody = await issueResponse.json() as { readonly body?: string; readonly labels?: readonly { readonly name?: string }[] }
      expect(issueBody.body).toContain(durable.marker)
      expect(issueBody.body).toContain(durable.renderedDigest)
      expect(issueBody.labels?.some(label => label.name === canary.label)).toBe(true)

      await ctx.fiber.dispose()
      ctx = undefined
      reopened = await boot(temp, repository, canary)
      const reconstructed = reopened.delivery.getIssuePublication(published.id as never)
      expect(reconstructed).toEqual(durable)
      const reopenedRemote = reopened.get('deliveryRemote') as unknown as DeliveryRemoteOperations
      const service = reopenedRemote as unknown as { internals: { fetch: typeof fetch } }
      const unexpectedHttp = vi.fn<typeof fetch>()
      service.internals.fetch = unexpectedHttp
      await expect(reopenedRemote.publishIssue({
        caseId: created.case.id,
        revisionId: created.revision.id,
      }, signal)).resolves.toMatchObject({ id: published.id, issue: durable.issue, phase: 'published' })
      expect(unexpectedHttp).not.toHaveBeenCalled()

      process.stdout.write(`${JSON.stringify({
        repository: `${canary.owner}/${canary.name}`,
        caseId: created.case.id,
        revisionId: created.revision.id,
        publicationId: durable.id,
        issueUrl: durable.issue.url,
        renderedDigest: durable.renderedDigest,
        phase: durable.phase,
      })}\n`)
    } finally {
      await ctx?.fiber.dispose()
      await reopened?.fiber.dispose()
      await rm(temp, { recursive: true, force: true })
    }
  })
})

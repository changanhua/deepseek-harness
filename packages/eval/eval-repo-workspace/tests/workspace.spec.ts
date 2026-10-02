import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { AttemptId, createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'
import type { WorkKindDefinition } from '@changanhua/dsh-task-queue'
import LocalTaskQueue from '@changanhua/dsh-task-queue-local'
import { GitLocalRepositoryWorkspace } from '@changanhua/dsh-repo-workspace-git-local'
import { TestSubprocessRuntime, fixtureGit } from '../../../delivery/repo-workspace-git-local/tests/harness.ts'
import { resolveEvalWorkspace } from '../src/index.ts'
import type { ResolvedEvalWorkspace, EvalWorkspaceEvidence } from '../src/index.ts'

declare module '@changanhua/dsh-task-queue' {
  interface WorkKindMap {
    'eval-workspace-test@1': WorkKindDefinition<{ uncertain: boolean }, { uncertain: boolean; commit: string },
      { workspace: ResolvedEvalWorkspace; uncertain: boolean }, { value: string; evidence: EvalWorkspaceEvidence }>
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eval-workspace-'))
  const repository = join(root, 'repository')
  const worktreeRoot = join(root, 'leases')
  await mkdir(repository)
  await fixtureGit(repository, 'init', '-b', 'main')
  await fixtureGit(repository, 'config', 'user.name', 'Eval Test')
  await fixtureGit(repository, 'config', 'user.email', 'eval@example.invalid')
  await mkdir(join(repository, 'fixture'))
  await writeFile(join(repository, 'fixture', 'input.txt'), 'fixed commit content\n')
  await fixtureGit(repository, 'add', 'fixture/input.txt')
  await fixtureGit(repository, 'commit', '-m', 'fixture')
  const commit = await fixtureGit(repository, 'rev-parse', 'HEAD')
  const boot = async () => {
    const ctx = new Context()
    const subprocess = new TestSubprocessRuntime(ctx)
    vi.spyOn(subprocess, 'resolveExecutable').mockResolvedValue(process.platform === 'win32' ? 'git.exe' : 'git')
    await ctx.plugin(GitLocalRepositoryWorkspace, { repositories: { fixture: repository }, worktreeRoot })
    return ctx
  }
  return { root, repository, commit, boot, clean: () => rm(root, { recursive: true, force: true }) }
}
const limits = { maxFixtureFiles: 10, maxFixtureBytes: 65536 }
const context = (id: string) => ({ attemptId: AttemptId(id), signal: new AbortController().signal })

test('real Queue supplies Attempt identity and persists unknown Attention for retained execution', async () => {
  const f = await fixture()
  const ctx = await f.boot()
  try {
    await ctx.plugin(LocalTaskQueue, { queueRoot: join(f.root, 'queue'), maxConcurrent: 2 })
    ctx.taskQueue.registerHandler({
      kind: 'eval-workspace-test@1',
      async resolveAdmission(input, admission) {
        await resolveEvalWorkspace(ctx, { repositoryId: 'fixture', commit: f.commit, routeId: 'r', caseId: 'c', repeat: 0,
          workspace: { kind: 'empty' } }, limits, admission.signal)
        return { ...input, commit: f.commit }
      },
      resources: () => [], policy: () => ({ maxAttempts: 1 }),
      async prepare(resolved, preparation) {
        return { uncertain: resolved.uncertain, workspace: await resolveEvalWorkspace(ctx, {
          repositoryId: 'fixture', commit: resolved.commit, routeId: 'r', caseId: 'c', repeat: 0, workspace: { kind: 'empty' },
        }, limits, preparation.signal) }
      },
      start(prepared, start) {
        return prepared.workspace.start<'eval-workspace-test@1', string>(start, async (cwd) => {
          await writeFile(join(cwd, 'result.txt'), 'owned by this Queue Attempt')
          return prepared.uncertain ? { status: 'unknown' } : { status: 'known', value: 'done' }
        }, (value, evidence) => ({ value, evidence }))
      },
    })
    const operator = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
    const known = await operator.enqueue({ kind: 'eval-workspace-test@1', title: 'Known cell', input: { uncertain: false }, idempotencyKey: 'known' })
    const unknown = await operator.enqueue({ kind: 'eval-workspace-test@1', title: 'Unknown cell', input: { uncertain: true }, idempotencyKey: 'unknown' })
    await vi.waitFor(() => {
      expect(operator.get(known).state.status).toBe('succeeded')
      expect(operator.get(unknown).state.status).toBe('unknown')
    }, { timeout: 10000, interval: 20 })
    expect(operator.pendingAttentions()).toEqual(expect.arrayContaining([expect.objectContaining({ workId: unknown, kind: 'unknown', status: 'pending' })]))
    const unknownView = operator.get(unknown)
    expect(unknownView.state.attemptCount).toBe(1)
    const recorded = JSON.parse(unknownView.state.failure!.message) as EvalWorkspaceEvidence
    expect(recorded.ownerAttemptId).toBe(unknownView.attempts[0]?.id)
    expect(recorded.verifiedCommit).toBe(f.commit)
    expect(recorded.disposition).toBe('preserved')
  } finally { await ctx.fiber.dispose(); await f.clean() }
}, 30000)

test('two concurrent cells have distinct writable directories pinned to the observed commit', async () => {
  const f = await fixture()
  const ctx = await f.boot()
  try {
    const resolved = await resolveEvalWorkspace(ctx, { repositoryId: 'fixture', commit: f.commit, routeId: 'route', caseId: 'case', repeat: 0,
      workspace: { kind: 'fixture', path: 'fixture' } }, limits)
    await writeFile(join(f.repository, 'fixture', 'input.txt'), 'later revision\n')
    await fixtureGit(f.repository, 'add', 'fixture/input.txt')
    await fixtureGit(f.repository, 'commit', '-m', 'move branch')
    const paths: string[] = []
    const results = await Promise.all(['attempt-a', 'attempt-b'].map(id => resolved.run(context(id), async (cwd) => {
      paths.push(cwd)
      expect(await readFile(join(cwd, 'input.txt'), 'utf8')).toBe('fixed commit content\n')
      await writeFile(join(cwd, 'output.txt'), id)
      return { status: 'known', value: id }
    })))
    expect(new Set(paths).size).toBe(2)
    for (const result of results) {
      expect(result).toMatchObject({ status: 'known', evidence: { verifiedCommit: f.commit, disposition: 'removed' } })
      expect(JSON.stringify(result)).not.toContain(f.root)
    }
    for (const path of paths) await expect(readdir(path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(f.repository, 'fixture', 'input.txt'), 'utf8')).toBe('later revision\n')
  } finally { await ctx.fiber.dispose(); await f.clean() }
}, 30000)

test('uncertain execution preserves the exact lease and restart never calls the executor again', async () => {
  const f = await fixture()
  let ctx = await f.boot()
  try {
    const input = { repositoryId: 'fixture', commit: f.commit, routeId: 'route', caseId: 'case', repeat: 0, workspace: { kind: 'empty' as const } }
    const resolved = await resolveEvalWorkspace(ctx, input, limits)
    let calls = 0
    const result = await resolved.run(context('uncertain-attempt'), async (cwd) => {
      calls++
      await writeFile(join(cwd, 'retained.txt'), 'unknown effect')
      return { status: 'unknown' }
    })
    expect(result).toMatchObject({ status: 'unknown', evidence: { disposition: 'preserved' } })
    await ctx.fiber.dispose()
    ctx = await f.boot()
    const reopened = await resolveEvalWorkspace(ctx, input, limits)
    try {
      const replay = await reopened.run(context('uncertain-attempt'), async () => { calls++; return { status: 'known', value: 'unsafe replay' } })
      expect(replay.status).toBe('unknown')
    } catch (error) { expect(error).toMatchObject({ code: 'owner-conflict' }) }
    expect(calls).toBe(1)
  } finally { await ctx.fiber.dispose(); await f.clean() }
}, 30000)

test('unsafe fixture paths and byte limits fail before execution and remove known preparation work', async () => {
  const f = await fixture()
  const ctx = await f.boot()
  try {
    let calls = 0
    for (const [index, path] of ['../repository', '/outside', 'fixture'].entries()) {
      const resolved = await resolveEvalWorkspace(ctx, { repositoryId: 'fixture', commit: f.commit, routeId: 'route', caseId: 'case', repeat: index,
        workspace: { kind: 'fixture', path } }, { ...limits, maxFixtureBytes: 1 })
      const result = await resolved.run(context(`bad-${index}`), async () => { calls++; return { status: 'known', value: 1 } })
      expect(result).toMatchObject({ status: 'failed', reason: 'preparation-failed', evidence: { disposition: 'removed' } })
    }
    expect(calls).toBe(0)
  } finally { await ctx.fiber.dispose(); await f.clean() }
}, 30000)

test('known execution with uncertain cleanup becomes needs-attention', async () => {
  const f = await fixture()
  const ctx = await f.boot()
  try {
    const owner = ctx.repoWorkspace
    const open = owner.openChange.bind(owner)
    vi.spyOn(owner, 'openChange').mockImplementation(async (request) => {
      const lease = await open(request)
      return { ...lease, close: async (disposition) => { await lease.close('preserve'); if (disposition === 'remove') throw new Error('cleanup failed') } }
    })
    const resolved = await resolveEvalWorkspace(ctx, { repositoryId: 'fixture', commit: f.commit, routeId: 'route', caseId: 'case', repeat: 0,
      workspace: { kind: 'repository' } }, limits)
    const result = await resolved.run(context('cleanup'), async () => ({ status: 'known', value: 'done' }))
    expect(result).toMatchObject({ status: 'unknown', reason: 'cleanup-uncertain', evidence: { disposition: 'needs-attention' } })
  } finally { vi.restoreAllMocks(); await ctx.fiber.dispose(); await f.clean() }
}, 30000)

test('a fixture junction escaping the exact checkout is refused without touching its target', async () => {
  const f = await fixture()
  const ctx = await f.boot()
  try {
    const open = ctx.repoWorkspace.openChange.bind(ctx.repoWorkspace)
    vi.spyOn(ctx.repoWorkspace, 'openChange').mockImplementation(async (request) => {
      const lease = await open(request)
      await rename(join(lease.cwd, 'fixture'), join(lease.cwd, 'original-fixture'))
      await symlink(join(f.repository, 'fixture'), join(lease.cwd, 'fixture'), 'junction')
      return lease
    })
    const resolved = await resolveEvalWorkspace(ctx, { repositoryId: 'fixture', commit: f.commit, routeId: 'r', caseId: 'c', repeat: 0,
      workspace: { kind: 'fixture', path: 'fixture' } }, limits)
    let called = false
    const result = await resolved.run(context('junction'), async () => { called = true; return { status: 'known', value: 1 } })
    expect(result).toMatchObject({ status: 'failed', evidence: { disposition: 'removed' } })
    expect(called).toBe(false)
    expect(await readFile(join(f.repository, 'fixture', 'input.txt'), 'utf8')).toBe('fixed commit content\n')
  } finally { vi.restoreAllMocks(); await ctx.fiber.dispose(); await f.clean() }
}, 30000)

test('known canceled execution removes the lease only after the executor settles', async () => {
  const f = await fixture()
  const ctx = await f.boot()
  const controller = new AbortController()
  const entered = Promise.withResolvers<undefined>()
  let cwd = ''
  try {
    const resolved = await resolveEvalWorkspace(ctx, { repositoryId: 'fixture', commit: f.commit, routeId: 'r', caseId: 'c', repeat: 0,
      workspace: { kind: 'empty' } }, limits)
    const pending = resolved.run({ attemptId: AttemptId('canceled'), signal: controller.signal }, async (path, signal) => {
      cwd = path
      entered.resolve(undefined)
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      return { status: 'canceled' }
    })
    await entered.promise
    controller.abort()
    expect(await pending).toMatchObject({ status: 'canceled', evidence: { disposition: 'removed' } })
    await expect(readdir(cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { controller.abort(); await ctx.fiber.dispose(); await f.clean() }
}, 30000)

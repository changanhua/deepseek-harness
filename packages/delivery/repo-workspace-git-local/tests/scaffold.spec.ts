import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  GitCommitId,
  QueueAttemptIdRef,
  RepositoryRelativePath,
  RepositoryId,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  Config,
  GitLocalRepositoryWorkspace,
} from '../src/index.ts'
import { ScriptedSubprocessRuntime, TestSubprocessRuntime, fixtureGit } from './harness.ts'

const fsControl = vi.hoisted(() => ({
  directorySyncPaths: [] as string[],
  fileSyncPaths: [] as string[],
  simulateDirectorySync: false,
  blockedSyncPath: undefined as string | undefined,
  syncEntered: undefined as (() => void) | undefined,
  releaseSync: undefined as Promise<void> | undefined,
  failedSyncPath: undefined as string | undefined,
  syncFailure: undefined as Error | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    async open(...args: Parameters<typeof actual.open>): ReturnType<typeof actual.open> {
      if (typeof args[0] !== 'string') throw new TypeError('repo-workspace tests open only string paths')
      const path = args[0]
      const handle = await actual.open(...args)
      let directory = false
      try {
        directory = (await actual.lstat(path)).isDirectory()
      } catch {
        // The opened handle remains authoritative when its name changes after open.
      }
      const originalSync = handle.sync.bind(handle)
      Object.defineProperty(handle, 'sync', {
        value: async () => {
          const calls = directory ? fsControl.directorySyncPaths : fsControl.fileSyncPaths
          calls.push(path)
          if (fsControl.failedSyncPath === path) throw fsControl.syncFailure
          if (fsControl.blockedSyncPath === path) {
            fsControl.syncEntered?.()
            await fsControl.releaseSync
          }
          if (directory && fsControl.simulateDirectorySync) return
          await originalSync()
        },
      })
      return handle
    },
  }
})

vi.mock('koffi', () => {
  let lastError = 0
  return {
    default: {
      load: () => ({
        func: (_convention: string, name: string) => name === 'MoveFileExW'
          ? (from: string, to: string, flags: number) => {
            expect(flags).toBe(0x00000008)
            if (existsSync(to)) { lastError = 183; return 0 }
            renameSync(from, to)
            lastError = 0
            return 1
          }
          : () => lastError,
      }),
    },
  }
})

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  fsControl.directorySyncPaths.length = 0
  fsControl.fileSyncPaths.length = 0
  fsControl.simulateDirectorySync = false
  fsControl.blockedSyncPath = undefined
  fsControl.syncEntered = undefined
  fsControl.releaseSync = undefined
  fsControl.failedSyncPath = undefined
  fsControl.syncFailure = undefined
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `${label}-`))
  roots.push(root)
  return root
}

async function fixtureRepository(): Promise<{ repository: string; firstCommit: ReturnType<typeof GitCommitId> }> {
  const repository = await temporaryRoot('dsh-repo-workspace-source')
  await fixtureGit(repository, 'init', '-b', 'main')
  await fixtureGit(repository, 'config', 'user.name', 'Delivery Test')
  await fixtureGit(repository, 'config', 'user.email', 'delivery-test@example.invalid')
  await writeFile(join(repository, 'tracked.txt'), 'first\n')
  await fixtureGit(repository, 'add', '--all')
  await fixtureGit(repository, 'commit', '-m', 'first')
  const firstCommit = GitCommitId(await fixtureGit(repository, 'rev-parse', 'HEAD'))
  return { repository, firstCommit }
}

describe('local Git repository workspace', () => {
  it('requires repository identities and a worktree root', () => {
    expect(Config({
      repositories: { harness: 'C:/repos/harness' },
      worktreeRoot: 'C:/worktrees',
    })).toEqual({
      repositories: { harness: 'C:/repos/harness' },
      worktreeRoot: 'C:/worktrees',
    })
    expect(() => Config({ repositories: {} } as never)).toThrow()
  })

  it('constructs the provider without inspecting a repository', () => {
    const ctx = new Context()
    expect(new GitLocalRepositoryWorkspace(ctx, {
      repositories: {},
      worktreeRoot: 'C:/worktrees',
    })).toBeInstanceOf(GitLocalRepositoryWorkspace)
  })

  it('registers and disposes the concrete service with its package invariant', async () => {
    const { repository } = await fixtureRepository()
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const ctx = new Context()
    new TestSubprocessRuntime(ctx)
    const fiber = ctx.plugin(GitLocalRepositoryWorkspace, {
      repositories: { fixture: repository },
      worktreeRoot,
    })
    await fiber
    expect(ctx.repoWorkspace).toBeInstanceOf(GitLocalRepositoryWorkspace)
    await fiber.dispose()
    expect(ctx.get('repoWorkspace')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('verifies full commits and captures a ref head at one point in time', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const repositoryId = RepositoryId('repository-local-fixture')
    await fixtureGit(repository, 'branch', 'delivery-base', firstCommit)
    const ctx = new Context()
    const subprocess = new TestSubprocessRuntime(ctx)
    const gitExecutable = process.platform === 'win32' ? 'git.exe' : 'git'
    vi.spyOn(subprocess, 'resolveExecutable').mockResolvedValue(gitExecutable)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })

    const explicit = await workspace.resolveBase({
      repositoryId,
      selectionRule: { kind: 'commit', commit: firstCommit },
    })
    const captured = await workspace.resolveBase({
      repositoryId,
      selectionRule: { kind: 'ref-head', ref: 'refs/heads/delivery-base' },
    })
    await writeFile(join(repository, 'tracked.txt'), 'second\n')
    await fixtureGit(repository, 'add', '--all')
    await fixtureGit(repository, 'commit', '-m', 'second')
    const secondCommit = GitCommitId(await fixtureGit(repository, 'rev-parse', 'HEAD'))
    await fixtureGit(repository, 'branch', '--force', 'delivery-base', secondCommit)

    expect(explicit).toMatchObject({
      repositoryId,
      commit: firstCommit,
      selectionRule: { kind: 'commit', commit: firstCommit },
    })
    expect(captured).toMatchObject({
      repositoryId,
      commit: firstCommit,
      selectionRule: { kind: 'ref-head', ref: 'refs/heads/delivery-base' },
    })
    expect((await workspace.resolveBase({
      repositoryId,
      selectionRule: { kind: 'ref-head', ref: 'refs/heads/delivery-base' },
    })).commit).toBe(secondCommit)
    await expect(workspace.inspectRevision({ repositoryId, commit: firstCommit })).resolves.toMatchObject({
      repositoryId,
      commit: firstCommit,
    })
    await expect(workspace.inspectRevision({
      repositoryId,
      commit: GitCommitId('ffffffffffffffffffffffffffffffffffffffff'),
    })).rejects.toMatchObject({ code: 'revision-not-found' })
    expect(subprocess.specs.length).toBeGreaterThan(0)
    expect(subprocess.specs.every(spec => spec.argv[0] === gitExecutable && spec.argv[1] === '-C')).toBe(true)
    const physicalRepository = await realpath(repository)
    expect(await Promise.all(subprocess.specs.map(async (spec) => {
      return await realpath(String(spec.argv[2]))
    }))).toEqual(Array.from({ length: subprocess.specs.length }, () => physicalRepository))
    expect(subprocess.handles.every(handle => handle.waitForExitCalls === 1)).toBe(true)
    await ctx.fiber.dispose()
  })

  it('reads one exact Git blob only within the complete-byte limit', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const repositoryId = RepositoryId('repository-blob-fixture')
    const ctx = new Context()
    new TestSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    const base = await workspace.resolveBase({
      repositoryId,
      selectionRule: { kind: 'commit', commit: firstCommit },
    })
    const path = RepositoryRelativePath('tracked.txt')

    const first = await workspace.readBlob({ base, path, maxBytes: 6 })
    expect(first).toMatchObject({
      repositoryId,
      commit: firstCommit,
      path,
      blobId: await fixtureGit(repository, 'rev-parse', `${firstCommit}:tracked.txt`),
    })
    expect(Object.isFrozen(first)).toBe(true)
    expect(new TextDecoder().decode(first.bytes)).toBe('first\n')
    first.bytes[0] = 9
    expect(new TextDecoder().decode((await workspace.readBlob({ base, path, maxBytes: 6 })).bytes)).toBe('first\n')
    await expect(workspace.readBlob({ base, path, maxBytes: 5 })).rejects.toMatchObject({ code: 'blob-too-large' })
    await expect(workspace.readBlob({ base, path, maxBytes: 0 })).rejects.toThrow(/positive safe integer/u)
    await expect(workspace.readBlob({
      base,
      path: RepositoryRelativePath('missing.txt'),
      maxBytes: 6,
    })).rejects.toMatchObject({ code: 'blob-not-found' })
    await ctx.fiber.dispose()
  })

  it('derives ancestry and the complete NUL-delimited changed-path set', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const repositoryId = RepositoryId('repository-range-fixture')
    await fixtureGit(repository, 'mv', 'tracked.txt', 'moved.txt')
    await mkdir(join(repository, 'nested'))
    await writeFile(join(repository, 'nested', 'other.txt'), 'other\n')
    await fixtureGit(repository, 'add', '--all')
    await fixtureGit(repository, 'commit', '-m', 'rename and add')
    const secondCommit = GitCommitId(await fixtureGit(repository, 'rev-parse', 'HEAD'))
    await fixtureGit(repository, 'switch', '--detach', firstCommit)
    await writeFile(join(repository, 'side.txt'), 'side\n')
    await fixtureGit(repository, 'add', '--all')
    await fixtureGit(repository, 'commit', '-m', 'side')
    const sideCommit = GitCommitId(await fixtureGit(repository, 'rev-parse', 'HEAD'))
    const ctx = new Context()
    new TestSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    const first = await workspace.inspectRevision({ repositoryId, commit: firstCommit })
    const second = await workspace.inspectRevision({ repositoryId, commit: secondCommit })
    const side = await workspace.inspectRevision({ repositoryId, commit: sideCommit })

    await expect(workspace.inspectRange({ base: first, target: second })).resolves.toEqual({
      repositoryId,
      baseCommit: firstCommit,
      targetCommit: secondCommit,
      descendsFromBase: true,
      changedPaths: [
        RepositoryRelativePath('moved.txt'),
        RepositoryRelativePath('nested/other.txt'),
        RepositoryRelativePath('tracked.txt'),
      ],
    })
    await expect(workspace.inspectRange({ base: second, target: side })).resolves.toMatchObject({
      descendsFromBase: false,
    })
    await ctx.fiber.dispose()
  })

  it('isolates one idempotent change worktree per Attempt owner', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const worktreeRoot = join(await temporaryRoot('dsh-repo-workspace-leases'), 'nested-leases')
    const repositoryId = RepositoryId('repository-change-lease')
    const ctx = new Context()
    new TestSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    const base = await workspace.inspectRevision({ repositoryId, commit: firstCommit })
    const owner = QueueAttemptIdRef('../../attempt-change-lease')
    const first = await workspace.openChange({ ownerAttemptId: owner, base })
    const repeated = await workspace.openChange({ ownerAttemptId: owner, base })
    const second = await workspace.openChange({
      ownerAttemptId: QueueAttemptIdRef('attempt-change-lease-2'),
      base,
    })

    expect(repeated).toBe(first)
    expect(first).toMatchObject({ ownerAttemptId: owner, repositoryId, baseCommit: firstCommit })
    expect(first.cwd).not.toBe(second.cwd)
    const relativeLease = relative(worktreeRoot, first.cwd)
    expect(relativeLease).not.toBe('')
    expect(isAbsolute(relativeLease)).toBe(false)
    expect(relativeLease.startsWith('..')).toBe(false)
    await writeFile(join(first.cwd, 'tracked.txt'), 'changed only in lease\n')
    expect(await readFile(join(repository, 'tracked.txt'), 'utf8')).toBe('first\n')
    expect(await readFile(join(first.cwd, 'tracked.txt'), 'utf8')).toBe('changed only in lease\n')
    expect((await readFile(join(second.cwd, 'tracked.txt'), 'utf8')).replaceAll('\r\n', '\n')).toBe('first\n')
    await first.close('preserve')
    await second.close('preserve')
    await ctx.fiber.dispose()
  })

  it('forgets successful removals so one Attempt owner can reopen a workspace', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-removed-lease')
    const repositoryId = RepositoryId('repository-removed-lease')
    const ownerAttemptId = QueueAttemptIdRef('attempt-removed-lease')
    const ctx = new Context()
    new TestSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    const base = await workspace.inspectRevision({ repositoryId, commit: firstCommit })
    const change = await workspace.openChange({ ownerAttemptId, base })

    await change.close('remove')
    const verification = await workspace.openVerification({ ownerAttemptId, base, target: base })
    await verification.close('remove')
    const reopenedVerification = await workspace.openVerification({ ownerAttemptId, base, target: base })

    expect(verification).not.toBe(change)
    expect(reopenedVerification).not.toBe(verification)
    await reopenedVerification.close('remove')
    await ctx.fiber.dispose()
  })

  it('does not let an earlier removed lease erase a replacement ownership entry', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-remove-identity')
    const repositoryId = RepositoryId('repository-remove-identity')
    const ownerAttemptId = QueueAttemptIdRef('attempt-remove-identity')
    const ctx = new Context()
    new TestSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    const base = await workspace.inspectRevision({ repositoryId, commit: firstCommit })
    const lease = await workspace.openChange({ ownerAttemptId, base })
    const entries = (workspace as unknown as { leases: Map<QueueAttemptIdRef, unknown> }).leases
    const replacement = { lease: Promise.resolve() }
    entries.set(ownerAttemptId, replacement)

    await lease.close('remove')

    expect(entries.get(ownerAttemptId)).toBe(replacement)
    entries.delete(ownerAttemptId)
    const verificationOwnerAttemptId = QueueAttemptIdRef('attempt-remove-verification-identity')
    const verification = await workspace.openVerification({
      ownerAttemptId: verificationOwnerAttemptId,
      base,
      target: base,
    })
    const verificationReplacement = { lease: Promise.resolve() }
    entries.set(verificationOwnerAttemptId, verificationReplacement)
    await verification.close('remove')
    expect(entries.get(verificationOwnerAttemptId)).toBe(verificationReplacement)
    entries.delete(verificationOwnerAttemptId)
    await ctx.fiber.dispose()
  })

  it('does not let a failed creation erase a replacement ownership entry', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-failed-identity')
    const repositoryId = RepositoryId('repository-failed-identity')
    const ctx = new Context()
    new TestSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    const base = await workspace.inspectRevision({ repositoryId, commit: firstCommit })
    const internals = workspace as unknown as {
      readonly leases: Map<QueueAttemptIdRef, unknown>
      createChangeLease: (...args: unknown[]) => Promise<unknown>
      createVerificationLease: (...args: unknown[]) => Promise<unknown>
    }

    let rejectChange!: (error: Error) => void
    vi.spyOn(internals, 'createChangeLease').mockReturnValue(new Promise<unknown>((_resolve, reject) => {
      rejectChange = reject
    }))
    const changeOwner = QueueAttemptIdRef('attempt-failed-change-identity')
    const openingChange = workspace.openChange({ ownerAttemptId: changeOwner, base })
    const replacementChange = { lease: Promise.resolve() }
    internals.leases.set(changeOwner, replacementChange)
    rejectChange(new Error('change creation failed'))
    await expect(openingChange).rejects.toThrow('change creation failed')
    expect(internals.leases.get(changeOwner)).toBe(replacementChange)

    let rejectVerification!: (error: Error) => void
    vi.spyOn(internals, 'createVerificationLease').mockReturnValue(new Promise<unknown>((_resolve, reject) => {
      rejectVerification = reject
    }))
    const verificationOwner = QueueAttemptIdRef('attempt-failed-verification-identity')
    const openingVerification = workspace.openVerification({ ownerAttemptId: verificationOwner, base, target: base })
    const replacementVerification = { lease: Promise.resolve() }
    internals.leases.set(verificationOwner, replacementVerification)
    rejectVerification(new Error('verification creation failed'))
    await expect(openingVerification).rejects.toThrow('verification creation failed')
    expect(internals.leases.get(verificationOwner)).toBe(replacementVerification)
    internals.leases.delete(changeOwner)
    internals.leases.delete(verificationOwner)
    await ctx.fiber.dispose()
  })

  it('recovers the same Attempt lease after provider reconstruction and rejects another base', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const repositoryId = RepositoryId('repository-change-recovery')
    const ownerAttemptId = QueueAttemptIdRef('attempt-change-recovery')
    const config = { repositories: { [repositoryId]: repository }, worktreeRoot }
    const firstContext = new Context()
    new TestSubprocessRuntime(firstContext)
    const firstProvider = new GitLocalRepositoryWorkspace(firstContext, config)
    const firstBase = await firstProvider.inspectRevision({ repositoryId, commit: firstCommit })
    const original = await firstProvider.openChange({ ownerAttemptId, base: firstBase })
    await writeFile(join(original.cwd, 'recovered.txt'), 'uncommitted Attempt work\n')
    await firstContext.fiber.dispose()

    const secondContext = new Context()
    new TestSubprocessRuntime(secondContext)
    const reconstructed = new GitLocalRepositoryWorkspace(secondContext, config)
    const recoveredBase = await reconstructed.inspectRevision({ repositoryId, commit: firstCommit })
    const recovered = await reconstructed.openChange({ ownerAttemptId, base: recoveredBase })
    expect(recovered.cwd).toBe(original.cwd)
    expect(await readFile(join(recovered.cwd, 'recovered.txt'), 'utf8')).toBe('uncommitted Attempt work\n')

    await writeFile(join(repository, 'tracked.txt'), 'new source commit\n')
    await fixtureGit(repository, 'add', '--all')
    await fixtureGit(repository, 'commit', '-m', 'new source commit')
    const secondCommit = GitCommitId(await fixtureGit(repository, 'rev-parse', 'HEAD'))
    const secondBase = await reconstructed.inspectRevision({ repositoryId, commit: secondCommit })
    await expect(reconstructed.openChange({ ownerAttemptId, base: secondBase }))
      .rejects.toMatchObject({ code: 'owner-conflict' })
    await recovered.close('preserve')
    await secondContext.fiber.dispose()
  })

  it('waits for durable marker publication and repeats the barrier when observing an existing lease', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    fsControl.simulateDirectorySync = true
    const { repository, firstCommit } = await fixtureRepository()
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-marker-durability')
    const repositoryId = RepositoryId('repository-marker-durability')
    const ownerAttemptId = QueueAttemptIdRef('attempt-marker-durability')
    const config = { repositories: { [repositoryId]: repository }, worktreeRoot }
    const firstContext = new Context()
    new TestSubprocessRuntime(firstContext)
    const first = new GitLocalRepositoryWorkspace(firstContext, config)
    const base = await first.inspectRevision({ repositoryId, commit: firstCommit })
    let entered!: () => void
    const syncEntered = new Promise<void>((resolve) => { entered = resolve })
    let release!: () => void
    const releaseSync = new Promise<void>((resolve) => { release = resolve })
    fsControl.blockedSyncPath = worktreeRoot
    fsControl.syncEntered = entered
    fsControl.releaseSync = releaseSync
    let settled = false
    const opening = first.openChange({ ownerAttemptId, base }).finally(() => { settled = true })
    expect(await Promise.race([
      syncEntered.then(() => 'barrier' as const),
      opening.then(() => 'settled' as const),
    ])).toBe('barrier')
    expect(settled).toBe(false)
    release()
    const lease = await opening
    expect(fsControl.fileSyncPaths.some(path => path.endsWith(`${sep}lease.json`))).toBe(true)
    expect(fsControl.directorySyncPaths).toContain(worktreeRoot)
    await lease.close('preserve')
    await firstContext.fiber.dispose()

    fsControl.blockedSyncPath = undefined
    fsControl.syncEntered = undefined
    fsControl.releaseSync = undefined
    fsControl.directorySyncPaths.length = 0
    fsControl.fileSyncPaths.length = 0
    const secondContext = new Context()
    new TestSubprocessRuntime(secondContext)
    const reconstructed = new GitLocalRepositoryWorkspace(secondContext, config)
    const reconstructedBase = await reconstructed.inspectRevision({ repositoryId, commit: firstCommit })
    const recovered = await reconstructed.openChange({ ownerAttemptId, base: reconstructedBase })
    expect(fsControl.fileSyncPaths).toContain(join(dirname(recovered.cwd), 'lease.json'))
    expect(fsControl.directorySyncPaths).toContain(worktreeRoot)
    await recovered.close('preserve')
    await secondContext.fiber.dispose()

    const failureContext = new Context()
    new TestSubprocessRuntime(failureContext)
    const failureRoot = await temporaryRoot('dsh-repo-workspace-marker-sync-failure')
    const failing = new GitLocalRepositoryWorkspace(failureContext, {
      repositories: { [repositoryId]: repository },
      worktreeRoot: failureRoot,
    })
    const failingBase = await failing.inspectRevision({ repositoryId, commit: firstCommit })
    const failure = new Error('simulated lease marker sync failure')
    fsControl.failedSyncPath = failureRoot
    fsControl.syncFailure = failure
    await expect(failing.openChange({
      ownerAttemptId: QueueAttemptIdRef('attempt-marker-sync-failure'),
      base: failingBase,
    })).rejects.toMatchObject({ code: 'unavailable', cause: failure })
    await failureContext.fiber.dispose()

    fsControl.failedSyncPath = undefined
    fsControl.syncFailure = undefined
    const nestedContext = new Context()
    new TestSubprocessRuntime(nestedContext)
    const nestedRoot = join(await temporaryRoot('dsh-repo-workspace-durable-parent'), 'nested', 'leases')
    const nested = new GitLocalRepositoryWorkspace(nestedContext, {
      repositories: { [repositoryId]: repository },
      worktreeRoot: nestedRoot,
    })
    const nestedBase = await nested.inspectRevision({ repositoryId, commit: firstCommit })
    const nestedLease = await nested.openChange({
      ownerAttemptId: QueueAttemptIdRef('attempt-durable-directory'),
      base: nestedBase,
    })
    await nestedLease.close('preserve')
    await nestedContext.fiber.dispose()
  })

  it('creates one clean governed checkpoint from the complete change checkout', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const repositoryId = RepositoryId('repository-checkpoint')
    const ctx = new Context()
    new TestSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    const base = await workspace.inspectRevision({ repositoryId, commit: firstCommit })
    const lease = await workspace.openChange({
      ownerAttemptId: QueueAttemptIdRef('attempt-checkpoint'),
      base,
    })
    await writeFile(join(lease.cwd, 'tracked.txt'), 'checkpointed change\n')
    await mkdir(join(lease.cwd, 'nested'))
    await writeFile(join(lease.cwd, 'nested', 'new.txt'), 'new file\n')

    await expect(lease.checkpoint({ message: '   ' })).rejects.toMatchObject({ code: 'checkpoint-failed' })
    const checkpoint = await lease.checkpoint({ message: 'delivery: governed checkpoint' })
    expect(checkpoint.checkpointCommit).toMatch(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u)
    expect(checkpoint).toEqual({
      repositoryId,
      baseCommit: firstCommit,
      checkpointCommit: checkpoint.checkpointCommit,
      changedPaths: [RepositoryRelativePath('nested/new.txt'), RepositoryRelativePath('tracked.txt')],
      clean: true,
      descendsFromBase: true,
    })
    expect(await fixtureGit(lease.cwd, 'status', '--porcelain', '--untracked-files=all')).toBe('')
    expect(await fixtureGit(lease.cwd, 'show', '-s', '--format=%an <%ae>', 'HEAD'))
      .toBe('DeepSeek Harness Delivery <delivery@local.invalid>')
    expect(await readFile(join(repository, 'tracked.txt'), 'utf8')).toBe('first\n')
    await expect(lease.checkpoint({ message: 'another checkpoint' }))
      .rejects.toMatchObject({ code: 'checkpoint-failed' })
    const closing = lease.close('preserve')
    const repeatedClosing = lease.close('preserve')
    await expect(lease.close('remove')).rejects.toMatchObject({ code: 'owner-conflict' })
    await Promise.all([closing, repeatedClosing])
    await lease.close('preserve')
    await expect(lease.close('remove')).rejects.toMatchObject({ code: 'owner-conflict' })
    await ctx.fiber.dispose()
  })

  it('opens an idempotent exact-target verification lease without changing owner purpose', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    await writeFile(join(repository, 'tracked.txt'), 'verification target\n')
    await fixtureGit(repository, 'add', '--all')
    await fixtureGit(repository, 'commit', '-m', 'verification target')
    const targetCommit = GitCommitId(await fixtureGit(repository, 'rev-parse', 'HEAD'))
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const repositoryId = RepositoryId('repository-verification-lease')
    const ctx = new Context()
    new TestSubprocessRuntime(ctx)
    const config = {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    }
    const workspace = new GitLocalRepositoryWorkspace(ctx, config)
    const base = await workspace.inspectRevision({ repositoryId, commit: firstCommit })
    const target = await workspace.inspectRevision({ repositoryId, commit: targetCommit })
    const ownerAttemptId = QueueAttemptIdRef('attempt-verification-lease')
    const lease = await workspace.openVerification({ ownerAttemptId, base, target })
    const repeated = await workspace.openVerification({ ownerAttemptId, base, target })
    const other = await workspace.openVerification({
      ownerAttemptId: QueueAttemptIdRef('attempt-verification-lease-2'),
      base,
      target,
    })

    expect(repeated).toBe(lease)
    expect(lease).toMatchObject({
      ownerAttemptId,
      repositoryId,
      baseCommit: firstCommit,
      targetCommit,
    })
    expect(await fixtureGit(lease.cwd, 'rev-parse', 'HEAD')).toBe(targetCommit)
    expect(lease.cwd).not.toBe(other.cwd)
    await expect(workspace.openChange({ ownerAttemptId, base })).rejects.toMatchObject({ code: 'owner-conflict' })
    await expect(workspace.openVerification({ ownerAttemptId, base, target: base }))
      .rejects.toMatchObject({ code: 'owner-conflict' })
    await lease.close('preserve')
    await lease.close('preserve')
    await expect(lease.close('remove')).rejects.toMatchObject({ code: 'owner-conflict' })
    const firstRemoval = other.close('remove')
    const repeatedRemoval = other.close('remove')
    await expect(other.close('preserve')).rejects.toMatchObject({ code: 'owner-conflict' })
    await expect(Promise.all([firstRemoval, repeatedRemoval])).resolves.toEqual([undefined, undefined])
    await expect(other.close('preserve')).rejects.toMatchObject({ code: 'owner-conflict' })
    await ctx.fiber.dispose()

    const recoveredContext = new Context()
    new TestSubprocessRuntime(recoveredContext)
    const recoveredProvider = new GitLocalRepositoryWorkspace(recoveredContext, config)
    const recoveredBase = await recoveredProvider.inspectRevision({ repositoryId, commit: firstCommit })
    const recoveredTarget = await recoveredProvider.inspectRevision({ repositoryId, commit: targetCommit })
    const recovered = await recoveredProvider.openVerification({
      ownerAttemptId,
      base: recoveredBase,
      target: recoveredTarget,
    })
    expect(recovered.cwd).toBe(lease.cwd)
    await recovered.close('preserve')
    await recoveredContext.fiber.dispose()
  })

  it('fails closed without following a link-shaped checkout replacement', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const outside = await temporaryRoot('dsh-repo-workspace-outside')
    const repositoryId = RepositoryId('repository-cleanup')
    const ctx = new Context()
    const subprocess = new TestSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    const base = await workspace.inspectRevision({ repositoryId, commit: firstCommit })
    const ordinary = await workspace.openChange({
      ownerAttemptId: QueueAttemptIdRef('attempt-cleanup-ordinary'),
      base,
    })
    await writeFile(join(ordinary.cwd, 'uncommitted.txt'), 'remove with force\n')
    await ordinary.close('remove')
    await expect(access(ordinary.cwd)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(dirname(ordinary.cwd))).rejects.toMatchObject({ code: 'ENOENT' })
    await ordinary.close('remove')

    const replaced = await workspace.openVerification({
      ownerAttemptId: QueueAttemptIdRef('attempt-cleanup-link'),
      base,
      target: base,
    })
    await rm(replaced.cwd, { recursive: true, force: true })
    await writeFile(join(outside, 'sentinel.txt'), 'must survive\n')
    await symlink(outside, replaced.cwd, 'junction')
    await expect(replaced.close('remove')).rejects.toMatchObject({ code: 'cleanup-failed' })
    expect(await readFile(join(outside, 'sentinel.txt'), 'utf8')).toBe('must survive\n')
    await expect(access(replaced.cwd)).resolves.toBeUndefined()
    expect(subprocess.handles.every(handle => handle.waitForExitCalls === 1)).toBe(true)
    await ctx.fiber.dispose()
  })

  it('leaves checkout bytes and registration untouched when its exact ownership marker is absent or replaced', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-marker-cleanup')
    const outside = await temporaryRoot('dsh-repo-workspace-marker-outside')
    const outsideMarker = join(outside, 'lease.json')
    await writeFile(outsideMarker, 'outside marker\n')
    const repositoryId = RepositoryId('repository-marker-cleanup')
    const ctx = new Context()
    new TestSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    const base = await workspace.inspectRevision({ repositoryId, commit: firstCommit })
    const cases = [
      {
        owner: QueueAttemptIdRef('attempt-cleanup-marker-missing'),
        replace: async (marker: string) => { await unlink(marker) },
      },
      {
        owner: QueueAttemptIdRef('attempt-cleanup-marker-mismatch'),
        replace: async (marker: string) => {
          const original = await readFile(marker, 'utf8')
          await writeFile(marker, original.replace('attempt-cleanup-marker-mismatch', 'attempt-cleanup-marker-Xismatch'))
        },
      },
      {
        owner: QueueAttemptIdRef('attempt-cleanup-marker-linked'),
        replace: async (marker: string) => {
          await unlink(marker)
          await symlink(outsideMarker, marker, 'file')
        },
      },
    ] as const

    for (const testCase of cases) {
      const lease = await workspace.openChange({ ownerAttemptId: testCase.owner, base })
      const sentinel = join(lease.cwd, 'uncommitted.txt')
      await writeFile(sentinel, `owned by ${testCase.owner}\n`)
      const registrationBefore = await fixtureGit(repository, 'worktree', 'list', '--porcelain')
      await testCase.replace(join(dirname(lease.cwd), 'lease.json'))

      await expect(lease.close('remove')).rejects.toMatchObject({ code: 'cleanup-failed' })
      await expect(readFile(sentinel, 'utf8')).resolves.toBe(`owned by ${testCase.owner}\n`)
      expect(await fixtureGit(repository, 'worktree', 'list', '--porcelain')).toBe(registrationBefore)
    }
    expect(await readFile(outsideMarker, 'utf8')).toBe('outside marker\n')
    await ctx.fiber.dispose()
  })

  it('rejects a configured path that is not the repository toplevel', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const nested = join(repository, 'configured-subdirectory')
    await mkdir(nested)
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const repositoryId = RepositoryId('repository-identity')
    const ctx = new Context()
    new TestSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: nested },
      worktreeRoot,
    })

    await expect(workspace.inspectRevision({ repositoryId, commit: firstCommit }))
      .rejects.toMatchObject({ code: 'repository-mismatch' })
    await ctx.fiber.dispose()
  })

  it('rejects unknown repositories, forged proofs, and cross-repository revisions before mutation', async () => {
    const first = await fixtureRepository()
    const second = await fixtureRepository()
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const firstId = RepositoryId('repository-authority-first')
    const secondId = RepositoryId('repository-authority-second')
    const ctx = new Context()
    new TestSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [firstId]: first.repository, [secondId]: second.repository },
      worktreeRoot,
    })
    await expect(workspace.inspectRevision({
      repositoryId: RepositoryId('repository-not-configured'),
      commit: first.firstCommit,
    })).rejects.toMatchObject({ code: 'repository-not-found' })
    const nonRepository = await temporaryRoot('dsh-repo-workspace-not-git')
    const nonRepositoryId = RepositoryId('repository-not-git')
    const nonRepositoryContext = new Context()
    new TestSubprocessRuntime(nonRepositoryContext)
    const unavailable = new GitLocalRepositoryWorkspace(nonRepositoryContext, {
      repositories: { [nonRepositoryId]: nonRepository },
      worktreeRoot,
    })
    await expect(unavailable.inspectRevision({ repositoryId: nonRepositoryId, commit: first.firstCommit }))
      .rejects.toMatchObject({ code: 'repository-not-found' })
    await nonRepositoryContext.fiber.dispose()

    const firstBase = await workspace.resolveBase({
      repositoryId: firstId,
      selectionRule: { kind: 'commit', commit: first.firstCommit },
    })
    const firstRevision = await workspace.inspectRevision({ repositoryId: firstId, commit: first.firstCommit })
    const secondRevision = await workspace.inspectRevision({ repositoryId: secondId, commit: second.firstCommit })
    await expect(workspace.readBlob({
      base: { ...firstBase },
      path: RepositoryRelativePath('tracked.txt'),
      maxBytes: 10,
    })).rejects.toMatchObject({ code: 'revision-not-found' })
    await expect(workspace.inspectRange({ base: firstRevision, target: secondRevision }))
      .rejects.toMatchObject({ code: 'repository-mismatch' })
    await expect(workspace.inspectRange({ base: { ...firstRevision }, target: firstRevision }))
      .rejects.toMatchObject({ code: 'revision-not-found' })
    await expect(workspace.openChange({
      ownerAttemptId: QueueAttemptIdRef('attempt-forged-change'),
      base: { ...firstRevision },
    })).rejects.toMatchObject({ code: 'revision-not-found' })
    await expect(workspace.openVerification({
      ownerAttemptId: QueueAttemptIdRef('attempt-forged-verification'),
      base: firstRevision,
      target: { ...firstRevision },
    })).rejects.toMatchObject({ code: 'revision-not-found' })
    await expect(workspace.openVerification({
      ownerAttemptId: QueueAttemptIdRef('attempt-cross-repository'),
      base: firstRevision,
      target: secondRevision,
    })).rejects.toMatchObject({ code: 'repository-mismatch' })

    const reason = new Error('stop repository operation')
    await expect(workspace.resolveBase({
      repositoryId: firstId,
      selectionRule: { kind: 'commit', commit: first.firstCommit },
      signal: AbortSignal.abort(reason),
    })).rejects.toBe(reason)
    await ctx.fiber.dispose()
  })

  it('rejects linked worktree roots and invalid persisted ownership markers without following them', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const parent = await temporaryRoot('dsh-repo-workspace-root-parent')
    const outside = await temporaryRoot('dsh-repo-workspace-root-outside')
    const linkedRoot = join(parent, 'linked-root')
    await symlink(outside, linkedRoot, 'junction')
    const repositoryId = RepositoryId('repository-safe-root')
    const linkedContext = new Context()
    new TestSubprocessRuntime(linkedContext)
    const linked = new GitLocalRepositoryWorkspace(linkedContext, {
      repositories: { [repositoryId]: repository },
      worktreeRoot: linkedRoot,
    })
    const linkedBase = await linked.inspectRevision({ repositoryId, commit: firstCommit })
    await expect(linked.openChange({
      ownerAttemptId: QueueAttemptIdRef('attempt-linked-root'),
      base: linkedBase,
    })).rejects.toMatchObject({ code: 'unavailable' })
    expect(await readdir(outside)).toEqual([])
    await linkedContext.fiber.dispose()

    const blockingFile = join(parent, 'blocking-file')
    await writeFile(blockingFile, 'not a directory')
    const blockedContext = new Context()
    new TestSubprocessRuntime(blockedContext)
    const blocked = new GitLocalRepositoryWorkspace(blockedContext, {
      repositories: { [repositoryId]: repository },
      worktreeRoot: join(blockingFile, 'worktrees'),
    })
    const blockedBase = await blocked.inspectRevision({ repositoryId, commit: firstCommit })
    await expect(blocked.openChange({
      ownerAttemptId: QueueAttemptIdRef('attempt-blocked-root'),
      base: blockedBase,
    })).rejects.toMatchObject({ code: 'unavailable' })
    await blockedContext.fiber.dispose()

    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const config = { repositories: { [repositoryId]: repository }, worktreeRoot }
    const firstContext = new Context()
    new TestSubprocessRuntime(firstContext)
    const firstProvider = new GitLocalRepositoryWorkspace(firstContext, config)
    const base = await firstProvider.inspectRevision({ repositoryId, commit: firstCommit })
    const lease = await firstProvider.openChange({
      ownerAttemptId: QueueAttemptIdRef('attempt-invalid-marker'),
      base,
    })
    await lease.close('preserve')
    await writeFile(join(dirname(lease.cwd), 'lease.json'), '{')
    await firstContext.fiber.dispose()
    const recoveredContext = new Context()
    new TestSubprocessRuntime(recoveredContext)
    const recovered = new GitLocalRepositoryWorkspace(recoveredContext, config)
    const recoveredBase = await recovered.inspectRevision({ repositoryId, commit: firstCommit })
    await expect(recovered.openChange({
      ownerAttemptId: QueueAttemptIdRef('attempt-invalid-marker'),
      base: recoveredBase,
    })).rejects.toMatchObject({ code: 'owner-conflict' })
    await recoveredContext.fiber.dispose()
  })

  it('rejects an intermediate worktree-root junction before creation', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const parent = await temporaryRoot('dsh-repo-workspace-intermediate-parent')
    const outside = await temporaryRoot('dsh-repo-workspace-intermediate-outside')
    const linkedAncestor = join(parent, 'linked-ancestor')
    await symlink(outside, linkedAncestor, 'junction')
    const repositoryId = RepositoryId('repository-intermediate-root')
    const ctx = new Context()
    new TestSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot: join(linkedAncestor, 'leases'),
    })
    const base = await workspace.inspectRevision({ repositoryId, commit: firstCommit })

    await expect(workspace.openChange({
      ownerAttemptId: QueueAttemptIdRef('attempt-intermediate-root'),
      base,
    })).rejects.toMatchObject({ code: 'unavailable' })
    expect(await readdir(outside)).toEqual([])
    await ctx.fiber.dispose()
  })

  it('rejects a worktree-root identity swap before lease cleanup', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const parent = await temporaryRoot('dsh-repo-workspace-root-swap-parent')
    const worktreeRoot = join(parent, 'leases')
    const movedRoot = join(parent, 'moved-leases')
    await mkdir(worktreeRoot)
    const repositoryId = RepositoryId('repository-root-swap')
    const ctx = new Context()
    new TestSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    const base = await workspace.inspectRevision({ repositoryId, commit: firstCommit })
    const lease = await workspace.openChange({
      ownerAttemptId: QueueAttemptIdRef('attempt-root-swap'),
      base,
    })
    const movedSentinel = join(movedRoot, relative(worktreeRoot, lease.cwd), 'uncommitted.txt')
    await writeFile(join(lease.cwd, 'uncommitted.txt'), 'must survive root swap\n')
    await rename(worktreeRoot, movedRoot)
    await symlink(movedRoot, worktreeRoot, 'junction')

    await expect(lease.close('remove')).rejects.toMatchObject({ code: 'cleanup-failed' })
    await expect(readFile(movedSentinel, 'utf8')).resolves.toBe('must survive root swap\n')
    await unlink(worktreeRoot)
    await rename(movedRoot, worktreeRoot)
    await ctx.fiber.dispose()
  })

  it('classifies malformed Git blob identities, types, sizes, and short reads', async () => {
    const repository = await temporaryRoot('dsh-repo-workspace-scripted')
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const repositoryId = RepositoryId('repository-scripted-blob')
    const commit = GitCommitId('1'.repeat(40))
    const blobId = 'a'.repeat(40)
    const ctx = new Context()
    const subprocess = new ScriptedSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    subprocess.queue(
      { stdout: `${repository}\n` },
      { stdout: `${commit}\n` },
    )
    const base = await workspace.resolveBase({
      repositoryId,
      selectionRule: { kind: 'commit', commit },
    })
    const path = RepositoryRelativePath('tracked.txt')

    subprocess.queue({ stdout: `${repository}\n` }, { stdout: 'not-an-object\n' })
    await expect(workspace.readBlob({ base, path, maxBytes: 100 }))
      .rejects.toMatchObject({ code: 'blob-not-found' })

    subprocess.queue(
      { stdout: `${repository}\n` },
      { stdout: `${blobId}\n` },
      { stdout: 'blob\n' },
      { exitCode: 1 },
    )
    await expect(workspace.readBlob({ base, path, maxBytes: 100 }))
      .rejects.toMatchObject({ code: 'blob-not-found' })

    subprocess.queue(
      { stdout: `${repository}\n` },
      { stdout: `${blobId}\n` },
      { stdout: 'tree\n' },
    )
    await expect(workspace.readBlob({ base, path, maxBytes: 100 }))
      .rejects.toMatchObject({ code: 'blob-not-found' })

    subprocess.queue(
      { stdout: `${repository}\n` },
      { stdout: `${blobId}\n` },
      { stdout: 'blob\n' },
      { stdout: 'not-a-size\n' },
    )
    await expect(workspace.readBlob({ base, path, maxBytes: 100 }))
      .rejects.toMatchObject({ code: 'blob-not-found' })

    subprocess.queue(
      { stdout: `${repository}\n` },
      { stdout: `${blobId}\n` },
      { stdout: 'blob\n' },
      { stdout: new Uint8Array([0xff]) },
    )
    await expect(workspace.readBlob({ base, path, maxBytes: 100 }))
      .rejects.toMatchObject({ code: 'blob-not-found' })

    subprocess.queue(
      { stdout: `${repository}\n` },
      { stdout: `${blobId}\n` },
      { stdout: 'blob\n' },
      { stdout: '3\n' },
      { stdout: new Uint8Array([1, 2]) },
    )
    await expect(workspace.readBlob({ base, path, maxBytes: 100 }))
      .rejects.toMatchObject({ code: 'blob-not-found' })
    expect(subprocess.handles.every(handle => handle.waitForExitCalls === 1)).toBe(true)
    await ctx.fiber.dispose()
  })

  it('classifies Git ancestry, diff, framing, pipe, and output-boundary failures', async () => {
    const repository = await temporaryRoot('dsh-repo-workspace-scripted')
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const repositoryId = RepositoryId('repository-scripted-range')
    const baseCommit = GitCommitId('1'.repeat(40))
    const targetCommit = GitCommitId('2'.repeat(40))
    const ctx = new Context()
    const subprocess = new ScriptedSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
      maxGitOutputBytes: 256,
    })
    subprocess.queue(
      { stdout: `${repository}\n` },
      { stdout: `${baseCommit}\n` },
      { stdout: `${repository}\n` },
      { stdout: `${targetCommit}\n` },
    )
    const base = await workspace.inspectRevision({ repositoryId, commit: baseCommit })
    const target = await workspace.inspectRevision({ repositoryId, commit: targetCommit })

    subprocess.queue({ stdout: `${repository}\n` }, { exitCode: 2 })
    await expect(workspace.inspectRange({ base, target })).rejects.toMatchObject({ code: 'revision-not-found' })
    subprocess.queue({ stdout: `${repository}\n` }, { exitCode: 0 }, { exitCode: 1 })
    await expect(workspace.inspectRange({ base, target })).rejects.toMatchObject({ code: 'revision-not-found' })
    subprocess.queue({ stdout: `${repository}\n` }, { exitCode: 0 }, { stdout: 'not-nul-terminated' })
    await expect(workspace.inspectRange({ base, target })).rejects.toMatchObject({ code: 'unavailable' })
    subprocess.queue({ stdout: `${repository}\n` }, { exitCode: 0 }, { stdout: new Uint8Array([0xff, 0]) })
    await expect(workspace.inspectRange({ base, target })).rejects.toMatchObject({ code: 'unavailable' })
    subprocess.queue({ stdout: `${repository}\n` }, { exitCode: 0 }, { stdout: new Uint8Array() })
    await expect(workspace.inspectRange({ base, target })).resolves.toMatchObject({ changedPaths: [] })
    await ctx.fiber.dispose()

    const missingPipeContext = new Context()
    const missingPipe = new ScriptedSubprocessRuntime(missingPipeContext)
    const missingPipeWorkspace = new GitLocalRepositoryWorkspace(missingPipeContext, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    missingPipe.queue({ omitStdout: true })
    await expect(missingPipeWorkspace.inspectRevision({ repositoryId, commit: baseCommit }))
      .rejects.toMatchObject({ code: 'unavailable' })
    expect(missingPipe.handles[0]?.waitForExitCalls).toBe(1)
    await missingPipeContext.fiber.dispose()

    const overflowContext = new Context()
    const overflow = new ScriptedSubprocessRuntime(overflowContext)
    const overflowWorkspace = new GitLocalRepositoryWorkspace(overflowContext, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
      maxGitOutputBytes: 1,
    })
    overflow.queue({ stdout: 'too large' })
    await expect(overflowWorkspace.inspectRevision({ repositoryId, commit: baseCommit }))
      .rejects.toMatchObject({ code: 'unavailable' })
    expect(overflow.handles[0]).toMatchObject({ terminateCalls: 1, waitForExitCalls: 1 })
    await overflowContext.fiber.dispose()
  })

  it('classifies every governed checkpoint failure stage and preserves abort reasons', async () => {
    let ordinal = 0
    const commit = GitCommitId('1'.repeat(40))
    const checkpointCommit = GitCommitId('2'.repeat(40))

    const scenario = async (
      tail: Parameters<ScriptedSubprocessRuntime['queue']>,
      recoveredHead: string = commit,
    ) => {
      ordinal += 1
      const repository = await temporaryRoot(`dsh-repo-workspace-checkpoint-scripted-${String(ordinal)}`)
      const worktreeRoot = await temporaryRoot(`dsh-repo-workspace-checkpoint-leases-${String(ordinal)}`)
      const repositoryId = RepositoryId(`repository-checkpoint-scripted-${String(ordinal)}`)
      const ctx = new Context()
      const subprocess = new ScriptedSubprocessRuntime(ctx)
      const workspace = new GitLocalRepositoryWorkspace(ctx, {
        repositories: { [repositoryId]: repository },
        worktreeRoot,
      })
      subprocess.queue(
        { stdout: `${repository}\n` },
        { stdout: `${commit}\n` },
        { stdout: `${repository}\n` },
        {
          exitCode: 0,
          check: (spec) => { mkdirSync(String(spec.argv.at(-2))) },
        },
      )
      const base = await workspace.inspectRevision({ repositoryId, commit })
      const lease = await workspace.openChange({
        ownerAttemptId: QueueAttemptIdRef(`attempt-checkpoint-scripted-${String(ordinal)}`),
        base,
      })
      subprocess.queue(
        { stdout: `${recoveredHead}\n` },
        { stdout: `${lease.cwd}\n` },
        { stdout: `${repository}\n` },
        { stdout: `${repository}\n` },
        ...tail,
      )
      return { ctx, lease, subprocess }
    }

    let current = await scenario([{ exitCode: 1 }])
    await expect(current.lease.checkpoint({ message: 'stage fails' }))
      .rejects.toMatchObject({ code: 'checkpoint-failed' })
    await current.ctx.fiber.dispose()

    current = await scenario([{ exitCode: 0 }, { exitCode: 1 }])
    await expect(current.lease.checkpoint({ message: 'commit fails' }))
      .rejects.toMatchObject({ code: 'checkpoint-failed' })
    await current.ctx.fiber.dispose()

    current = await scenario([
      { exitCode: 0 },
      { exitCode: 0 },
      { stdout: `${checkpointCommit}\n` },
      { exitCode: 1 },
    ])
    await expect(current.lease.checkpoint({ message: 'ancestry fails' }))
      .rejects.toMatchObject({ code: 'checkpoint-failed' })
    await current.ctx.fiber.dispose()

    current = await scenario([
      { exitCode: 0 },
      { exitCode: 0 },
      { stdout: `${checkpointCommit}\n` },
      { exitCode: 0 },
      { exitCode: 1 },
    ])
    await expect(current.lease.checkpoint({ message: 'diff fails' }))
      .rejects.toMatchObject({ code: 'checkpoint-failed' })
    await current.ctx.fiber.dispose()

    current = await scenario([
      { exitCode: 0 },
      { exitCode: 0 },
      { stdout: `${checkpointCommit}\n` },
      { exitCode: 0 },
      { stdout: 'tracked.txt\0' },
      { stdout: 'dirty\0' },
    ])
    await expect(current.lease.checkpoint({ message: 'dirty status fails' }))
      .rejects.toMatchObject({ code: 'checkpoint-failed' })
    await current.ctx.fiber.dispose()

    current = await scenario([], 'invalid-recovered-head')
    await expect(current.lease.checkpoint({ message: 'invalid recovery proof' }))
      .rejects.toMatchObject({ code: 'checkpoint-failed' })
    await current.ctx.fiber.dispose()

    current = await scenario([])
    const reason = new Error('stop checkpoint')
    await expect(current.lease.checkpoint({
      message: 'aborted checkpoint',
      signal: AbortSignal.abort(reason),
    })).rejects.toBe(reason)
    await current.ctx.fiber.dispose()
  })

  it('classifies worktree-add, commit-id, and stderr-output infrastructure failures', async () => {
    const repository = await temporaryRoot('dsh-repo-workspace-scripted')
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const repositoryId = RepositoryId('repository-scripted-infrastructure')
    const commit = GitCommitId('1'.repeat(40))

    let ctx = new Context()
    let subprocess = new ScriptedSubprocessRuntime(ctx)
    let workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    subprocess.queue({ stdout: `${repository}\n` }, { stdout: `${commit}\n` })
    let base = await workspace.inspectRevision({ repositoryId, commit })
    subprocess.queue({ stdout: `${repository}\n` }, { exitCode: 1 })
    await expect(workspace.openChange({
      ownerAttemptId: QueueAttemptIdRef('attempt-scripted-add-failure'),
      base,
    })).rejects.toMatchObject({ code: 'unavailable' })
    await ctx.fiber.dispose()

    ctx = new Context()
    subprocess = new ScriptedSubprocessRuntime(ctx)
    workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot: await temporaryRoot('dsh-repo-workspace-verification-add-failure'),
    })
    subprocess.queue(
      { stdout: `${repository}\n` },
      { stdout: `${commit}\n` },
      { stdout: `${repository}\n` },
      { stdout: `${commit}\n` },
    )
    base = await workspace.inspectRevision({ repositoryId, commit })
    const target = await workspace.inspectRevision({ repositoryId, commit })
    subprocess.queue({ stdout: `${repository}\n` }, { exitCode: 1 })
    await expect(workspace.openVerification({
      ownerAttemptId: QueueAttemptIdRef('attempt-scripted-verification-add-failure'),
      base,
      target,
    })).rejects.toMatchObject({ code: 'unavailable' })
    await ctx.fiber.dispose()

    ctx = new Context()
    subprocess = new ScriptedSubprocessRuntime(ctx)
    workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    subprocess.queue({ stdout: `${repository}\n` }, { stdout: 'invalid-commit\n' })
    await expect(workspace.inspectRevision({ repositoryId, commit }))
      .rejects.toMatchObject({ code: 'revision-not-found' })
    subprocess.queue({ stdout: `${repository}\n` }, { stdout: new Uint8Array([0xff]) })
    await expect(workspace.inspectRevision({ repositoryId, commit }))
      .rejects.toMatchObject({ code: 'revision-not-found' })
    await ctx.fiber.dispose()

    ctx = new Context()
    subprocess = new ScriptedSubprocessRuntime(ctx)
    workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
      maxGitOutputBytes: 256,
    })
    subprocess.queue(
      { stdout: `${repository}\n` },
      { stdout: `${commit}\n`, stderr: 'x'.repeat(300) },
    )
    await expect(workspace.inspectRevision({ repositoryId, commit }))
      .rejects.toMatchObject({ code: 'unavailable' })
    expect(subprocess.handles.at(-1)).toMatchObject({ terminateCalls: 1, waitForExitCalls: 1 })
    await ctx.fiber.dispose()

    ctx = new Context()
    subprocess = new ScriptedSubprocessRuntime(ctx)
    workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    subprocess.queue({ stdout: join(repository, 'missing-toplevel') })
    await expect(workspace.inspectRevision({ repositoryId, commit }))
      .rejects.toMatchObject({ code: 'repository-not-found' })
    await ctx.fiber.dispose()
  })

  it('maps Git process startup failures to the stable unavailable error', async () => {
    const repository = await temporaryRoot('dsh-repo-workspace-spawn-failure')
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const repositoryId = RepositoryId('repository-spawn-failure')
    const commit = GitCommitId('1'.repeat(40))
    const ctx = new Context()
    const subprocess = new ScriptedSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    subprocess.queue({
      check: () => { throw new Error('scripted Git spawn failure') },
    })

    await expect(workspace.inspectRevision({ repositoryId, commit })).rejects.toMatchObject({
      code: 'unavailable',
      name: 'RepositoryWorkspaceError',
    })
    await ctx.fiber.dispose()
  })

  it('does not settle a Git operation before whole-tree exit is observed', async () => {
    const repository = await temporaryRoot('dsh-repo-workspace-wait-deferred')
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const repositoryId = RepositoryId('repository-wait-deferred')
    const commit = GitCommitId('1'.repeat(40))
    const ctx = new Context()
    const subprocess = new ScriptedSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    let releaseWait!: (quiescent: boolean) => void
    const waitForExit = new Promise<boolean>((resolve) => { releaseWait = resolve })
    subprocess.queue(
      { stdout: `${repository}\n` },
      { stdout: `${commit}\n`, waitForExit },
    )

    let settled = false
    const operation = workspace.inspectRevision({ repositoryId, commit })
      .finally(() => { settled = true })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(settled).toBe(false)
    expect(subprocess.handles.at(-1)?.waitForExitCalls).toBe(1)
    releaseWait(true)
    await expect(operation).resolves.toMatchObject({ repositoryId, commit })
    await ctx.fiber.dispose()
  })

  it('classifies signaled Git and failed whole-tree quiescence as unavailable', async () => {
    const repository = await temporaryRoot('dsh-repo-workspace-wait-failure')
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-leases')
    const repositoryId = RepositoryId('repository-wait-failure')
    const commit = GitCommitId('1'.repeat(40))
    const ctx = new Context()
    const subprocess = new ScriptedSubprocessRuntime(ctx)
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })

    subprocess.queue({ stdout: `${repository}\n`, exitCode: null, signal: 'SIGTERM' })
    await expect(workspace.inspectRevision({ repositoryId, commit })).rejects.toMatchObject({
      code: 'unavailable',
      name: 'RepositoryWorkspaceError',
    })

    subprocess.queue({ stdout: `${repository}\n`, waitForExit: Promise.resolve(false) })
    await expect(workspace.inspectRevision({ repositoryId, commit })).rejects.toMatchObject({
      code: 'unavailable',
      name: 'RepositoryWorkspaceError',
    })

    const waitFailure = new Error('scripted whole-tree observation failed')
    subprocess.queue({ stdout: `${repository}\n`, waitForExit: Promise.reject(waitFailure) })
    await expect(workspace.inspectRevision({ repositoryId, commit })).rejects.toMatchObject({
      code: 'unavailable',
      name: 'RepositoryWorkspaceError',
      cause: waitFailure,
    })
    expect(subprocess.handles.every(handle => handle.waitForExitCalls === 1)).toBe(true)
    await ctx.fiber.dispose()
  })

  it('retries only exact registration removal and reports every cleanup failure', async () => {
    let ordinal = 0
    const commit = GitCommitId('1'.repeat(40))
    const openLease = async () => {
      ordinal += 1
      const repository = await temporaryRoot(`dsh-repo-workspace-cleanup-scripted-${String(ordinal)}`)
      const worktreeRoot = await temporaryRoot(`dsh-repo-workspace-cleanup-leases-${String(ordinal)}`)
      const repositoryId = RepositoryId(`repository-cleanup-scripted-${String(ordinal)}`)
      const ctx = new Context()
      const subprocess = new ScriptedSubprocessRuntime(ctx)
      const workspace = new GitLocalRepositoryWorkspace(ctx, {
        repositories: { [repositoryId]: repository },
        worktreeRoot,
      })
      subprocess.queue(
        { stdout: `${repository}\n` },
        { stdout: `${commit}\n` },
        { stdout: `${repository}\n` },
        {
          exitCode: 0,
          check: (spec) => { mkdirSync(String(spec.argv.at(-2))) },
        },
      )
      const base = await workspace.inspectRevision({ repositoryId, commit })
      const lease = await workspace.openChange({
        ownerAttemptId: QueueAttemptIdRef(`attempt-cleanup-scripted-${String(ordinal)}`),
        base,
      })
      return { ctx, lease, subprocess }
    }

    let current = await openLease()
    await writeFile(join(current.lease.cwd, 'owned.txt'), 'owned\n')
    current.subprocess.queue(
      { exitCode: 1 },
      { exitCode: 0 },
      { stdout: new Uint8Array() },
    )
    await current.lease.close('remove')
    expect(current.subprocess.specs.filter((spec) => {
      const args = spec.argv.slice(3)
      return args[0] === 'worktree' && args[1] === 'remove'
    })).toHaveLength(2)
    await expect(access(dirname(current.lease.cwd))).rejects.toMatchObject({ code: 'ENOENT' })
    await current.ctx.fiber.dispose()

    current = await openLease()
    current.subprocess.queue({ exitCode: 0 })
    await current.lease.close('remove')
    await current.ctx.fiber.dispose()

    current = await openLease()
    const outsideMarkerRoot = await temporaryRoot('dsh-repo-workspace-cleanup-marker-target')
    const outsideMarker = join(outsideMarkerRoot, 'marker')
    await writeFile(outsideMarker, 'outside marker\n')
    await unlink(join(dirname(current.lease.cwd), 'lease.json'))
    await symlink(outsideMarker, join(dirname(current.lease.cwd), 'lease.json'), 'file')
    await expect(current.lease.close('remove')).rejects.toMatchObject({ code: 'cleanup-failed' })
    await expect(access(current.lease.cwd)).resolves.toBeUndefined()
    expect(await readFile(outsideMarker, 'utf8')).toBe('outside marker\n')
    await current.ctx.fiber.dispose()

    current = await openLease()
    current.subprocess.queue({ exitCode: 1 }, { exitCode: 1 }, { stdout: `worktree ${current.lease.cwd}\0` })
    await expect(current.lease.close('remove')).rejects.toMatchObject({ code: 'cleanup-failed' })
    await current.ctx.fiber.dispose()

    current = await openLease()
    current.subprocess.queue(
      { exitCode: 1 },
      { stdout: `worktree ${current.lease.cwd}\0` },
      { exitCode: 1 },
    )
    await expect(current.lease.close('remove')).rejects.toMatchObject({ code: 'cleanup-failed' })
    await current.ctx.fiber.dispose()

    current = await openLease()
    await unlink(join(dirname(current.lease.cwd), 'lease.json'))
    await expect(current.lease.close('remove')).rejects.toMatchObject({ code: 'cleanup-failed' })
    await current.ctx.fiber.dispose()

    current = await openLease()
    await rm(dirname(current.lease.cwd), { recursive: true, force: true })
    await expect(current.lease.close('remove')).rejects.toMatchObject({ code: 'cleanup-failed' })
    await current.ctx.fiber.dispose()

    current = await openLease()
    await writeFile(join(dirname(current.lease.cwd), 'unexpected.txt'), 'leftover\n')
    current.subprocess.queue({ exitCode: 0 })
    await expect(current.lease.close('remove')).rejects.toMatchObject({ code: 'cleanup-failed' })
    await current.ctx.fiber.dispose()
  })

  it('keeps unrelated stale worktree registrations when exact lease removal needs a retry', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-exact-cleanup')
    const unrelatedParent = await temporaryRoot('dsh-repo-workspace-unrelated-parent')
    const unrelated = join(unrelatedParent, 'stale-worktree')
    await fixtureGit(repository, 'worktree', 'add', '--detach', unrelated, firstCommit)
    await rm(unrelated, { recursive: true, force: true })
    const unrelatedRegistration = await fixtureGit(repository, 'worktree', 'list', '--porcelain')
    const repositoryId = RepositoryId('repository-exact-cleanup')
    let failedSingleForceRemove = false
    const ctx = new Context()
    new TestSubprocessRuntime(ctx, (spec) => {
      const args = spec.argv.slice(3)
      if (
        !failedSingleForceRemove
        && args[0] === 'worktree'
        && args[1] === 'remove'
        && args[2] === '--force'
        && args[3] !== '--force'
      ) {
        failedSingleForceRemove = true
        return true
      }
      return false
    })
    const workspace = new GitLocalRepositoryWorkspace(ctx, {
      repositories: { [repositoryId]: repository },
      worktreeRoot,
    })
    const base = await workspace.inspectRevision({ repositoryId, commit: firstCommit })
    const lease = await workspace.openChange({
      ownerAttemptId: QueueAttemptIdRef('attempt-exact-cleanup'),
      base,
    })

    await lease.close('remove')

    expect(failedSingleForceRemove).toBe(true)
    expect(await fixtureGit(repository, 'worktree', 'list', '--porcelain')).toBe(unrelatedRegistration)
    await ctx.fiber.dispose()
  })

  it('fails closed when persisted lease ownership or recovered Git identity is replaced', async () => {
    const { repository, firstCommit } = await fixtureRepository()
    await writeFile(join(repository, 'tracked.txt'), 'second commit\n')
    await fixtureGit(repository, 'add', '--all')
    await fixtureGit(repository, 'commit', '-m', 'second commit')
    const secondCommit = GitCommitId(await fixtureGit(repository, 'rev-parse', 'HEAD'))
    const worktreeRoot = await temporaryRoot('dsh-repo-workspace-recovery-tamper')
    const outside = await temporaryRoot('dsh-repo-workspace-recovery-outside')
    const repositoryId = RepositoryId('repository-recovery-tamper')
    const config = { repositories: { [repositoryId]: repository }, worktreeRoot }
    const firstContext = new Context()
    new TestSubprocessRuntime(firstContext)
    const firstProvider = new GitLocalRepositoryWorkspace(firstContext, config)
    const base = await firstProvider.inspectRevision({ repositoryId, commit: firstCommit })

    const openPreservedChange = async (owner: string) => {
      const lease = await firstProvider.openChange({ ownerAttemptId: QueueAttemptIdRef(owner), base })
      await lease.close('preserve')
      return lease
    }
    const missingMarker = await openPreservedChange('attempt-recovery-missing-marker')
    await unlink(join(dirname(missingMarker.cwd), 'lease.json'))
    const mismatchedMarker = await openPreservedChange('attempt-recovery-mismatched-marker')
    await writeFile(join(dirname(mismatchedMarker.cwd), 'lease.json'), JSON.stringify({ format: 'wrong' }))
    const linkedMarker = await openPreservedChange('attempt-recovery-linked-marker')
    const outsideMarker = join(outside, 'outside-marker')
    await writeFile(outsideMarker, '{}')
    await unlink(join(dirname(linkedMarker.cwd), 'lease.json'))
    await symlink(outsideMarker, join(dirname(linkedMarker.cwd), 'lease.json'), 'file')
    const fileCheckout = await openPreservedChange('attempt-recovery-file-checkout')
    await rm(fileCheckout.cwd, { recursive: true, force: true })
    await writeFile(fileCheckout.cwd, 'not a checkout')
    const movedHead = await openPreservedChange('attempt-recovery-moved-head')
    await fixtureGit(movedHead.cwd, 'reset', '--hard', secondCommit)
    const clonedCheckout = await openPreservedChange('attempt-recovery-other-common-dir')
    await rm(clonedCheckout.cwd, { recursive: true, force: true })
    await fixtureGit(dirname(clonedCheckout.cwd), 'clone', '--no-local', repository, clonedCheckout.cwd)
    await fixtureGit(clonedCheckout.cwd, 'checkout', '--detach', firstCommit)

    const verificationFile = await firstProvider.openVerification({
      ownerAttemptId: QueueAttemptIdRef('attempt-recovery-verification-file'),
      base,
      target: base,
    })
    await verificationFile.close('preserve')
    await rm(verificationFile.cwd, { recursive: true, force: true })
    await writeFile(verificationFile.cwd, 'not a checkout')
    const linkedOwnerId = QueueAttemptIdRef('attempt-recovery-linked-owner')
    const linkedOwnerHash = createHash('sha256').update(linkedOwnerId, 'utf8').digest('hex')
    await symlink(outside, join(worktreeRoot, `attempt-${linkedOwnerHash}`), 'junction')
    await firstContext.fiber.dispose()

    const recoveredContext = new Context()
    new TestSubprocessRuntime(recoveredContext)
    const recovered = new GitLocalRepositoryWorkspace(recoveredContext, config)
    const recoveredBase = await recovered.inspectRevision({ repositoryId, commit: firstCommit })
    const expectChangeConflict = async (ownerAttemptId: QueueAttemptIdRef) => {
      await expect(recovered.openChange({ ownerAttemptId, base: recoveredBase }))
        .rejects.toMatchObject({ code: 'owner-conflict' })
    }
    await expectChangeConflict(QueueAttemptIdRef('attempt-recovery-missing-marker'))
    await expectChangeConflict(QueueAttemptIdRef('attempt-recovery-mismatched-marker'))
    await expectChangeConflict(QueueAttemptIdRef('attempt-recovery-linked-marker'))
    await expectChangeConflict(QueueAttemptIdRef('attempt-recovery-file-checkout'))
    await expectChangeConflict(QueueAttemptIdRef('attempt-recovery-moved-head'))
    await expect(recovered.openChange({
      ownerAttemptId: QueueAttemptIdRef('attempt-recovery-other-common-dir'),
      base: recoveredBase,
    })).rejects.toMatchObject({ code: 'repository-mismatch' })
    await expect(recovered.openVerification({
      ownerAttemptId: QueueAttemptIdRef('attempt-recovery-verification-file'),
      base: recoveredBase,
      target: recoveredBase,
    })).rejects.toMatchObject({ code: 'owner-conflict' })
    await expectChangeConflict(linkedOwnerId)
    expect(await readFile(outsideMarker, 'utf8')).toBe('{}')
    await recoveredContext.fiber.dispose()
  })
})

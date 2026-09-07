import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { GitCommitId, QueueAttemptIdRef, RepositoryId } from '@changanhua/dsh-delivery-protocol'
import GitLocalRepositoryWorkspace from '@changanhua/dsh-repo-workspace-git-local'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { expect, it } from 'vitest'

const run = promisify(execFile)

it('restores checkpoint bytes after lease removal, provider restart, and Git garbage collection', { timeout: 30_000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-delivery-checkpoint-retention-'))
  const repository = join(temp, 'repository')
  const repositoryId = RepositoryId('checkpoint-retention')
  const config = { repositories: { [repositoryId]: repository }, worktreeRoot: join(temp, 'worktrees') }
  const ctx = new Context()
  const reopened = new Context()
  try {
    await mkdir(repository)
    await run('git', ['-C', repository, 'init', '--initial-branch=main'])
    await run('git', ['-C', repository, 'config', 'user.email', 'retention@example.test'])
    await run('git', ['-C', repository, 'config', 'user.name', 'Retention Test'])
    await run('git', ['-C', repository, 'config', 'core.autocrlf', 'false'])
    await writeFile(join(repository, 'tracked.txt'), 'base\n')
    await run('git', ['-C', repository, 'add', '.'])
    await run('git', ['-C', repository, 'commit', '-m', 'base'])
    const baseCommit = GitCommitId((await run('git', ['-C', repository, 'rev-parse', 'HEAD'])).stdout.trim())
    await ctx.plugin(LocalSubprocess)
    await ctx.plugin(GitLocalRepositoryWorkspace, config)
    const base = await ctx.repoWorkspace.inspectRevision({ repositoryId, commit: baseCommit })
    const change = await ctx.repoWorkspace.openChange({
      ownerAttemptId: QueueAttemptIdRef('retained-change'), base,
    })
    await writeFile(join(change.cwd, 'tracked.txt'), 'retained delivery\n')
    await writeFile(join(change.cwd, 'new.txt'), 'new artifact\n')
    const checkpoint = await change.checkpoint({ message: 'retain this delivery' })
    await change.close('remove')
    await expect(access(change.cwd)).rejects.toMatchObject({ code: 'ENOENT' })
    await ctx.fiber.dispose()

    // This repository is created by this test and has no concurrent Git writers.
    await run('git', ['-C', repository, 'reflog', 'expire', '--expire=now', '--all'])
    await run('git', ['-C', repository, 'gc', '--prune=now'])
    await reopened.plugin(LocalSubprocess)
    await reopened.plugin(GitLocalRepositoryWorkspace, config)
    const restoredBase = await reopened.repoWorkspace.inspectRevision({ repositoryId, commit: baseCommit })
    const target = await reopened.repoWorkspace.inspectRevision({ repositoryId, commit: checkpoint.checkpointCommit })
    const verification = await reopened.repoWorkspace.openVerification({
      ownerAttemptId: QueueAttemptIdRef('restored-verification'), base: restoredBase, target,
    })
    expect(await readFile(join(verification.cwd, 'tracked.txt'), 'utf8')).toBe('retained delivery\n')
    expect(await readFile(join(verification.cwd, 'new.txt'), 'utf8')).toBe('new artifact\n')
    expect((await run('git', ['-C', repository, 'rev-parse', 'refs/heads/main'])).stdout.trim()).toBe(baseCommit)
    expect(await readFile(join(repository, 'tracked.txt'), 'utf8')).toBe('base\n')
    await verification.close('remove')
  } finally {
    await reopened.fiber.dispose()
    await ctx.fiber.dispose()
    await rm(temp, { recursive: true, force: true })
  }
})

it('resolves a temporary Git checkout through the production subprocess provider', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-personal-delivery-git-'))
  const repository = join(temp, 'repository')
  const ctx = new Context()
  try {
    await mkdir(repository)
    await run('git', ['-C', repository, 'init', '--initial-branch=main'])
    await run('git', ['-C', repository, 'config', 'user.email', 'acceptance@example.test'])
    await run('git', ['-C', repository, 'config', 'user.name', 'Acceptance'])
    await writeFile(join(repository, 'README.md'), 'base\n')
    await run('git', ['-C', repository, 'add', '.'])
    await run('git', ['-C', repository, 'commit', '-m', 'base'])
    const commit = (await run('git', ['-C', repository, 'rev-parse', 'HEAD'])).stdout.trim()

    await ctx.plugin(LocalSubprocess)
    await ctx.plugin(GitLocalRepositoryWorkspace, {
      repositories: { workspace: repository },
      worktreeRoot: join(temp, 'worktrees'),
    })

    await expect(ctx.repoWorkspace.resolveBase({
      repositoryId: RepositoryId('workspace'),
      selectionRule: { kind: 'commit', commit: GitCommitId(commit) },
    })).resolves.toMatchObject({ repositoryId: 'workspace', commit })
  } finally {
    await ctx.fiber.dispose()
    await rm(temp, { recursive: true, force: true })
  }
})

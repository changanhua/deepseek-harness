import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { GitCommitId, RepositoryId } from '@deepseek-ai/dsh-delivery-protocol'
import GitLocalRepositoryWorkspace from '@deepseek-ai/dsh-repo-workspace-git-local'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { expect, it } from 'vitest'

const run = promisify(execFile)

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

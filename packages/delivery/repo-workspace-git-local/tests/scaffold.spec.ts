import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  Config,
  GitLocalRepositoryWorkspace,
} from '../src/index.ts'

function scaffold(): GitLocalRepositoryWorkspace {
  return Object.create(GitLocalRepositoryWorkspace.prototype) as GitLocalRepositoryWorkspace
}

describe('local Git repository workspace unavailable boundary', () => {
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

  it('rejects every Git operation before starting a subprocess', async () => {
    const workspace = scaffold()
    const calls = [
      workspace.resolveBase({} as never),
      workspace.inspectRevision({} as never),
      workspace.readBlob({} as never),
      workspace.inspectRange({} as never),
      workspace.openChange({} as never),
      workspace.openVerification({} as never),
    ]

    for (const call of calls) {
      await expect(call).rejects.toMatchObject({
        code: 'unavailable',
        name: 'RepositoryWorkspaceError',
      })
    }
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  importGitHubIssue,
} from '../src/index.ts'
import type { GitHubIssueIntakeDependencies } from '../src/index.ts'
import { RepositoryId } from '@deepseek-ai/dsh-delivery-protocol'

const repositoryId = RepositoryId('fixture-repository')

function dependencies(): GitHubIssueIntakeDependencies {
  return {
    delivery: {
      adoptContractRevision: vi.fn(),
      snapshot: vi.fn(),
    },
    fetch: vi.fn(),
  }
}

describe('GitHub Issue intake unavailable boundary', () => {
  it.each([
    'owner/repository/issues/42',
    'http://github.com/example/project/issues/42',
    'https://localhost/example/project/issues/42',
    'https://evil.example/example/project/issues/42',
    'https://GitHub.com/example/project/issues/42',
    'https://github.com.evil/example/project/issues/42',
    'https://github.com@evil.example/example/project/issues/42',
    'https://user:token@github.com/example/project/issues/42',
    'https://github.com:443/example/project/issues/42',
    'https://github.com/example/project/issues/42?view=1',
    'https://github.com/example/project/issues/42#comment',
    'https://github.com/example/project/issues/42/comments',
    'https://github.com/example/project/issues/42/',
    'https://github.com/%65xample/project/issues/42',
    'https://github.com/example/project%2Fissues/42',
    'https://github.com/example/project/issues/0',
    'https://github.com/example/project/issues/01',
    'https://github.com/example/project/issues/9007199254740992',
  ])('rejects non-canonical or unsafe Issue URL %s', async (issueUrl) => {
    const deps = dependencies()
    await expect(importGitHubIssue(deps, {
      issueUrl,
      repositoryId,
    })).rejects.toEqual(expect.objectContaining({
      code: 'invalid-request',
      name: 'DeliveryGitHubIntakeError',
    }))
    expect(deps.fetch).not.toHaveBeenCalled()
    expect(deps.delivery.snapshot).not.toHaveBeenCalled()
    expect(deps.delivery.adoptContractRevision).not.toHaveBeenCalled()
  })

  it.each([
    'https://github.com/example/project/issues/1',
    'https://github.com/deepseek-ai/deepseek_harness.v2/issues/42',
    'https://github.com/openai/.github/issues/9007199254740991',
  ])('admits canonical Issue URL %s to the unavailable scaffold', async (issueUrl) => {
    const deps = dependencies()
    await expect(importGitHubIssue(deps, {
      issueUrl,
      repositoryId,
    })).rejects.toEqual(expect.objectContaining({
      code: 'unavailable',
      name: 'DeliveryGitHubIntakeError',
    }))
    expect(deps.fetch).not.toHaveBeenCalled()
    expect(deps.delivery.snapshot).not.toHaveBeenCalled()
    expect(deps.delivery.adoptContractRevision).not.toHaveBeenCalled()
  })
})

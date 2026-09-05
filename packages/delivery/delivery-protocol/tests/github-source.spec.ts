import {
  canonicalGitHubIssueUrl,
  gitHubIssueRefSchema,
  isCanonicalGitHubIssueUrl,
  isGitHubRepositoryName,
  isGitHubRepositoryOwner,
  parseCanonicalGitHubIssueUrl,
  requirementOriginSchema,
  type GitHubRepositoryRef,
} from '@changanhua/dsh-delivery-protocol'
import { describe, expect, it } from 'vitest'

const repository: GitHubRepositoryRef = {
  owner: 'deepseek-ai',
  name: 'deepseek-harness',
}

function issueRefCandidate(
  url: string,
  overrides: {
    readonly repository?: GitHubRepositoryRef
    readonly issueNumber?: number
  } = {},
): unknown {
  return {
    repository: overrides.repository ?? repository,
    issueNumber: overrides.issueNumber ?? 13,
    url,
  }
}

function githubImportOriginCandidate(
  overrides: {
    readonly repository?: GitHubRepositoryRef
    readonly issueNumber?: number
    readonly contentDigest?: string
  } = {},
): unknown {
  return {
    kind: 'github-import',
    repository: overrides.repository ?? repository,
    issueNumber: overrides.issueNumber ?? 13,
    contentDigest: overrides.contentDigest ?? `sha256:${'a'.repeat(64)}`,
  }
}

describe('canonical GitHub Issue coordinates', () => {
  it('constructs, parses, and validates the exact public Issue coordinates', () => {
    const url = canonicalGitHubIssueUrl(repository, 13)
    expect(url).toBe('https://github.com/deepseek-ai/deepseek-harness/issues/13')
    expect(parseCanonicalGitHubIssueUrl(url)).toEqual({ repository, issueNumber: 13 })
    expect(isCanonicalGitHubIssueUrl(url, repository, 13)).toBe(true)
    expect(gitHubIssueRefSchema.parse(issueRefCandidate(url))).toMatchObject({
      repository,
      issueNumber: 13,
      url,
    })
  })

  it('accepts a github-import requirement origin with canonical coordinates', () => {
    expect(requirementOriginSchema.parse(githubImportOriginCandidate())).toMatchObject({
      kind: 'github-import',
      repository,
      issueNumber: 13,
    })
    expect(requirementOriginSchema.parse({ kind: 'human', actorId: 'user-local' })).toEqual({
      kind: 'human',
      actorId: 'user-local',
    })
  })

  it.each([
    ['credentials', 'https://operator@github.com/deepseek-ai/deepseek-harness/issues/13'],
    ['query', 'https://github.com/deepseek-ai/deepseek-harness/issues/13?view=1'],
    ['fragment', 'https://github.com/deepseek-ai/deepseek-harness/issues/13#issuecomment-1'],
    ['port', 'https://github.com:443/deepseek-ai/deepseek-harness/issues/13'],
    ['different host', 'https://github.example/deepseek-ai/deepseek-harness/issues/13'],
    ['HTTP', 'http://github.com/deepseek-ai/deepseek-harness/issues/13'],
    ['leading-zero Issue', 'https://github.com/deepseek-ai/deepseek-harness/issues/013'],
    ['trailing slash', 'https://github.com/deepseek-ai/deepseek-harness/issues/13/'],
    ['encoded coordinate', 'https://github.com/deepseek-ai/deepseek%2Dharness/issues/13'],
    ['unsafe Issue', 'https://github.com/deepseek-ai/deepseek-harness/issues/9007199254740992'],
  ])('rejects a non-canonical %s URL', (_name, url) => {
    expect(parseCanonicalGitHubIssueUrl(url)).toBeUndefined()
    expect(isCanonicalGitHubIssueUrl(url, repository, 13)).toBe(false)
    expect(gitHubIssueRefSchema.safeParse(issueRefCandidate(url)).success).toBe(false)
  })

  it.each([
    ['owner', 'https://github.com/other/deepseek-harness/issues/13'],
    ['repository', 'https://github.com/deepseek-ai/other/issues/13'],
    ['Issue', 'https://github.com/deepseek-ai/deepseek-harness/issues/14'],
  ])('rejects a canonical URL for different %s coordinates', (_name, url) => {
    expect(parseCanonicalGitHubIssueUrl(url)).toBeDefined()
    expect(isCanonicalGitHubIssueUrl(url, repository, 13)).toBe(false)
    expect(gitHubIssueRefSchema.safeParse(issueRefCandidate(url)).success).toBe(false)
  })

  it.each([
    ['owner', '-leading'],
    ['owner', 'trailing-'],
    ['owner', 'double--hyphen'],
    ['owner', 'a'.repeat(40)],
    ['repository', '.'],
    ['repository', '..'],
    ['repository', 'nested/name'],
    ['repository', 'a'.repeat(101)],
  ])('rejects invalid GitHub %s grammar %s', (kind, value) => {
    const candidateRepository = kind === 'owner'
      ? { ...repository, owner: value }
      : { ...repository, name: value }
    expect(isGitHubRepositoryOwner(candidateRepository.owner)
      && isGitHubRepositoryName(candidateRepository.name)).toBe(false)
    expect(gitHubIssueRefSchema.safeParse(issueRefCandidate(
      `https://github.com/${candidateRepository.owner}/${candidateRepository.name}/issues/13`,
      { repository: candidateRepository },
    )).success).toBe(false)
    expect(requirementOriginSchema.safeParse(githubImportOriginCandidate({
      repository: candidateRepository,
    })).success).toBe(false)
  })

  it('rejects non-positive or non-digest github-import origin fields', () => {
    expect(requirementOriginSchema.safeParse(githubImportOriginCandidate({ issueNumber: 0 })).success).toBe(false)
    expect(requirementOriginSchema.safeParse(githubImportOriginCandidate({ contentDigest: 'md5:abc' })).success).toBe(false)
    expect(requirementOriginSchema.safeParse({ kind: 'human', actorId: ' ' }).success).toBe(false)
  })

  it('rejects invalid coordinates before constructing a URL', () => {
    expect(() => canonicalGitHubIssueUrl({ ...repository, owner: 'double--hyphen' }, 13)).toThrow(TypeError)
    expect(() => canonicalGitHubIssueUrl({ ...repository, name: '..' }, 13)).toThrow(TypeError)
    expect(() => canonicalGitHubIssueUrl(repository, 0)).toThrow(TypeError)
    expect(() => canonicalGitHubIssueUrl(repository, Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError)
  })
})

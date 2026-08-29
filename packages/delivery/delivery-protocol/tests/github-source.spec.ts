import {
  DELIVERY_SCHEMA_VERSION,
  canonicalGitHubIssueUrl,
  isCanonicalGitHubIssueUrl,
  isGitHubRepositoryName,
  isGitHubRepositoryOwner,
  parseCanonicalGitHubIssueUrl,
  sourceRefContentDigest,
  sourceRefSchema,
  type GitHubRepositoryRef,
} from '@deepseek-ai/dsh-delivery-protocol'
import { describe, expect, it } from 'vitest'

const repository: GitHubRepositoryRef = {
  owner: 'deepseek-ai',
  name: 'deepseek-harness',
}
const title = 'Canonical GitHub Issue source'
const body = 'Adopt only the exact public Issue coordinates.'

function sourceCandidate(
  canonicalUrl: string,
  overrides: {
    readonly repository?: GitHubRepositoryRef
    readonly issueNumber?: number
  } = {},
): unknown {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    id: 'source-github-canonical',
    provider: 'github',
    repository: overrides.repository ?? repository,
    issueNumber: overrides.issueNumber ?? 13,
    canonicalUrl,
    updatedAt: '2026-08-29T12:00:00.000Z',
    title,
    body,
    contentDigest: sourceRefContentDigest({ title, body }),
    createdAt: '2026-08-29T12:01:00.000Z',
  }
}

describe('canonical GitHub Issue SourceRef', () => {
  it('constructs, parses, and validates the exact public Issue coordinates', () => {
    const url = canonicalGitHubIssueUrl(repository, 13)
    expect(url).toBe('https://github.com/deepseek-ai/deepseek-harness/issues/13')
    expect(parseCanonicalGitHubIssueUrl(url)).toEqual({ repository, issueNumber: 13 })
    expect(isCanonicalGitHubIssueUrl(url, repository, 13)).toBe(true)
    expect(sourceRefSchema.parse(sourceCandidate(url))).toMatchObject({
      repository,
      issueNumber: 13,
      canonicalUrl: url,
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
  ])('rejects a non-canonical %s URL', (_name, url) => {
    expect(parseCanonicalGitHubIssueUrl(url)).toBeUndefined()
    expect(isCanonicalGitHubIssueUrl(url, repository, 13)).toBe(false)
    expect(sourceRefSchema.safeParse(sourceCandidate(url)).success).toBe(false)
  })

  it.each([
    ['owner', 'https://github.com/other/deepseek-harness/issues/13'],
    ['repository', 'https://github.com/deepseek-ai/other/issues/13'],
    ['Issue', 'https://github.com/deepseek-ai/deepseek-harness/issues/14'],
  ])('rejects a canonical URL for different %s coordinates', (_name, url) => {
    expect(parseCanonicalGitHubIssueUrl(url)).toBeDefined()
    expect(isCanonicalGitHubIssueUrl(url, repository, 13)).toBe(false)
    expect(sourceRefSchema.safeParse(sourceCandidate(url)).success).toBe(false)
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
    expect(sourceRefSchema.safeParse(sourceCandidate(
      `https://github.com/${candidateRepository.owner}/${candidateRepository.name}/issues/13`,
      { repository: candidateRepository },
    )).success).toBe(false)
  })

  it('rejects invalid coordinates before constructing a URL', () => {
    expect(() => canonicalGitHubIssueUrl({ ...repository, owner: 'double--hyphen' }, 13)).toThrow(TypeError)
    expect(() => canonicalGitHubIssueUrl({ ...repository, name: '..' }, 13)).toThrow(TypeError)
    expect(() => canonicalGitHubIssueUrl(repository, 0)).toThrow(TypeError)
    expect(() => canonicalGitHubIssueUrl(repository, Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError)
  })
})

/** Canonical GitHub coordinates used by Delivery Protocol source references. */

import type { GitHubRepositoryRef } from './types.ts'

const GITHUB_OWNER_PATTERN = /^(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u
const GITHUB_REPOSITORY_NAME_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/u
const GITHUB_ISSUE_URL_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/([1-9][0-9]*)$/u

/** Coordinates recovered from one canonical public GitHub Issue URL. */
export interface CanonicalGitHubIssueCoordinates {
  readonly repository: GitHubRepositoryRef
  readonly issueNumber: number
}

/**
 * Test whether a value is a GitHub repository-owner coordinate.
 * @param value - Candidate owner without URL encoding or path separators.
 * @returns whether the value uses GitHub's bounded alphanumeric/hyphen grammar.
 */
export function isGitHubRepositoryOwner(value: string): boolean {
  return GITHUB_OWNER_PATTERN.test(value)
}

/**
 * Test whether a value is a GitHub repository-name coordinate.
 * @param value - Candidate repository name without URL encoding or path separators.
 * @returns whether the value uses GitHub's bounded repository-name grammar.
 */
export function isGitHubRepositoryName(value: string): boolean {
  return GITHUB_REPOSITORY_NAME_PATTERN.test(value)
}

/**
 * Construct the one canonical GitHub Issue URL for exact repository coordinates.
 * @param repository - Valid GitHub repository owner and name.
 * @param issueNumber - Positive safe-integer Issue number.
 * @returns an exact HTTPS github.com Issue URL without credentials, port, query, fragment, or trailing slash.
 */
export function canonicalGitHubIssueUrl(
  repository: GitHubRepositoryRef,
  issueNumber: number,
): string {
  if (!isGitHubRepositoryOwner(repository.owner)) {
    throw new TypeError('GitHub repository owner has invalid grammar')
  }
  if (!isGitHubRepositoryName(repository.name)) {
    throw new TypeError('GitHub repository name has invalid grammar')
  }
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new TypeError('GitHub Issue number must be a positive safe integer')
  }
  return `https://github.com/${repository.owner}/${repository.name}/issues/${String(issueNumber)}`
}

/**
 * Parse a canonical public GitHub Issue URL into exact coordinates.
 * @param value - Candidate URL string.
 * @returns exact repository and Issue coordinates, or `undefined` for any non-canonical form.
 */
export function parseCanonicalGitHubIssueUrl(
  value: string,
): CanonicalGitHubIssueCoordinates | undefined {
  const match = GITHUB_ISSUE_URL_PATTERN.exec(value)
  if (match === null) return undefined
  // The fixed regular expression has exactly three mandatory capture groups.
  const [, owner, name, issueText] = match as unknown as [string, string, string, string]
  const repository = { owner, name }
  const issueNumber = Number(issueText)
  if (!isGitHubRepositoryOwner(owner)
    || !isGitHubRepositoryName(name)
    || !Number.isSafeInteger(issueNumber)
    || issueNumber <= 0) {
    return undefined
  }
  /* v8 ignore next -- the pattern already enforces the canonical byte form; this guard contains future regex widening. */
  if (canonicalGitHubIssueUrl(repository, issueNumber) !== value) {
    return undefined
  }
  return { repository, issueNumber }
}

/**
 * Match a URL against the canonical GitHub Issue URL for exact coordinates.
 * @param value - Candidate URL string.
 * @param repository - Expected GitHub repository owner and name.
 * @param issueNumber - Expected positive safe-integer Issue number.
 * @returns whether the candidate is byte-for-byte canonical for the coordinates.
 */
export function isCanonicalGitHubIssueUrl(
  value: string,
  repository: GitHubRepositoryRef,
  issueNumber: number,
): boolean {
  const parsed = parseCanonicalGitHubIssueUrl(value)
  return parsed !== undefined
    && parsed.repository.owner === repository.owner
    && parsed.repository.name === repository.name
    && parsed.issueNumber === issueNumber
}

/** Deterministic human-readable GitHub Issue rendering for Delivery Cases. */

import {
  canonicalDigest,
  issuePublicationIdForRevision,
  type ContractRevision,
  type DeliveryCaseId,
  type IssuePublicationId,
  type Sha256Digest,
} from '@changanhua/dsh-delivery-protocol'

/** Maximum UTF-8 bytes emitted as one complete GitHub Issue body. */
export const GITHUB_ISSUE_BODY_MAX_BYTES = 64 * 1024

/** Rendered Issue payload and its independently verifiable publication marker. */
export interface RenderedGitHubIssue {
  readonly publicationId: IssuePublicationId
  readonly title: string
  /** Canonical body content before the terminal marker. */
  readonly content: string
  /** Complete GitHub Issue body, including the terminal marker. */
  readonly body: string
  /** Digest of `{ body: content, title }`; the marker itself is excluded. */
  readonly renderedDigest: Sha256Digest
  readonly marker: string
}

/**
 * Render one immutable Case revision as a GitHub Issue.
 * @param caseId - Owning Delivery Case identity.
 * @param revision - Exact immutable revision to publish.
 * @returns title, canonical marker-free content, digest, and complete body.
 */
export function renderGitHubIssue(
  caseId: DeliveryCaseId,
  revision: ContractRevision,
): RenderedGitHubIssue {
  const publicationId = issuePublicationIdForRevision(caseId, revision.id)
  const content = [
    '## Outcome',
    '',
    revision.outcome ?? '',
    '',
    '## Context',
    '',
    revision.context,
    '',
    '## Scope',
    '',
    '### Allowed',
    '',
    renderList(revision.allowedScope),
    '',
    '### Forbidden',
    '',
    renderList(revision.forbiddenScope),
    '',
    '## Acceptance',
    '',
    revision.acceptanceClauses.length === 0
      ? '- None.'
      : revision.acceptanceClauses.map(clause => `- [ ] **${clause.id}**: ${clause.text}`).join('\n'),
    '',
    '## Open Decisions',
    '',
    revision.openDecisions.length === 0
      ? '- None.'
      : revision.openDecisions.map(decision => `- **${decision.id}**: ${decision.question}`).join('\n'),
    '',
    '## References',
    '',
    revision.referenceLinks.length === 0
      ? '- None.'
      : revision.referenceLinks.map(reference => `- [${reference.label}](${reference.url})`).join('\n'),
    '',
    '## Delivery Identity',
    '',
    `- Case: ${caseId}`,
    `- Revision: ${revision.id}`,
    `- Publication: ${publicationId}`,
  ].join('\n')
  const renderedDigest = canonicalDigest({ body: content, title: revision.title })
  const marker = `<!-- dsh-delivery-publication@1 id=${publicationId} digest=${renderedDigest} -->`
  const body = `${content}\n\n${marker}`
  if (new TextEncoder().encode(body).byteLength > GITHUB_ISSUE_BODY_MAX_BYTES) {
    throw new RangeError(`GitHub Issue body exceeds ${String(GITHUB_ISSUE_BODY_MAX_BYTES)} UTF-8 bytes`)
  }
  return {
    publicationId,
    title: revision.title,
    content,
    body,
    renderedDigest,
    marker,
  }
}

function renderList(values: readonly string[]): string {
  return values.length === 0 ? '- None.' : values.map(value => `- ${value}`).join('\n')
}

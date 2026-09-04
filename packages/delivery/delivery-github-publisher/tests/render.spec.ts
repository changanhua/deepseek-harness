import {
  AcceptanceClauseId,
  ContractRevisionId,
  DELIVERY_SCHEMA_VERSION,
  DeliveryCaseId,
  RepositoryId,
  VerificationCheckId,
  type ContractRevision,
} from '@changanhua/dsh-delivery-protocol'
import { describe, expect, it } from 'vitest'
import { GITHUB_ISSUE_BODY_MAX_BYTES, renderGitHubIssue } from '../src/render.ts'

const caseId = DeliveryCaseId('delivery-case-render')
const revision: ContractRevision = {
  schemaVersion: DELIVERY_SCHEMA_VERSION,
  id: ContractRevisionId('contract-revision-render'),
  previousRevisionId: null,
  origin: { kind: 'human', actorId: 'human-render' },
  title: 'Ship the publisher',
  repositoryId: RepositoryId('workspace'),
  outcome: 'Ship the publisher.',
  context: 'Delivery coordinates GitHub.',
  allowedScope: ['packages/delivery'],
  forbiddenScope: ['secrets'],
  acceptanceClauses: [
    { id: AcceptanceClauseId('render-body'), text: 'Renders a stable body.' },
    { id: AcceptanceClauseId('publish-once'), text: 'Publishes once.' },
  ],
  openDecisions: [],
  baseSelectionRule: { kind: 'ref-head', ref: 'refs/heads/main' },
  verificationSource: {
    kind: 'contract-field',
    checks: [{
      id: VerificationCheckId('publisher-check'),
      name: 'Publisher check',
      argv: ['node', '--version'],
      cwd: '.',
      timeoutMs: 5_000,
      severity: 'required',
      expectedExitCodes: [0],
    }],
  },
  referenceLinks: [{ label: 'Architecture', url: 'https://example.test/architecture' }],
  createdAt: '2026-08-31T00:00:00.000Z',
}

describe('GitHub Issue rendering', () => {
  it('renders the exact Case revision with a verifiable terminal marker', () => {
    const publicationId = 'issue-publication-2e36c132b820921a5ac034c6ad56bf4131dd3e68a448f3ab8cb0eb90642a249e'
    const digest = 'sha256:e00a63f9ccf7e82360a04e48705eab0bbab265ede60bd1ff7b3a9550282976d1'
    const content = [
      '## Outcome',
      '',
      'Ship the publisher.',
      '',
      '## Context',
      '',
      'Delivery coordinates GitHub.',
      '',
      '## Scope',
      '',
      '### Allowed',
      '',
      '- packages/delivery',
      '',
      '### Forbidden',
      '',
      '- secrets',
      '',
      '## Acceptance',
      '',
      '- [ ] **render-body**: Renders a stable body.',
      '- [ ] **publish-once**: Publishes once.',
      '',
      '## Open Decisions',
      '',
      '- None.',
      '',
      '## References',
      '',
      '- [Architecture](https://example.test/architecture)',
      '',
      '## Delivery Identity',
      '',
      '- Case: delivery-case-render',
      '- Revision: contract-revision-render',
      `- Publication: ${publicationId}`,
    ].join('\n')
    const marker = `<!-- dsh-delivery-publication@1 id=${publicationId} digest=${digest} -->`

    expect(renderGitHubIssue(caseId, revision)).toEqual({
      publicationId,
      title: revision.title,
      content,
      body: `${content}\n\n${marker}`,
      renderedDigest: digest,
      marker,
    })
  })

  it('rejects the complete rendered body when UTF-8 bytes exceed the bound', () => {
    const oversized = {
      ...revision,
      context: '界'.repeat(GITHUB_ISSUE_BODY_MAX_BYTES),
    }

    expect(() => renderGitHubIssue(caseId, oversized)).toThrow(/body exceeds/iu)
  })
})

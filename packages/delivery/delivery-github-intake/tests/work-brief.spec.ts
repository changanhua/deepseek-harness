import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DELIVERY_WORK_BRIEF_MARKER,
  DELIVERY_WORK_BRIEF_MAX_BYTES,
  gitHubIssueWorkBriefSchema,
  parseGitHubIssueWorkBrief,
  workBriefContractRevisionDraft,
} from '../src/index.ts'
import {
  ContractRevisionId,
  RepositoryId,
} from '@deepseek-ai/dsh-delivery-protocol'
import { describe, expect, it } from 'vitest'

const fixtureRoot = join(import.meta.dirname, '..', 'fixtures')
const validBody = await readFile(join(fixtureRoot, 'work-brief.valid.md'), 'utf8')
const invalid = JSON.parse(
  await readFile(join(fixtureRoot, 'work-brief.invalid.json'), 'utf8'),
) as {
  readonly fixtureVersion: number
  readonly cases: readonly {
    readonly id: string
    readonly body: string
    readonly errorCode: string
  }[]
}

describe('GitHub Issue Work Brief contract', () => {
  it('parses the golden brief and maps every field without defaults', () => {
    const brief = parseGitHubIssueWorkBrief(validBody)
    expect(brief).toMatchObject({
      format: 'dsh-delivery-work-brief@1',
      allowedScope: ['Reader semantic-zoom UI and mock fixtures'],
      forbiddenScope: ['Database, migration, API, and parser changes'],
      baseSelectionRule: { kind: 'ref-head', ref: 'refs/heads/main' },
      verificationSource: { kind: 'contract-field' },
    })
    const draft = workBriefContractRevisionDraft(
      brief,
      RepositoryId('easy-reader'),
      ContractRevisionId('contract-revision-prior'),
    )
    expect(draft).toEqual({
      previousRevisionId: 'contract-revision-prior',
      repositoryId: 'easy-reader',
      outcome: brief.outcome,
      context: brief.context,
      allowedScope: brief.allowedScope,
      forbiddenScope: brief.forbiddenScope,
      acceptanceClauses: brief.acceptanceClauses,
      openDecisions: brief.openDecisions,
      baseSelectionRule: brief.baseSelectionRule,
      verificationSource: brief.verificationSource,
      referenceLinks: brief.referenceLinks,
    })
  })

  it.each(invalid.cases)('rejects golden invalid $id', ({ body, errorCode }) => {
    expect(() => parseGitHubIssueWorkBrief(body)).toThrow(
      expect.objectContaining({ code: errorCode }),
    )
  })

  it('rejects duplicate authoritative blocks', () => {
    expect(() => parseGitHubIssueWorkBrief(`${validBody}\n${validBody}`)).toThrow(
      expect.objectContaining({ code: 'duplicate-block' }),
    )
  })

  it('rejects an authoritative fence without an exact closing line', () => {
    expect(() => parseGitHubIssueWorkBrief(
      `${DELIVERY_WORK_BRIEF_MARKER}\n\`\`\`yaml\nformat: dsh-delivery-work-brief@1`,
    )).toThrow(expect.objectContaining({ code: 'invalid-fence' }))
  })

  it.each([
    ['acceptance clause', (brief: ReturnType<typeof parseGitHubIssueWorkBrief>) => ({
      ...brief,
      acceptanceClauses: [{ ...brief.acceptanceClauses[0]!, id: 'Bad_ID' }],
    })],
    ['open decision', (brief: ReturnType<typeof parseGitHubIssueWorkBrief>) => ({
      ...brief,
      openDecisions: [{ id: 'Bad_ID', question: 'Which UI state wins?' }],
    })],
    ['verification check', (brief: ReturnType<typeof parseGitHubIssueWorkBrief>) => ({
      ...brief,
      verificationSource: {
        ...brief.verificationSource,
        checks: [{
          ...(
            brief.verificationSource.kind === 'contract-field'
              ? brief.verificationSource.checks[0]!
              : {}
          ),
          id: 'Bad_ID',
        }],
      },
    })],
  ])('rejects a non-stable %s id', (_label, mutate) => {
    const brief = parseGitHubIssueWorkBrief(validBody)
    expect(gitHubIssueWorkBriefSchema.safeParse(mutate(brief)).success).toBe(false)
  })

  it('accepts a stable open-decision id', () => {
    const brief = parseGitHubIssueWorkBrief(validBody)
    expect(gitHubIssueWorkBriefSchema.safeParse({
      ...brief,
      openDecisions: [{ id: 'ui-state', question: 'Which UI state wins?' }],
    }).success).toBe(true)
  })

  it('rejects YAML aliases and an oversized authoritative block', () => {
    const aliasBody = `${DELIVERY_WORK_BRIEF_MARKER}\n\`\`\`yaml\na: &a [1]\nb: *a\n\`\`\``
    expect(() => parseGitHubIssueWorkBrief(aliasBody)).toThrow(
      expect.objectContaining({ code: 'invalid-yaml' }),
    )
    const oversized = `${DELIVERY_WORK_BRIEF_MARKER}\n\`\`\`yaml\n${'x'.repeat(DELIVERY_WORK_BRIEF_MAX_BYTES + 1)}\n\`\`\``
    expect(() => parseGitHubIssueWorkBrief(oversized)).toThrow(
      expect.objectContaining({ code: 'too-large' }),
    )
  })
})

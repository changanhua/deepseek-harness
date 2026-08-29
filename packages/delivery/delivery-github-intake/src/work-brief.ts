/** Exact GitHub Issue Work Brief grammar for Delivery Contract adoption. */

import type { ContractRevisionDraft } from '@deepseek-ai/dsh-delivery'
import {
  acceptanceClauseSchema,
  baseSelectionRuleSchema,
  contractVerificationSourceSchema,
  openDecisionSchema,
  referenceLinkSchema,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  AcceptanceClause,
  BaseSelectionRule,
  ContractRevisionId,
  ContractVerificationSource,
  OpenDecision,
  ReferenceLink,
  RepositoryId,
} from '@deepseek-ai/dsh-delivery-protocol'
import { parseDocument } from 'yaml'
import { z } from 'zod'

/** Exact marker immediately preceding the authoritative YAML fence. */
export const DELIVERY_WORK_BRIEF_MARKER = '<!-- dsh-delivery-work-brief@1 -->'
/** Maximum UTF-8 byte length of the authoritative YAML block. */
export const DELIVERY_WORK_BRIEF_MAX_BYTES = 64 * 1024

/** Parsed, complete requirement fields authored in one GitHub Issue. */
export interface GitHubIssueWorkBrief {
  readonly format: 'dsh-delivery-work-brief@1'
  readonly outcome: string
  readonly context: string
  readonly allowedScope: readonly string[]
  readonly forbiddenScope: readonly string[]
  readonly acceptanceClauses: readonly AcceptanceClause[]
  readonly openDecisions: readonly OpenDecision[]
  readonly baseSelectionRule: BaseSelectionRule
  readonly verificationSource: ContractVerificationSource
  readonly referenceLinks: readonly ReferenceLink[]
}

const nonBlank = z.string().refine(value => value.trim().length > 0, {
  message: 'must be non-blank',
})
const stableId = /^[a-z][a-z0-9-]{0,63}$/u
const uniqueStrings = z.array(nonBlank).refine(
  values => new Set(values).size === values.length,
  { message: 'must not contain duplicates' },
)

/** Runtime schema for the YAML value inside the authoritative Work Brief fence. */
export const gitHubIssueWorkBriefSchema: z.ZodType<GitHubIssueWorkBrief> = z.object({
  format: z.literal('dsh-delivery-work-brief@1'),
  outcome: nonBlank,
  context: z.string(),
  allowedScope: uniqueStrings,
  forbiddenScope: uniqueStrings,
  acceptanceClauses: z.array(acceptanceClauseSchema).min(1).refine(
    clauses => new Set(clauses.map(clause => clause.id)).size === clauses.length,
    { message: 'acceptance clause ids must be unique' },
  ),
  openDecisions: z.array(openDecisionSchema).refine(
    decisions => new Set(decisions.map(decision => decision.id)).size === decisions.length,
    { message: 'open decision ids must be unique' },
  ),
  baseSelectionRule: baseSelectionRuleSchema,
  verificationSource: contractVerificationSourceSchema,
  referenceLinks: z.array(referenceLinkSchema),
}).strict().superRefine((brief, context) => {
  if (brief.allowedScope.length === 0 && brief.forbiddenScope.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['allowedScope'],
      message: 'at least one allowed or forbidden scope item is required',
    })
  }
  for (const [index, clause] of brief.acceptanceClauses.entries()) {
    if (!stableId.test(clause.id)) {
      context.addIssue({
        code: 'custom',
        path: ['acceptanceClauses', index, 'id'],
        message: 'must match ^[a-z][a-z0-9-]{0,63}$',
      })
    }
  }
  for (const [index, decision] of brief.openDecisions.entries()) {
    if (!stableId.test(decision.id)) {
      context.addIssue({
        code: 'custom',
        path: ['openDecisions', index, 'id'],
        message: 'must match ^[a-z][a-z0-9-]{0,63}$',
      })
    }
  }
  if (brief.verificationSource.kind === 'contract-field') {
    for (const [index, check] of brief.verificationSource.checks.entries()) {
      if (!stableId.test(check.id)) {
        context.addIssue({
          code: 'custom',
          path: ['verificationSource', 'checks', index, 'id'],
          message: 'must match ^[a-z][a-z0-9-]{0,63}$',
        })
      }
    }
  }
})

/** Stable Work Brief parse-failure classification. */
export type GitHubIssueWorkBriefErrorCode =
  | 'missing-block'
  | 'duplicate-block'
  | 'invalid-fence'
  | 'too-large'
  | 'invalid-yaml'
  | 'invalid-brief'

/** Typed failure for an Issue whose authoritative Work Brief cannot be adopted. */
export class GitHubIssueWorkBriefError extends Error {
  /**
   * @param code - Stable grammar or value failure classification.
   * @param message - Human-readable diagnostic.
   * @param options - Optional YAML or schema failure.
   */
  constructor(
    readonly code: GitHubIssueWorkBriefErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'GitHubIssueWorkBriefError'
  }
}

function authoritativeYaml(body: string): string {
  const lines = body.split(/\r?\n/u)
  const markers = lines.flatMap((line, index) =>
    line === DELIVERY_WORK_BRIEF_MARKER ? [index] : [])
  if (markers.length === 0) {
    throw new GitHubIssueWorkBriefError(
      'missing-block',
      `Issue body must contain ${DELIVERY_WORK_BRIEF_MARKER}`,
    )
  }
  if (markers.length !== 1) {
    throw new GitHubIssueWorkBriefError(
      'duplicate-block',
      'Issue body must contain exactly one authoritative Work Brief marker',
    )
  }
  const marker = markers[0] as number
  if (lines[marker + 1] !== '```yaml') {
    throw new GitHubIssueWorkBriefError(
      'invalid-fence',
      'Work Brief marker must be followed immediately by an exact ```yaml fence',
    )
  }
  const close = lines.indexOf('```', marker + 2)
  if (close < 0) {
    throw new GitHubIssueWorkBriefError(
      'invalid-fence',
      'Work Brief YAML fence is not closed by an exact ``` line',
    )
  }
  const yaml = lines.slice(marker + 2, close).join('\n')
  if (new TextEncoder().encode(yaml).byteLength > DELIVERY_WORK_BRIEF_MAX_BYTES) {
    throw new GitHubIssueWorkBriefError(
      'too-large',
      `Work Brief YAML exceeds ${String(DELIVERY_WORK_BRIEF_MAX_BYTES)} UTF-8 bytes`,
    )
  }
  return yaml
}

/**
 * Parse the one authoritative Work Brief YAML block in a GitHub Issue body.
 * Narrative outside the marked fence is non-authoritative context.
 * @param body - Exact GitHub Issue body snapshot.
 * @returns the complete validated requirement fields.
 */
export function parseGitHubIssueWorkBrief(body: string): GitHubIssueWorkBrief {
  const yaml = authoritativeYaml(body)
  const document = parseDocument(yaml, { prettyErrors: true, uniqueKeys: true })
  if (document.errors.length !== 0) {
    throw new GitHubIssueWorkBriefError(
      'invalid-yaml',
      'Work Brief block must be one valid YAML document with unique keys',
      { cause: document.errors[0] },
    )
  }
  let value: unknown
  try {
    value = document.toJS({ maxAliasCount: 0 }) as unknown
  } catch (cause) {
    throw new GitHubIssueWorkBriefError(
      'invalid-yaml',
      'Work Brief YAML aliases and cyclic values are not allowed',
      { cause },
    )
  }
  const parsed = gitHubIssueWorkBriefSchema.safeParse(value)
  if (!parsed.success) {
    throw new GitHubIssueWorkBriefError(
      'invalid-brief',
      'Work Brief must contain every exact dsh-delivery-work-brief@1 field',
      { cause: parsed.error },
    )
  }
  return parsed.data
}

/**
 * Map one validated Work Brief to the exact Delivery adoption draft.
 * @param brief - Parsed authoritative Issue fields.
 * @param repositoryId - Operator-selected configured repository identity.
 * @param previousRevisionId - Host-derived previous revision for this Issue.
 * @returns a complete immutable Contract revision draft.
 */
export function workBriefContractRevisionDraft(
  brief: GitHubIssueWorkBrief,
  repositoryId: RepositoryId,
  previousRevisionId: ContractRevisionId | null,
): ContractRevisionDraft {
  return structuredClone({
    previousRevisionId,
    repositoryId,
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
}

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  acceptanceDecisionFindings,
  acceptanceDecisionSchema,
  changedPathBoundaryFindings,
  completionClaimEvidenceFindings,
  completionClaimSchema,
  contractReadiness,
  contractRevisionSchema,
  evidenceBytesMatch,
  evidenceRefSchema,
  RepositoryRelativePath,
  repositoryPathMatchesRule,
  verificationPlanSchema,
  verificationVerdictPlanFindings,
  verificationVerdictSchema,
} from '@deepseek-ai/dsh-delivery-protocol'
import { describe, expect, it } from 'vitest'

const fixtures = JSON.parse(await readFile(join(import.meta.dirname, '..', 'fixtures', 'valid.json'), 'utf8')) as {
  readonly contractRevisions: readonly unknown[]
  readonly completionClaims: readonly unknown[]
  readonly evidenceRefs: readonly unknown[]
  readonly verificationPlans: readonly unknown[]
  readonly verificationVerdicts: readonly unknown[]
  readonly acceptanceDecisions: readonly unknown[]
}

describe('cross-object Delivery semantics', () => {
  it('freezes exact, inclusive subtree, and forbidden-first path semantics', () => {
    const root = RepositoryRelativePath('packages/delivery')
    const child = RepositoryRelativePath('packages/delivery/src/index.ts')
    const sibling = RepositoryRelativePath('packages/client/index.ts')
    const lockfile = RepositoryRelativePath('pnpm-lock.yaml')
    expect(repositoryPathMatchesRule(root, { kind: 'subtree', path: root })).toBe(true)
    expect(repositoryPathMatchesRule(child, { kind: 'subtree', path: root })).toBe(true)
    expect(repositoryPathMatchesRule(child, { kind: 'exact', path: root })).toBe(false)
    expect(repositoryPathMatchesRule(sibling, { kind: 'subtree', path: root })).toBe(false)
    expect(changedPathBoundaryFindings(
      [child, sibling, lockfile, lockfile],
      [{ kind: 'subtree', path: root }, { kind: 'exact', path: lockfile }],
      [{ kind: 'exact', path: lockfile }, { kind: 'subtree', path: root }],
    )).toEqual([
      { path: child, kind: 'forbidden' },
      { path: sibling, kind: 'outside-allowed' },
      { path: lockfile, kind: 'forbidden' },
    ])
    expect(changedPathBoundaryFindings(
      [sibling, lockfile],
      [],
      [{ kind: 'exact', path: lockfile }],
    )).toEqual([{ path: lockfile, kind: 'forbidden' }])
  })

  it('derives readiness without storing a writable Contract status', () => {
    const ready = contractRevisionSchema.parse(fixtures.contractRevisions[0])
    expect(contractReadiness(ready)).toEqual({ ready: true, reasons: [] })
    const blocked = contractRevisionSchema.parse({
      ...ready,
      repositoryId: null,
      outcome: null,
      allowedScope: [],
      forbiddenScope: [],
      acceptanceClauses: [],
      baseSelectionRule: null,
      verificationSource: null,
      openDecisions: [{ id: 'decision-1', question: 'Choose a boundary.' }],
    })
    expect(contractReadiness(blocked)).toEqual({
      ready: false,
      reasons: [
        'missing-outcome',
        'missing-repository',
        'missing-scope',
        'missing-acceptance',
        'missing-base-selection',
        'missing-verification-source',
        'open-decisions',
      ],
    })
  })

  it('requires a completed claim to reference matching Git evidence from its Queue Attempt', () => {
    const claim = completionClaimSchema.parse(fixtures.completionClaims[0])
    const evidence = fixtures.evidenceRefs.map(reference => evidenceRefSchema.parse(reference))
    expect(completionClaimEvidenceFindings(claim, evidence)).toEqual([])
    expect(completionClaimEvidenceFindings(claim, [])).toEqual([
      'completion claim references missing evidence evidence-git',
      'completed claim requires matching Git evidence from its producing Queue Attempt',
    ])
  })

  it('binds verdict check identities to the exact trusted plan', () => {
    const plan = verificationPlanSchema.parse(fixtures.verificationPlans[0])
    const verdict = verificationVerdictSchema.parse(fixtures.verificationVerdicts[0])
    expect(verificationVerdictPlanFindings(verdict, plan)).toEqual([])
    expect(verificationVerdictPlanFindings({
      ...verdict,
      checkResults: [{ ...verdict.checkResults[0]!, severity: 'optional' }],
    }, plan)).toContain('check result check-typecheck has the wrong severity')
  })

  it('allows acceptance only for the matching passed verdict', () => {
    const accepted = acceptanceDecisionSchema.parse(fixtures.acceptanceDecisions[0])
    const passed = verificationVerdictSchema.parse(fixtures.verificationVerdicts[0])
    const failed = verificationVerdictSchema.parse(fixtures.verificationVerdicts[1])
    expect(acceptanceDecisionFindings(accepted, passed)).toEqual([])
    expect(acceptanceDecisionFindings(accepted, failed)).toContain('accepted decision requires a matching passed verdict')
  })

  it('checks immutable evidence bytes against both length and digest', () => {
    const evidence = evidenceRefSchema.parse(fixtures.evidenceRefs[0])
    expect(evidenceBytesMatch(evidence, Buffer.from('checkpoint\n'))).toBe(true)
    expect(evidenceBytesMatch(evidence, Buffer.from('tampered\n'))).toBe(false)
  })
})

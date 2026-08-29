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
    const blocked = completionClaimSchema.parse(fixtures.completionClaims[1])
    expect(completionClaimEvidenceFindings(blocked, [])).toEqual([])
  })

  it('binds verdict check identities to the exact trusted plan', () => {
    const plan = verificationPlanSchema.parse(fixtures.verificationPlans[0])
    const verdict = verificationVerdictSchema.parse(fixtures.verificationVerdicts[0])
    const exited = verdict.checkResults[0]!
    if (exited.status !== 'exited') throw new TypeError('fixture must carry an exited result')
    expect(verificationVerdictPlanFindings(verdict, plan)).toEqual([])
    expect(verificationVerdictPlanFindings({
      ...verdict,
      checkResults: [{ ...exited, severity: 'optional' }],
    }, plan)).toContain('check result check-typecheck has the wrong severity')
    expect(verificationVerdictPlanFindings({
      ...verdict,
      verificationPlanDigest: 'sha256:' + '0'.repeat(64) as never,
      checkResults: [],
    }, plan)).toEqual([
      'verdict plan digest does not match the trusted plan',
      'verdict is missing check result check-typecheck',
    ])
    expect(verificationVerdictPlanFindings({
      ...verdict,
      checkResults: [{
        ...exited,
        checkId: 'check-other' as never,
        checkDigest: 'sha256:' + '0'.repeat(64) as never,
        expected: false,
      }],
    }, plan)).toEqual([
      'verdict is missing check result check-typecheck',
      'verdict contains unplanned check result check-other',
    ])
    expect(verificationVerdictPlanFindings({
      ...verdict,
      checkResults: [{
        ...exited,
        checkDigest: 'sha256:' + '0'.repeat(64) as never,
        expected: false,
      }],
    }, plan)).toEqual([
      'check result check-typecheck has the wrong command digest',
      'check result check-typecheck has an inconsistent expected flag',
    ])
    const { exitCode: _exitCode, expected: _expected, ...common } = exited
    expect(verificationVerdictPlanFindings({
      ...verdict,
      checkResults: [{ ...common, status: 'timed-out' }],
    }, plan)).toEqual([])
  })

  it('allows acceptance only for the matching passed verdict', () => {
    const accepted = acceptanceDecisionSchema.parse(fixtures.acceptanceDecisions[0])
    const passed = verificationVerdictSchema.parse(fixtures.verificationVerdicts[0])
    const failed = verificationVerdictSchema.parse(fixtures.verificationVerdicts[1])
    expect(acceptanceDecisionFindings(accepted, passed)).toEqual([])
    expect(acceptanceDecisionFindings(accepted, failed)).toContain('accepted decision requires a matching passed verdict')
    expect(acceptanceDecisionFindings({
      ...accepted,
      verdictId: 'verdict-other' as never,
      packetId: 'packet-other' as never,
      targetCommit: 'c'.repeat(40) as never,
    }, passed)).toEqual([
      'decision verdict id does not match the supplied verdict',
      'decision packet id does not match the verdict',
      'decision target commit does not match the verdict',
    ])
  })

  it('rejects verdict statuses whose attached findings contradict their disposition', () => {
    const passed = verificationVerdictSchema.parse(fixtures.verificationVerdicts[0])
    const cases = [
      { ...passed, status: 'needs-human-review', reviewReasons: [] },
      {
        ...passed,
        changedPathFindings: [{
          path: RepositoryRelativePath('packages/other'),
          kind: 'outside-allowed',
        }],
      },
      {
        ...passed,
        evidenceIntegrityFindings: passed.evidenceIntegrityFindings.map((finding, index) =>
          index === 0 ? { ...finding, status: 'missing' } : finding),
      },
      { ...passed, reviewReasons: ['Manual review remains required.'] },
    ]
    for (const candidate of cases) {
      expect(verificationVerdictSchema.safeParse(candidate).success).toBe(false)
    }
  })

  it('rejects impossible calendar instants at the shared timestamp boundary', () => {
    const evidence = evidenceRefSchema.parse(fixtures.evidenceRefs[0])
    for (const createdAt of [
      '2026-13-01T00:00:00Z',
      '2026-02-30T00:00:00Z',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:60:00Z',
      '2026-01-01T00:00:60Z',
    ]) {
      expect(evidenceRefSchema.safeParse({ ...evidence, createdAt }).success).toBe(false)
    }
  })

  it('checks immutable evidence bytes against both length and digest', () => {
    const evidence = evidenceRefSchema.parse(fixtures.evidenceRefs[0])
    expect(evidenceBytesMatch(evidence, Buffer.from('checkpoint\n'))).toBe(true)
    expect(evidenceBytesMatch(evidence, Buffer.from('tampered\n'))).toBe(false)
  })
})

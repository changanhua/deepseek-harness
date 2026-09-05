import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import { afterEach, describe, expect, test } from 'vitest'
import {
  defaultLabRoot,
  deriveCapabilityStatuses,
  loadCurriculum,
  loadEvidence,
  recommendNext,
  validateLab,
} from '../learning/dsh-mastery/tooling/runtime.ts'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-mastery-'))
  tempRoots.push(root)
  await mkdir(path.join(root, 'lessons'), { recursive: true })
  await mkdir(path.join(root, 'cases'), { recursive: true })
  await mkdir(path.join(root, 'evidence'), { recursive: true })
  await writeFile(path.join(root, 'lessons/a.md'), '# A\n')
  await writeFile(path.join(root, 'lessons/b.md'), '# B\n')
  await writeFile(path.join(root, 'cases/c.md'), '# C\n')
  await writeFile(path.join(root, 'CURRICULUM.yaml'), yaml.dump({
    version: 1,
    name: 'Fixture Lab',
    capabilities: {
      source_navigation: {},
      state_ownership: {},
    },
    units: [
      {
        id: 'a', type: 'lesson', path: 'lessons/a.md',
        trains: ['state_ownership'], prerequisites: [], evidence: ['a-transfer'],
      },
      {
        id: 'b', type: 'trace', path: 'lessons/b.md',
        trains: ['source_navigation', 'state_ownership'], prerequisites: ['a'], evidence: ['b-trace'],
      },
      {
        id: 'c', type: 'case_study', path: 'cases/c.md',
        trains: ['state_ownership'], prerequisites: ['b'],
        reveal_policy: 'reconstruct_before_reading_existing_design',
        evidence: ['independent_design_before_reveal', 'review_findings'],
      },
    ],
    routing: { default_path: ['a', 'b', 'c'] },
    assessment: { no_manual_progress_file: true },
  }))
  return root
}

async function writeEvidence(root: string, name: string, value: unknown): Promise<void> {
  await writeFile(path.join(root, 'evidence', name), yaml.dump(value))
}

describe('DSH Mastery runtime', () => {
  test('the repository learning runtime validates itself', async () => {
    expect(defaultLabRoot()).toMatch(/learning[\\/]dsh-mastery$/)
    expect(await validateLab()).toEqual([])
  })

  test('routes to the earliest incomplete prerequisite', async () => {
    const root = await fixture()
    const curriculum = await loadCurriculum(root)
    const evidence = await loadEvidence(root)
    expect(recommendNext(curriculum, evidence)?.unit.id).toBe('a')

    await writeEvidence(root, '2026-08-27__a.yaml', {
      version: 1,
      unit: 'a',
      recorded_at: '2026-08-27T10:00:00Z',
      evidence_items: { 'a-transfer': 'pass' },
      assessment: { demonstrated: { state_ownership: 'pass' } },
    })
    expect(recommendNext(curriculum, await loadEvidence(root))?.unit.id).toBe('b')
  })

  test('requires source pins for source-grounded evidence', async () => {
    const root = await fixture()
    await writeEvidence(root, '2026-08-27__b.yaml', {
      version: 1,
      unit: 'b',
      recorded_at: '2026-08-27T10:00:00Z',
      evidence_items: { 'b-trace': 'pass' },
      assessment: { demonstrated: { source_navigation: 'pass' } },
    })
    const issues = await validateLab(root)
    expect(issues.some(issue => issue.code === 'source-pin-required')).toBe(true)
  })

  test('blocks post-reveal case evidence until an earlier independent design passes', async () => {
    const root = await fixture()
    await writeEvidence(root, '2026-08-27__c-review.yaml', {
      version: 1,
      unit: 'c',
      recorded_at: '2026-08-27T10:00:00Z',
      evidence_items: { review_findings: 'pass' },
    })
    expect((await validateLab(root)).some(issue => issue.code === 'case-revealed-too-early')).toBe(true)

    await writeEvidence(root, '2026-08-26__c-independent.yaml', {
      version: 1,
      unit: 'c',
      recorded_at: '2026-08-26T10:00:00Z',
      evidence_items: { independent_design_before_reveal: 'pass' },
    })
    expect((await validateLab(root)).some(issue => issue.code === 'case-revealed-too-early')).toBe(false)
  })

  test('derives strong capability only from transfer across distinct units', async () => {
    const root = await fixture()
    await writeEvidence(root, '2026-08-26__a.yaml', {
      version: 1,
      unit: 'a',
      recorded_at: '2026-08-26T10:00:00Z',
      evidence_items: { 'a-transfer': 'pass' },
      assessment: { demonstrated: { state_ownership: 'pass' } },
    })
    await writeEvidence(root, '2026-08-27__b.yaml', {
      version: 1,
      unit: 'b',
      recorded_at: '2026-08-27T10:00:00Z',
      source: { repository: 'owner/repo', commit: 'abcdef123456' },
      evidence_items: { 'b-trace': 'pass' },
      assessment: { demonstrated: { state_ownership: 'pass' } },
    })
    const curriculum = await loadCurriculum(root)
    const statuses = deriveCapabilityStatuses(curriculum, await loadEvidence(root))
    expect(statuses.find(status => status.capability === 'state_ownership')?.state).toBe('strong')
  })

  test('rejects a second manual progress store', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'PROGRESS.md'), '# manual state\n')
    expect((await validateLab(root)).some(issue => issue.code === 'manual-progress-store')).toBe(true)
  })
})

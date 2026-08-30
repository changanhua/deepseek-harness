/** propose/promote：授权与证据门槛必须同时满足。 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dump as dumpYaml, load as loadYaml } from 'js-yaml'
import { proposeCandidate } from './propose-candidate.ts'
import { promoteCandidate } from './promote.ts'

let tmp: string | undefined

function setupRun(root: string, runId: string, withVerification = false): void {
  const runsDir = join(root, '.dsh-intelligence', 'runs', runId)
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(join(runsDir, 'adp.yaml'), 'id: adp-test\nrevision: 1\ntask:\n  desired_outcomes: [seed]\n', 'utf8')
  if (withVerification) {
    writeFileSync(join(runsDir, 'verification.json'), JSON.stringify({ blocked_findings: [{ rule_id: 'C03' }] }), 'utf8')
  }
}

function writeVerifiedCase(root: string, id: string): void {
  const dir = join(root, '.agents', 'dsh-intelligence', 'knowledge', 'cases')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.yaml`), dumpYaml({ id, status: 'verified' }), 'utf8')
}

function enrichCandidate(file: string, patch: Record<string, unknown>): void {
  const record = loadYaml(readFileSync(file, 'utf8')) as Record<string, unknown>
  writeFileSync(file, dumpYaml({ ...record, ...patch }), 'utf8')
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = undefined
})

describe('propose-candidate / promote', () => {
  it('propose writes a candidate; promotion without authorization throws', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-int-'))
    tmp = root
    setupRun(root, 'run-1')
    const { file, record } = proposeCandidate('run-1', 'pattern', 'explicit user request', { root })
    expect(existsSync(file)).toBe(true)
    expect(record.status).toBe('candidate')
    expect(() => promoteCandidate(file, '', { root })).toThrow(/authorization/)
  })

  it('does not turn one approved run into a validated Pattern', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-int-'))
    tmp = root
    setupRun(root, 'run-2')
    const { file } = proposeCandidate('run-2', 'pattern', 'blocking finding fixed', { root })
    expect(() => promoteCandidate(file, 'human-reviewer', { root })).toThrow(/pattern promotion requires/)
  })

  it('promotes a Pattern only after applicability and evidence prerequisites are satisfied', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-int-'))
    tmp = root
    setupRun(root, 'run-3')
    writeVerifiedCase(root, 'case-a')
    const { file } = proposeCandidate('run-3', 'pattern', 'recurring finding', { root })
    enrichCandidate(file, {
      applies_when: ['durable restart-surviving scheduler'],
      does_not_apply_when: ['process-local job'],
      evidence_cases: ['case-a'],
      source_contract_refs: ['packages/task-queue/task-queue/README.md'],
    })
    const dest = promoteCandidate(file, 'human-reviewer', { root })
    expect(existsSync(dest)).toBe(true)
    const promoted = loadYaml(readFileSync(dest, 'utf8')) as { status?: string; provenance?: { promoted_by?: string } }
    expect(promoted.status).toBe('validated')
    expect(promoted.provenance?.promoted_by).toBe('human-reviewer')
  })

  it('requires verification evidence before a Case becomes verified', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-int-'))
    tmp = root
    setupRun(root, 'run-4', true)
    const { file } = proposeCandidate('run-4', 'case', 'runtime/review evidence', { root })
    const dest = promoteCandidate(file, 'human-reviewer', { root })
    const promoted = loadYaml(readFileSync(dest, 'utf8')) as { status?: string }
    expect(promoted.status).toBe('verified')
  })
})

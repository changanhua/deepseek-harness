/**
 * propose/promote 测试：只 propose 不 promote；promotion 需要显式授权。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { load as loadYaml } from 'js-yaml'
import { proposeCandidate } from './propose-candidate.ts'
import { promoteCandidate } from './promote.ts'

let tmp: string | undefined

function setupRun(root: string, runId: string): void {
  const runsDir = join(root, '.dsh-intelligence', 'runs', runId)
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(join(runsDir, 'adp.yaml'), 'id: adp-test\nrevision: 1\ntask:\n  desired_outcomes: [seed]\n', 'utf8')
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = undefined
})

describe('propose-candidate / promote', () => {
  it('propose writes a candidate; promote without authorization throws', () => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-int-'))
    setupRun(tmp, 'run-1')
    const { file, record } = proposeCandidate('run-1', 'pattern', 'explicit user request', { root: tmp })
    expect(existsSync(file)).toBe(true)
    expect(record.status).toBe('candidate')
    expect(() => promoteCandidate(file, '', { root: tmp })).toThrow(/authorization/)
  })

  it('promote moves the candidate into patterns and marks it validated', () => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-int-'))
    setupRun(tmp, 'run-2')
    const { file } = proposeCandidate('run-2', 'pattern', 'blocking finding fixed', { root: tmp })
    const dest = promoteCandidate(file, 'human-reviewer', { root: tmp })
    expect(existsSync(dest)).toBe(true)
    expect(existsSync(file)).toBe(false)
    const promoted = loadYaml(readFileSync(dest, 'utf8')) as { status?: string; provenance?: { promoted_by?: string } }
    expect(promoted.status).toBe('validated')
    expect(promoted.provenance.promoted_by).toBe('human-reviewer')
    const patternsDir = join(tmp, '.agents', 'dsh-intelligence', 'knowledge', 'patterns')
    expect(readdirSync(patternsDir).some(f => f.includes('run-2'))).toBe(true)
  })

  it('promotes an anti-pattern by provenance artifact_kind', () => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-int-'))
    setupRun(tmp, 'run-3')
    const { file } = proposeCandidate('run-3', 'anti-pattern', 'recurring finding', { root: tmp })
    const dest = promoteCandidate(file, 'human-reviewer', { root: tmp })
    expect(dest.split(/[\\/]/)).toContain('anti-patterns')
  })
})

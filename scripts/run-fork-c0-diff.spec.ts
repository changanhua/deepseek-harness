import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  c0PathChanged,
  newFailureDiagnostics,
  normalizeDiagnostics,
  runGateAt,
  type GateSnapshot,
} from './run-fork-c0-diff.ts'
import type { Gate } from './run-gates.ts'

describe('fork C0 differential gate', () => {
  it('recognizes Delivery C0-owned paths without treating foundation packages as C0', () => {
    expect(c0PathChanged([
      'packages/delivery/delivery-protocol/src/index.ts',
      'docs/subsystems/delivery.md',
    ])).toBe(true)
    expect(c0PathChanged(['packages/task-queue/task-queue/src/index.ts'])).toBe(false)
  })

  it('normalizes checkout roots, separators, ANSI, and volatile durations', () => {
    const diagnostics = normalizeDiagnostics([
      '\u001B[31mC:\\ci\\head\\packages\\delivery\\x.ts:12 failed in 1.23s\u001B[0m',
      'run-gates: PASS stable (0.42s)',
      'Start at  23:48:11',
      '../../tsconfig.base.json:6:14:',
      '│ Total: │ 1606 │ 339557 │ 15 │',
      '│ typescript │ 1443 │ 305646 │ 15 │',
    ], ['C:\\ci\\head'])

    expect(diagnostics).toEqual(['<root>/packages/delivery/x.ts:12 failed in <duration>'])
  })

  it('reports only diagnostics introduced by the head', () => {
    const base: GateSnapshot[] = [
      snapshot('static', 'failed', ['existing failure']),
      snapshot('knip', 'passed', []),
      snapshot('duplication', 'failed', ['shared clone']),
    ]
    const head: GateSnapshot[] = [
      snapshot('static', 'failed', ['existing failure', 'new C0 failure']),
      snapshot('knip', 'failed', ['new unused C0 file']),
      snapshot('duplication', 'failed', ['shared clone']),
    ]

    expect(newFailureDiagnostics(base, head)).toEqual([
      { gateId: 'static', diagnostics: ['new C0 failure'] },
      { gateId: 'knip', diagnostics: ['new unused C0 file'] },
    ])
  })

  it('executes a real gate in the requested checkout', async () => {
    const cwd = resolve(import.meta.dirname, '..', 'packages')
    const gate: Gate = {
      id: 'cwd',
      label: 'cwd',
      displayCommand: 'print cwd',
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.cwd())'],
    }

    const result = await runGateAt(gate, cwd)

    expect(result.status).toBe('passed')
    expect(result.output.map(chunk => chunk.text).join('')).toBe(cwd)
  })
})

function snapshot(gateId: string, status: GateSnapshot['status'], diagnostics: string[]): GateSnapshot {
  return { gateId, status, diagnostics }
}

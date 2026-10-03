import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { runVerifierFiles } from '../src/run.ts'

describe('verifier file boundary', () => {
  test('reads one bounded Host file and creates one bounded report without following a preexisting output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-eval-verifier-'))
    try {
      const input = join(root, 'input.json'), output = join(root, 'output.json')
      await writeFile(input, JSON.stringify({ kind: 'eval-verifier-input', schemaVersion: 1, snapshotRevision: 'a'.repeat(64),
        plan: { id: 'plan', version: '1', digest: 'b'.repeat(64), expectedCommit: 'c'.repeat(40), baseline: 'none' },
        suite: { id: 'suite', version: '1', digest: 'd'.repeat(64), sourceRevision: 'c'.repeat(40) }, verifierPlan: { id: 'verifier', version: '1', digest: 'e'.repeat(64) },
        expectedCells: [{ caseId: 'case', routeId: 'route', repeatIndex: 0 }], cases: [{ id: 'case', criteria: [{ kind: 'output-equals', text: 'READY' }], requiresGrader: false }],
        cells: [{ caseId: 'case', routeId: 'route', repeatIndex: 0, manifestDigest: 'f'.repeat(64), subjectOutput: 'READY', graderOutput: null, integrity: 'intact', budget: 'settled' }] }))
      await runVerifierFiles({ inputFile: input, outputFile: output, maxInputBytes: 4096, maxOutputBytes: 4096 })
      expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({ outcome: 'approved' })
      await expect(runVerifierFiles({ inputFile: input, outputFile: output, maxInputBytes: 4096,
        maxOutputBytes: 4096 })).rejects.toThrow(/output/u)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

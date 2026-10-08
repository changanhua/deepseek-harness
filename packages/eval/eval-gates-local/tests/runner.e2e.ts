import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { observeRuntimeTree } from '../../eval-isolated/src/build.ts'
import { stageProfileFixture } from '../../eval-isolated/tests/runtime-fixture.ts'
import { expect, test } from 'vitest'
import { createLocalVerifierExecution } from '../src/runner.ts'

const digest = (part: string) => part.repeat(64)
test.skipIf(process.platform !== 'win32')('runs a fixed checker in a new DSH Profile and exposes a persisted Session identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eval-gate-runner-')), core = join(root, 'core'), ctx = new Context()
  try {
    const staged = await stageProfileFixture(core, join(root, 'staging'), '', ['@changanhua/dsh-eval-verifier', '@deepseek-ai/dsh-session-persistence-jsonl'], join(import.meta.dirname, '../package.json'))
    const image = await observeRuntimeTree(core, { maxFiles: 30000, maxBytes: 1024 * 1024 * 1024 }, AbortSignal.timeout(30_000))
    await ctx.plugin(LocalSubprocessRuntime)
    const input = { kind: 'eval-verifier-input' as const, schemaVersion: 1 as const, snapshotRevision: digest('a'), plan: { id: 'plan', version: '1', digest: digest('b'), expectedCommit: 'c'.repeat(40), baseline: 'none' as const }, suite: { id: 'suite', version: '1', digest: digest('d'), sourceRevision: 'c'.repeat(40) }, verifierPlan: { id: 'verifier', version: '1', digest: digest('e') }, expectedCells: [{ caseId: 'case', routeId: 'route', repeatIndex: 0 }], cases: [{ id: 'case', criteria: [{ kind: 'output-equals' as const, text: 'READY' }], requiresGrader: false }], cells: [{ caseId: 'case', routeId: 'route', repeatIndex: 0, manifestDigest: digest('f'), subjectOutput: 'READY', graderOutput: null, integrity: 'intact' as const, budget: 'not-required' as const }] }
    const result = await createLocalVerifierExecution(ctx)(input, { id: 'gate', verifierPlan: input.verifierPlan, coreDigest: image.digest, launch: { executable: staged.executable, entrypoint: staged.entrypoint, profile: 'eval-verifier', homeRoot: join(root, 'homes'), core: { directory: core, digest: image.digest, sourceCommit: staged.sourceCommit, imageBounds: { maxFiles: 30000, maxBytes: 1024 * 1024 * 1024 } }, timeoutMs: 60_000, graceMs: 5_000 }, maxInputBytes: 64 * 1024, maxOutputBytes: 64 * 1024 })
    expect(result).toMatchObject({ quiescent: true, report: { outcome: 'approved', runtime: { profile: 'eval-verifier', configDigest: result.configDigest } } })
    expect(result.sessionId).toBe(result.report.runtime.sessionId)
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
}, 90_000)

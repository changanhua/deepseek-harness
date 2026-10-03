import { join } from 'node:path'
import type { Config } from '../../src/config.ts'

export function runConfig(f: { root: string; access: { workspace: { id: string } } }): Config {
  const core = { directory: f.root, digest: 'a'.repeat(64), plugins: [] }
  const config = { maxRuns: 8, maxLedgerBytes: 1024 * 1024, maxBundles: 64, maxControls: 16,
    maxCells: 16, maxParallel: 1, maxResponseBytes: 65536, retentionMs: 60000, resource: 'eval-cell',
    policies: [{ id: 'fixture', workspaceId: f.access.workspace.id, execution: { repositoryId: 'fixture',
      runtime: { root: join(f.root, 'execution'), core: { subject: core, grader: core }, imageBounds: { maxFiles: 100, maxBytes: 65536 },
        maxFrameBytes: 65536, maxRequests: 10, executionMs: 10000,
        graceMs: 1000, stopMs: 1000, maxResponseBytes: 65536, maxModelAttempts: 4,
        diskLimits: { maxBytes: 512 * 1024 * 1024, maxEntries: 50000, sampleMs: 250 } },
      workspaceLimits: { maxFixtureFiles: 10, maxFixtureBytes: 65536 }, evidenceLimits: { maxBytes: 65536, maxMaterials: 16 },
      keylessBudget: { id: 'fixture', version: '1' as const, digest: 'b'.repeat(64) } } }] }
  return config
}

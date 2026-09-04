import { describe, expect, test } from 'vitest'
import * as SnapshotEvalInvariant from '../src/invariant.ts'

describe('session-snapshot Eval invariant companion', () => {
  test('registers its package-owned no-runtime invariant', async () => {
    let packageName: string | undefined
    let installerCalled = false
    const dispose = () => {}
    const ctx = {
      invariants: {
        register(name: string, install: () => void): () => void {
          packageName = name
          install()
          installerCalled = true
          return dispose
        },
      },
    }

    expect(SnapshotEvalInvariant.name).toBe('eval-session-snapshot-invariant')
    expect(SnapshotEvalInvariant.inject).toEqual(['invariants'])
    await expect(SnapshotEvalInvariant.apply(ctx as never)).resolves.toBe(dispose)
    expect(packageName).toBe('@changanhua/dsh-eval-session-snapshot')
    expect(installerCalled).toBe(true)
  })
})

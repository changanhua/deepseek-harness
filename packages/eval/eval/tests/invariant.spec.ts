import { describe, expect, test } from 'vitest'
import * as EvalInvariant from '../src/invariant.ts'

describe('Eval invariant companion', () => {
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

    expect(EvalInvariant.name).toBe('eval-invariant')
    expect(EvalInvariant.inject).toEqual(['invariants'])
    await expect(EvalInvariant.apply(ctx as never)).resolves.toBe(dispose)
    expect(packageName).toBe('@changanhua/dsh-eval')
    expect(installerCalled).toBe(true)
  })
})

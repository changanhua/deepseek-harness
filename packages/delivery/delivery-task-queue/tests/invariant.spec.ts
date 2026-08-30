import { describe, expect, it, vi } from 'vitest'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { apply, inject, name } from '../src/invariant.ts'

describe('delivery-task-queue invariant companion', () => {
  it('registers the package-owned empty installer', async () => {
    const dispose = vi.fn()
    const register = vi.fn((
      _packageName: string,
      _install: InvariantInstaller,
    ) => dispose)

    await expect(apply({ invariants: { register } } as never)).resolves.toBe(
      dispose,
    )
    expect(name).toBe('delivery-task-queue-invariant')
    expect(inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith(
      '@deepseek-ai/dsh-delivery-task-queue',
      expect.any(Function),
    )
    const installer = register.mock.calls[0]?.[1]
    expect(installer).toBeTypeOf('function')
    expect(installer?.({} as never, vi.fn() as never)).toBeUndefined()
  })
})

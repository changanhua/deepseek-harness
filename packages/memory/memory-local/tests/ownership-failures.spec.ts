import { afterEach, describe, expect, it, vi } from 'vitest'
import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { acquireMemoryOwnership } from '../src/ownership.ts'

const faults = vi.hoisted(() => ({ write: false, sync: false, close: 0, publish: false, temporaryUnlink: 0, lockUnlink: false }))
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return {
    ...fs,
    async open(...args: Parameters<typeof fs.open>) {
      const handle = await fs.open(...args)
      if (!String(args[0]).includes('.owner-')) return handle
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'writeFile') return async (...values: Parameters<typeof handle.writeFile>) => {
            if (faults.write) throw new Error('test owner write failed')
            await target.writeFile(...values)
          }
          if (key === 'sync') return async () => {
            if (faults.sync) throw new Error('test owner sync failed')
            await target.sync()
          }
          if (key === 'close') return async () => {
            await target.close()
            if (faults.close > 0) { faults.close--; throw new Error('test owner close failed') }
          }
          const value: unknown = Reflect.get(target, key)
          return value
        },
      })
    },
    async link(...args: Parameters<typeof fs.link>) {
      if (faults.publish) throw new Error('test owner publish failed')
      await fs.link(...args)
    },
    async unlink(path: Parameters<typeof fs.unlink>[0]) {
      if (String(path).includes('.owner-') && faults.temporaryUnlink > 0) {
        faults.temporaryUnlink--
        throw new Error('test temporary cleanup failed')
      }
      if (String(path).endsWith('owner.lock') && faults.lockUnlink) throw new Error('test lock cleanup failed')
      await fs.unlink(path)
    },
  }
})

const roots: string[] = []
async function root() {
  const value = await mkdtemp(join(tmpdir(), 'dsh-memory-owner-fault-'))
  roots.push(value)
  return value
}
afterEach(async () => {
  Object.assign(faults, { write: false, sync: false, close: 0, publish: false, temporaryUnlink: 0, lockUnlink: false })
  for (const value of roots.splice(0)) {
    if (!resolve(value).startsWith(resolve(tmpdir()) + sep) || !value.includes('dsh-memory-owner-fault-')) throw new Error('refusing unrelated cleanup')
    await rm(value, { recursive: true, force: true })
  }
})

describe('memory ownership failure cleanup', () => {
  it.each(['write', 'sync', 'close'] as const)('does not publish or retain a partial identity after %s fails', async (stage) => {
    const path = await root()
    if (stage === 'close') faults.close = 1
    else faults[stage] = true
    await expect(acquireMemoryOwnership(path)).rejects.toThrow(`test owner ${stage} failed`)
    expect(await readdir(path)).toEqual([])
  })

  it('preserves the primary write error when cleanup also fails', async () => {
    const path = await root()
    faults.write = true
    faults.temporaryUnlink = 1
    await expect(acquireMemoryOwnership(path)).rejects.toMatchObject({
      errors: [{ message: 'test owner write failed' }, { message: 'test temporary cleanup failed' }],
    })
    await expect(access(join(path, 'owner.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(path)).toHaveLength(1)
  })

  it('attempts temporary cleanup even when closing a failed writer also reports an error', async () => {
    const path = await root()
    faults.write = true
    faults.close = 1
    await expect(acquireMemoryOwnership(path)).rejects.toMatchObject({
      errors: [{ message: 'test owner write failed' }, { message: 'test owner close failed' }],
    })
    expect(await readdir(path)).toEqual([])
  })

  it('preserves publication and cleanup failures without claiming ownership', async () => {
    const path = await root()
    faults.publish = true
    faults.temporaryUnlink = 1
    await expect(acquireMemoryOwnership(path)).rejects.toMatchObject({
      errors: [{ code: 'ownership-unavailable', cause: { message: 'test owner publish failed' } }, { message: 'test temporary cleanup failed' }],
    })
    await expect(access(join(path, 'owner.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('releases a published lock if removing its temporary link fails', async () => {
    const path = await root()
    faults.temporaryUnlink = 1
    await expect(acquireMemoryOwnership(path)).rejects.toThrow('test temporary cleanup failed')
    await expect(access(join(path, 'owner.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(path)).toHaveLength(1)
    const replacement = await acquireMemoryOwnership(path)
    await replacement.release()
  })

  it('retains an unremovable published lock and both cleanup errors', async () => {
    const path = await root()
    faults.temporaryUnlink = 1
    faults.lockUnlink = true
    await expect(acquireMemoryOwnership(path)).rejects.toMatchObject({
      errors: [{ message: 'test temporary cleanup failed' }, { code: 'ownership-unavailable' }],
    })
    await access(join(path, 'owner.lock'))
    expect(await readdir(path)).toHaveLength(2)
  })
})

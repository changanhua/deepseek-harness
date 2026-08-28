import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireQueueOwnership, QueueOwnershipError } from '../src/lock.ts'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-task-queue-lock-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

describe('acquireQueueOwnership', () => {
  it('acquires the lock on first call and writes owner.lock', async () => {
    const root = await tempRoot()
    const ownership = await acquireQueueOwnership(root)
    const body = JSON.parse(await readFile(join(root, 'owner.lock'), 'utf8')) as Record<string, unknown>
    expect(body.version).toBe(1)
    expect(body.pid).toBe(process.pid)
    expect(body.hostname).toBe(hostname())
    expect(typeof body.bootId).toBe('string')
    expect(typeof body.acquiredAt).toBe('string')
    await ownership.release()
  })

  it('refuses a second acquisition while the first is held', async () => {
    const root = await tempRoot()
    const first = await acquireQueueOwnership(root)
    await expect(acquireQueueOwnership(root)).rejects.toBeInstanceOf(QueueOwnershipError)
    await first.release()
  })

  it('throws a pointed error when the lock content is unreadable', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'owner.lock'), 'not json', 'utf8')
    await expect(acquireQueueOwnership(root)).rejects.toThrow(/unreadable/)
  })

  it('throws when the recorded hostname differs (cross-machine root)', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'owner.lock'), JSON.stringify({
      version: 1, pid: process.pid, bootId: 'b', hostname: 'other-host', acquiredAt: '2026-01-01T00:00:00.000Z',
    }), 'utf8')
    await expect(acquireQueueOwnership(root)).rejects.toThrow(/owned by host "other-host"/)
  })

  it('refuses when the recorded pid is alive', async () => {
    const root = await tempRoot()
    // A live foreign pid (not our own) must refuse startup.
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    await writeFile(join(root, 'owner.lock'), JSON.stringify({
      version: 1, pid: 424242, bootId: 'b', hostname: hostname(), acquiredAt: '2026-01-01T00:00:00.000Z',
    }), 'utf8')
    await expect(acquireQueueOwnership(root)).rejects.toThrow(/already owned by a live host process/)
  })

  it('archives a stale lock (dead pid) and takes over', async () => {
    const root = await tempRoot()
    // Any pid that reports as dead: kill(pid, 0) throws ESRCH.
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    })
    await writeFile(join(root, 'owner.lock'), JSON.stringify({
      version: 1, pid: 424242, bootId: 'b', hostname: hostname(), acquiredAt: '2026-01-01T00:00:00.000Z',
    }), 'utf8')
    const ownership = await acquireQueueOwnership(root)
    const body = JSON.parse(await readFile(join(root, 'owner.lock'), 'utf8')) as Record<string, unknown>
    expect(body.pid).toBe(process.pid)
    const quarantined = await readdir(join(root, 'quarantine'))
    expect(quarantined).toHaveLength(1)
    expect(quarantined[0]).toMatch(/^owner-stale-.*\.lock$/)
    await ownership.release()
  })

  it('releases the lock so a later acquisition succeeds', async () => {
    const root = await tempRoot()
    const first = await acquireQueueOwnership(root)
    await first.release()
    const second = await acquireQueueOwnership(root)
    await second.release()
  })
})

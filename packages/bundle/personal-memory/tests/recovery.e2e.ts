import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createMemoryLoaderWorld, inspectMemoryLoader, repo } from './loader-harness.ts'

it('retains durable memory after forced Host exit and requires exact abandoned-lock recovery', { retry: 0, timeout: 90_000 }, async () => {
  const world = await createMemoryLoaderWorld()
  let running: Awaited<ReturnType<typeof world.start>> | undefined
  const lockPath = join(world.root, '.dsh/storages/project-memory-ownership/owner.lock')
  const storePath = join(world.root, '.dsh/storages/project_memory.json')
  try {
    running = await world.start()
    const first = await inspectMemoryLoader(world.root, running)
    expect(first).toMatchObject({ eligibility: 'usable', recordVersion: 2 })
    const lockBytes = await readFile(lockPath, 'utf8')
    const lock = JSON.parse(lockBytes) as { pid: number }
    const original = JSON.parse(await readFile(storePath, 'utf8')) as {
      tables: { memories: Record<string, { revisions: unknown[]; decisions: unknown[]; activeRevision: number }> }
    }
    expect(lock.pid).toBe(running.child.pid)
    const crashedChild = running.child
    await running.close('SIGKILL')
    running = undefined
    expect(crashedChild.exitCode !== null || crashedChild.signalCode !== null).toBe(true)
    expect(await readFile(lockPath, 'utf8')).toBe(lockBytes)

    running = await world.start()
    await running.spawned
    await expect.poll(() => running?.child.exitCode, { timeout: 20_000, interval: 100 }).not.toBeNull()
    const rejectedBoot = running.stderr()
    expect(rejectedBoot).toMatch(/ownership|owner\.lock|already owned|existing lock/iu)
    await running.close()
    running = undefined
    expect(await readFile(lockPath, 'utf8')).toBe(lockBytes)
    expect(JSON.parse(await readFile(storePath, 'utf8'))).toEqual(original)

    // This test owns the exact child and temporary root. Its exit boundary and
    // unchanged lock token are the operator verification required by V1.
    await unlink(lockPath)
    running = await world.start()
    const recovered = await inspectMemoryLoader(world.root, running)
    expect(recovered).toMatchObject({ id: first.id, eligibility: 'usable', statement: 'Run pnpm test', recordVersion: 3 })
    const current = JSON.parse(await readFile(storePath, 'utf8')) as typeof original
    const before = original.tables.memories[String(first.id)]
    const after = current.tables.memories[String(first.id)]
    expect(after?.revisions).toEqual(before?.revisions)
    expect(after?.decisions.slice(0, 1)).toEqual(before?.decisions)
    expect(after?.activeRevision).toBe(1)
    await running.close()
    running = undefined
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await mkdir(join(repo, '.artifacts/project-memory'), { recursive: true })
    await writeFile(join(repo, '.artifacts/project-memory/recovery.json'), JSON.stringify({
      killedPid: lock.pid, first, recovered, deniedUnverifiedTakeover: true, preservedOriginalRevision: true,
      normalExitReleasedLock: true,
    }, null, 2))
  } catch (error) {
    await writeFile(join(repo, '.artifacts/project-memory/recovery-stderr.log'), running?.stderr() ?? 'Host already closed')
    throw error
  } finally {
    await running?.close('SIGTERM')
    await world.close()
  }
})

import { describe, expect, it } from 'vitest'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createMemoryLoaderWorld, inspectMemoryLoader, repo } from './loader-harness.ts'

describe('project memory built CLI composition', () => {
  it.each([false, true])('boots the supported ACP profile with memory enabled=%s', { retry: 0 }, async (enabled) => {
    const world = await createMemoryLoaderWorld(enabled)
    const { root } = world
    let running: Awaited<ReturnType<typeof world.start>> | undefined
    try {
      running = await world.start()
      const report = await inspectMemoryLoader(root, running)
      expect(report).toMatchObject({
        memoryPresent: enabled, command: enabled,
        tools: enabled ? ['memory_propose', 'memory_read', 'memory_search'] : [],
        ...enabled ? { eligibility: 'usable', statement: 'Run pnpm test', recordVersion: 2 } : {},
      })
      await running.close()
      running = undefined
      if (enabled) {
        const persisted = JSON.parse(await readFile(join(root, '.dsh', 'storages', 'project_memory.json'), 'utf8')) as {
          tables: { memories: Record<string, { activeRevision: number; decisions: Array<{ commandId: string }> }> }
        }
        const memory = persisted.tables.memories[String(report?.id)]
        expect(memory?.activeRevision).toBe(1)
        expect(memory?.decisions[0]?.commandId).toBe(report?.commandId)
        await expect(access(join(root, '.dsh', 'storages', 'project-memory-ownership', 'owner.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
      }
      await mkdir(join(repo, '.artifacts/project-memory'), { recursive: true })
      await writeFile(join(repo, `.artifacts/project-memory/loader-${enabled ? 'enabled' : 'disabled'}.json`), JSON.stringify(report, null, 2))
    } catch (error) {
      await mkdir(join(repo, '.artifacts/project-memory'), { recursive: true })
      const diagnostics = running?.stderr() ?? 'process already closed'
      await writeFile(join(repo, `.artifacts/project-memory/loader-${enabled ? 'enabled' : 'disabled'}-stderr.log`), diagnostics)
      throw new Error(`${String(error)}\nCLI stderr:\n${diagnostics}`, { cause: error })
    } finally {
      await running?.close('SIGTERM')
      await world.close()
    }
  })
})

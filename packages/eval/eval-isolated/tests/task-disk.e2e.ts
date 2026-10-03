import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { runIsolatedTask } from '../src/task.ts'
import { stageProfileFixture } from './runtime-fixture.ts'

test.skipIf(process.platform !== 'win32' || process.arch !== 'x64')('stops a continuously growing isolated task without touching outside state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-task-disk-'))
  let custody: Awaited<ReturnType<typeof runIsolatedTask>> | undefined
  try {
    const runtime = join(root, 'runtime'), home = join(root, 'home'), cwd = join(root, 'workspace')
    const outside = join(root, 'outside'), tasks = join(root, 'tasks')
    await stageProfileFixture(runtime, home, '')
    await mkdir(cwd); await mkdir(outside)
    await writeFile(join(outside, 'keep'), 'private')
    custody = await runIsolatedTask({ runtime, cwd, directory: tasks, readOnlyInputs: [], executionMs: 10_000, stopMs: 5_000,
      maxOutputBytes: 4096, diskLimits: { maxBytes: 32 * 1024, maxEntries: 64, sampleMs: 20 },
      source: "import{appendFileSync}from'node:fs';const block=Buffer.alloc(4096);setInterval(()=>appendFileSync('growth',block),0)" }, AbortSignal.timeout(15_000))
    expect(custody.result).toMatchObject({ status: 'uncertain', quiescent: true, stderr: 'eval-task-disk-limit-exceeded' })
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('private')
  } finally {
    if (custody?.result.quiescent) custody.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

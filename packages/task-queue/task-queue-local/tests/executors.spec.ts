import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RunId, TaskId } from '@deepseek-ai/dsh-task-queue'
import type { Task } from '@deepseek-ai/dsh-task-queue'
import { builtinAdapters } from '../src/executors.ts'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: TaskId('tq-1'),
    title: 'movie',
    prompt: '',
    executor: 'node',
    status: 'starting',
    priority: 10,
    attempt: 1,
    maxAttempts: 3,
    backoffMs: 1000,
    delayUntil: null,
    timeoutMs: 60_000,
    outputDir: '',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastError: null,
    result: null,
    ownerSessionId: null,
    source: 'tool',
    receiptId: 'r',
    terminalSeq: null,
    runs: [],
    ...overrides,
  }
}

const directories: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-task-queue-executors-'))
  directories.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('builtinAdapters', () => {
  it('registers the CLI agents, node, and shell', () => {
    const adapters = builtinAdapters({})
    expect([...adapters.keys()]).toEqual(['claude', 'codex', 'opencode', 'arkcli', 'node', 'shell'])
  })

  it('uses a configured command override for node', async () => {
    const dir = await tempDir()
    const script = join(dir, 'movie.mjs')
    await writeFile(script, '')
    const adapters = builtinAdapters({ node: 'node.exe' })
    const spec = await adapters.get('node')!.prepare(
      task({ prompt: JSON.stringify({ script, args: ['--movie', '肖申克的救赎'] }) }),
      { runId: RunId('run-1'), attempt: 1, pid: null, plannedStartedAt: null, actualStartedAt: null, logPath: null, commandFingerprint: null },
      new AbortController().signal,
    )
    expect(spec.argv).toEqual(['node.exe', script, '--movie', '肖申克的救赎'])
  })
})

describe('node adapter', () => {
  it('prepares node with the task prompt script and args', async () => {
    const dir = await tempDir()
    const script = join(dir, 'movie.mjs')
    await writeFile(script, '')
    const adapter = builtinAdapters({}).get('node')!
    const spec = await adapter.prepare(
      task({ prompt: JSON.stringify({ script, args: ['a'] }) }),
      { runId: RunId('run-1'), attempt: 1, pid: null, plannedStartedAt: null, actualStartedAt: null, logPath: null, commandFingerprint: null },
      new AbortController().signal,
    )
    expect(spec.argv).toEqual(['node', script, 'a'])
    expect(spec.cwd).not.toBe('')
  })

  it('rejects a prompt without script', async () => {
    const adapter = builtinAdapters({}).get('node')!
    await expect(adapter.prepare(
      task({ prompt: JSON.stringify({ args: ['a'] }) }),
      { runId: RunId('run-1'), attempt: 1, pid: null, plannedStartedAt: null, actualStartedAt: null, logPath: null, commandFingerprint: null },
      new AbortController().signal,
    )).rejects.toThrow(/script/)
  })

  it('rejects a missing script file', async () => {
    const adapter = builtinAdapters({}).get('node')!
    await expect(adapter.prepare(
      task({ prompt: JSON.stringify({ script: join(tmpdir(), 'definitely-missing.mjs') }) }),
      { runId: RunId('run-1'), attempt: 1, pid: null, plannedStartedAt: null, actualStartedAt: null, logPath: null, commandFingerprint: null },
      new AbortController().signal,
    )).rejects.toThrow(/script unavailable/)
  })
})

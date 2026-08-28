import { access } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunId, TaskId } from '@deepseek-ai/dsh-task-queue'
import type { ExecutorAdapter, Task } from '@deepseek-ai/dsh-task-queue'
import {
  WORKER_PATCH_PATH,
  apply,
  createDshExecutor,
  resolveConfig,
} from '../src/index.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temp(name: string): string {
  const root = mkdtempSync(join(tmpdir(), name))
  roots.push(root)
  return root
}

function task(workspaceDir: string, outputDir: string): Task {
  return {
    id: TaskId('tq-dsh'),
    title: 'worker task',
    prompt: 'inspect the repository',
    executor: 'dsh',
    status: 'starting',
    priority: 10,
    attempt: 1,
    maxAttempts: 1,
    backoffMs: 0,
    delayUntil: null,
    timeoutMs: 60_000,
    workspaceDir,
    outputDir,
    tags: [],
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    lastError: null,
    result: null,
    ownerSessionId: null,
    source: 'tool',
    receiptId: 'receipt',
    terminalSeq: null,
    runs: [],
    dismissed: false,
  }
}

const run = {
  runId: RunId('run-dsh'),
  attempt: 1,
  pid: null,
  plannedStartedAt: null,
  actualStartedAt: null,
  logPath: null,
  commandFingerprint: null,
}

describe('DSH executor adapter', () => {
  it('prepares the dedicated restricted worker in workspaceDir and creates both directories', async () => {
    const root = temp('dsh-executor-')
    const workspaceDir = join(root, 'workspace')
    const outputDir = join(root, 'artifacts')
    const config = resolveConfig({
      launcher: ['node', '/dsh/bin.js'],
      dshHome: join(root, 'home'),
      profile: 'task-worker',
      maxAssistantBytes: 64,
      collectBytes: 256,
      graceMs: 1234,
    })
    const adapter = createDshExecutor(config)

    const spec = await adapter.prepare(task(workspaceDir, outputDir), run, new AbortController().signal)

    expect(spec.cwd).toBe(workspaceDir)
    expect(spec.argv.slice(0, 7)).toEqual([
      'node', '/dsh/bin.js', '--profile', 'task-worker', '--patch', WORKER_PATCH_PATH,
      expect.stringContaining('inspect the repository'),
    ])
    expect(spec.argv.at(-1)).toContain(JSON.stringify(workspaceDir))
    expect(spec.argv.at(-1)).toContain(JSON.stringify(outputDir))
    expect(spec.env).toEqual({
      DSH_HOME: join(root, 'home'),
      DSH_PERMISSION_MODE: 'workspace-write',
      DSH_TELEMETRY_DISABLED: '1',
    })
    expect(spec.graceMs).toBe(1234)
    expect(spec.stdio).toEqual({
      stdin: 'ignore',
      stdout: { maxBytes: 256, spill: { maxBytes: 4096 } },
      stderr: { maxBytes: 256, spill: { maxBytes: 4096 } },
    })
    await expect(access(workspaceDir)).resolves.toBeUndefined()
    await expect(access(outputDir)).resolves.toBeUndefined()
  })

  it('normalizes semantic stdout without leaking it into the fixed summary', () => {
    const root = temp('dsh-normalize-')
    const adapter = createDshExecutor(resolveConfig({
      launcher: ['dsh'], dshHome: root, maxAssistantBytes: 5, collectBytes: 32,
    }))

    expect(adapter.normalize?.(task(root, root), '你好吗\n', '')).toEqual({
      summary: 'dsh worker completed; semantic result truncated to 5 UTF-8 bytes (full text in run log)',
      assistantText: '你',
    })
    expect(adapter.normalize?.(task(root, root), '\n\r\n', 'diagnostic')).toEqual({
      summary: 'dsh worker completed without semantic text',
    })
  })

  it('fails loud when semantic storage exceeds collected stdout', () => {
    expect(() => resolveConfig({
      launcher: ['dsh'], dshHome: '/home', maxAssistantBytes: 257, collectBytes: 256,
    })).toThrow(/maxAssistantBytes.*collectBytes/)
  })

  it.each([
    ['maxAssistantBytes', { maxAssistantBytes: 0 }],
    ['collectBytes', { collectBytes: 1.5 }],
    ['graceMs', { graceMs: -1 }],
  ])('validates direct-call numeric config for %s', (field, override) => {
    expect(() => resolveConfig({
      launcher: ['dsh'], dshHome: '/home', maxAssistantBytes: 1, collectBytes: 1,
      ...override,
    })).toThrow(new RegExp(field))
  })
})

describe('DSH executor registration', () => {
  it('registers through an effect and returns the registry disposer', async () => {
    const disposer = vi.fn()
    const registerExecutor = vi.fn((_name: string, _adapter: ExecutorAdapter) => disposer)
    const effect = vi.fn((install: () => () => void) => install())
    apply({ taskQueue: { registerExecutor }, effect } as never, {
      launcher: ['dsh'], dshHome: '/home', maxAssistantBytes: 64, collectBytes: 64,
    })

    expect(effect).toHaveBeenCalledOnce()
    expect(registerExecutor.mock.calls[0]?.[0]).toBe('dsh')
    const registered = registerExecutor.mock.calls[0]?.[1]
    const root = temp('dsh-registered-')
    const prepared = await registered?.prepare(task(root, join(root, 'artifacts')), run, new AbortController().signal)
    expect(prepared?.argv[0]).toBe('dsh')
    expect(registered?.normalize?.(task(root, root), 'answer\n', '')).toMatchObject({ assistantText: 'answer' })
    expect(effect.mock.results[0]?.value).toBe(disposer)
  })
})

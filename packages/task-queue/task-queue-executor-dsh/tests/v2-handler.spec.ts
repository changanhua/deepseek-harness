import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'
import { AttemptId } from '@changanhua/dsh-task-queue'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { createDshWorkHandler, resolveConfig } from '../src/index.ts'

describe('DSH agent.run@1 handler', () => {
  it('leaves only the foreground Windows PowerShell family enabled in the final worker overlay', () => {
    const patchPath = fileURLToPath(new URL('../worker.cordis.patch.yml', import.meta.url))
    const parsed = yaml.load(readFileSync(patchPath, 'utf8'), { schema: entryListSchema })
    if (!Array.isArray(parsed)) throw new Error('worker overlay must parse to a patch list')
    const rows = parsed as Array<{ id: string; disabled?: unknown; config?: Record<string, unknown> }>
    const row = (id: string) => {
      const value = rows.find(candidate => candidate.id === id)
      if (value === undefined) throw new Error(`worker overlay must name ${id}`)
      return value
    }
    for (const id of [
      'hmr', 'jobs', 'tool-jobs',
      'task-queue', 'task-queue-executor-dsh', 'tool-task-queue', 'tool-agent-run-task-queue',
      'image-generation-task-queue', 'tool-image-generation-task-queue', 'command-task-queue', 'task-queue-remote',
      'goal', 'goal-round-driver', 'command-goal', 'tool-goal',
      'subagent', 'subagent-spawn-in-process', 'subagent-fork-in-process', 'subagent-codex', 'subagent-claude-code',
      'tool-subagent-control', 'tool-subagent-list-agents', 'tool-subagent', 'tool-subagent-fork', 'tool-subagent-report',
      'workflow-worker-thread', 'tool-workflow', 'tool-ralph',
    ]) expect(row(id).disabled, id).toBe(true)
    expect(Boolean(evaluate({ process: { platform: 'win32' } }, (row('bash-sandbox').disabled as { __jsExpr: string }).__jsExpr))).toBe(true)
    expect(Boolean(evaluate({ process: { platform: 'win32' } }, (row('tool-bash').disabled as { __jsExpr: string }).__jsExpr))).toBe(true)
    expect(Boolean(evaluate({ process: { platform: 'win32' } }, (row('pwsh-sandbox').disabled as { __jsExpr: string }).__jsExpr))).toBe(false)
    expect(Boolean(evaluate({ process: { platform: 'win32' } }, (row('tool-pwsh').disabled as { __jsExpr: string }).__jsExpr))).toBe(false)
    expect(row('tool-pwsh').config?.['enableRunInBackground']).toBe(false)
  })

  it('persists plain intent, prepares the restricted worker, and owns its live subprocess', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-run-v2-'))
    try {
      const spawned: SubprocessSpawnSpec[] = []
      const handle = {
        pid: 12, stdin: undefined, stdout: undefined, stderr: undefined,
        collected: { stdout: { readFrom: () => ({ text: 'done\n', nextOffset: 5, lossy: false }) } },
        done: Promise.resolve({ exitCode: 0, signal: null }), terminate() {}, waitForExit: async () => true,
      } as SubprocessHandle
      const config = resolveConfig({
        launcher: ['dsh'], dshHome: join(root, 'home'), workspaceDir: root,
        maxAssistantBytes: 64, collectBytes: 256, failureTailBytes: 64, graceMs: 10, maxAttempts: 2,
      })
      const handler = createDshWorkHandler(config, {
        spawn(spec) { spawned.push(spec); return handle },
      })
      const signal = new AbortController().signal
      const resolved = await handler.resolveAdmission({ prompt: 'inspect the repository' }, { signal })
      const attemptId = AttemptId('attempt-1')
      const prepared = await handler.prepare(resolved, { attemptId, signal })
      const live = handler.start(prepared, { attemptId, signal })

      expect(handler.kind).toBe('agent.run@1')
      expect(handler.policy(resolved)).toEqual({ maxAttempts: 2 })
      await expect(live.done).resolves.toMatchObject({ status: 'succeeded', output: { assistantText: 'done' } })
      expect(spawned).toHaveLength(1)
      expect(spawned[0]?.argv.at(-1)).toContain('inspect the repository')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retains only the newest UTF-8 stderr tail for a failed worker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-run-v2-'))
    try {
      const handle = {
        pid: 12, stdin: undefined, stdout: undefined, stderr: undefined,
        collected: {
          stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
          stderr: { readFrom: () => ({ text: 'prefix😀终尾', nextOffset: 0, lossy: false }) },
        },
        done: Promise.resolve({ exitCode: 1, signal: null }), terminate() {}, waitForExit: async () => true,
      } as SubprocessHandle
      const handler = createDshWorkHandler(resolveConfig({
        launcher: ['dsh'], dshHome: join(root, 'home'), workspaceDir: root,
        maxAssistantBytes: 64, collectBytes: 256, failureTailBytes: 6,
      }), { spawn: () => handle })
      const signal = new AbortController().signal
      const resolved = await handler.resolveAdmission({ prompt: 'inspect' }, { signal })
      const live = handler.start(await handler.prepare(resolved, { attemptId: AttemptId('attempt-2'), signal }), {
        attemptId: AttemptId('attempt-2'), signal,
      })

      await expect(live.done).resolves.toMatchObject({
        status: 'failed',
      })
      const outcome = await live.done
      expect(outcome.status === 'failed' ? outcome.failure.message : '').toContain('终尾')
      expect(outcome.status === 'failed' ? outcome.failure.message : '').not.toContain('spill')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

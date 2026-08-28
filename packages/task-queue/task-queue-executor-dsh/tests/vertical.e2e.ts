import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { TASK_QUEUE_HOST_ACCESS } from '@deepseek-ai/dsh-task-queue'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalTaskQueue from '@deepseek-ai/dsh-task-queue-local'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { afterEach, describe, expect, it } from 'vitest'
import * as DshExecutor from '../src/index.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const dshBin = join(repoRoot, 'apps/cli/lib/bin.js')
const roots: string[] = []
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function temp(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), name))
  roots.push(root)
  return root
}

async function waitFor(predicate: () => boolean, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for DSH task settlement')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

function toolNames(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return []
  const tools = (body as { tools?: unknown }).tools
  if (!Array.isArray(tools)) return []
  return tools.flatMap((tool): string[] => {
    if (typeof tool !== 'object' || tool === null) return []
    const record = tool as { name?: unknown; function?: { name?: unknown } }
    const candidate = record.function?.name ?? record.name
    return typeof candidate === 'string' ? [candidate] : []
  })
}

describe.skipIf(!existsSync(dshBin))('task queue → restricted real DSH worker', () => {
  it('persists the child semantic answer and excludes recursive/shell tools', async () => {
    const apiKey = 'task-queue-dsh-e2e-key'
    const server = await startMockLlmServer({
      sequence: ['success'],
      repeatLast: true,
      apiKey,
      successText: 'restricted DSH worker completed the queued task',
    })
    const root = await temp('dsh-task-worker-e2e-')
    const queueRoot = join(root, 'queue')
    const workspaceDir = join(root, 'workspace')
    const outputDir = join(root, 'artifacts')
    await writeFile(join(root, '.credentials.yaml'), `version: 1\nrefs:\n  DEEPSEEK_API_KEY: ${apiKey}\n`, { mode: 0o600 })

    const previousBaseUrl = process.env.DEEPSEEK_BASE_URL
    process.env.DEEPSEEK_BASE_URL = server.baseURL
    try {
      context = new Context()
      await context.plugin(LocalSubprocessRuntime)
      await context.plugin(LocalTaskQueue, {
        queueRoot,
        intervalMs: 10,
        maxConcurrent: 1,
        maxConcurrentPerExecutor: 1,
        executors: { dsh: { enabled: true } },
      })
      await context.plugin(DshExecutor, {
        launcher: [process.execPath, dshBin],
        dshHome: root,
        profile: 'task-worker',
        maxAssistantBytes: 4096,
        collectBytes: 64 * 1024,
        graceMs: 1000,
      })

      const id = await context.taskQueue.enqueueFromTool(TASK_QUEUE_HOST_ACCESS, {
        title: 'real DSH vertical',
        prompt: 'Read the background task context and report success without invoking recursive work.',
        executor: 'dsh',
        maxAttempts: 1,
        timeoutMs: 30_000,
        workspaceDir,
        outputDir,
      })
      await waitFor(() => {
        const status = context!.taskQueue.get(TASK_QUEUE_HOST_ACCESS, id).status
        return status === 'succeeded' || status === 'failed' || status === 'canceled'
      })

      const settled = context.taskQueue.get(TASK_QUEUE_HOST_ACCESS, id)
      expect(settled.status, settled.lastError ?? undefined).toBe('succeeded')
      expect(settled.result).toMatchObject({
        summary: 'dsh worker completed with semantic result',
        assistantText: 'restricted DSH worker completed the queued task',
        exitCode: 0,
      })
      expect(settled.result?.logPath).toEqual(expect.any(String))
      await expect(access(settled.result!.logPath!)).resolves.toBeUndefined()
      expect(await readFile(settled.result!.logPath!, 'utf8')).toContain('restricted DSH worker completed')

      const requests = server.requests.map(request => request.body)
      expect(JSON.stringify(requests)).toContain('Read the background task context')
      expect(JSON.stringify(requests)).toContain(JSON.stringify(workspaceDir).slice(1, -1))
      const names = requests.flatMap(toolNames)
      expect(names.length).toBeGreaterThan(0)
      expect(names).not.toContain('task_queue_enqueue')
      expect(names).not.toContain('create_goal')
      expect(names).not.toContain('subagent')
      expect(names).not.toContain('workflow')
      expect(names).not.toContain('bash')
      expect(names).not.toContain('pwsh')
    } finally {
      if (previousBaseUrl === undefined) delete process.env.DEEPSEEK_BASE_URL
      else process.env.DEEPSEEK_BASE_URL = previousBaseUrl
      await server.close()
    }
  }, 60_000)
})

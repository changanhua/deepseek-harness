import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { WorkQueueStore } from '@deepseek-ai/dsh-task-queue-local'
import { launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const WAIT_FIXTURE = fileURLToPath(new URL('../../../packages/task-queue/operation-run-task-queue/tests/fixtures/wait-operation.mjs', import.meta.url))
const EXIT_ZERO_FIXTURE = fileURLToPath(new URL('../../../packages/task-queue/operation-run-task-queue/tests/fixtures/exit-zero-on-release.mjs', import.meta.url))
const MODE = webSnapshotMode()
const OWNER_ID = SessionId('operation-workspace-owner')

function operationAgent(scaffold: WebScaffold): Agent {
  const scope = scaffold.ctx.plugin({ inject: ['tools'], apply: () => {} })
  const session = scaffold.ctx.sessions.create(OWNER_ID)
  const agent = {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel: () => {},
    runMaintenance: (job: (signal: AbortSignal) => Promise<void>) => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  } as unknown as Agent
  scaffold.ctx.agents.register(agent)
  return agent
}

async function waitFor(predicate: () => boolean | Promise<boolean>, label: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) {
    return !((error as NodeJS.ErrnoException).code === 'ESRCH')
  }
}

describe.skipIf(MODE === 'record')('web e2e: Queue operation cancellation', () => {
  let root: string
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let agent: Agent
  let observedPids: { parentPid: number; childPid: number } | undefined
  let observedRacePid: number | undefined
  const failedRequests: string[] = []

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-operation-workspace-'))
    const overlayPath = join(root, 'operation-overlay.yml')
    await writeFile(overlayPath, [
      '- insert:',
      '  - id: operation-run-task-queue',
      "    name: '@deepseek-ai/dsh-operation-run-task-queue'",
      '    inject: [taskQueue, subprocess]',
      '    config:',
      '      operations:',
      '        fixture.wait:',
      '          revision: fixture.wait/v1',
      '          description: Hold a parent and child process until cancellation.',
      `          argv: [${JSON.stringify(process.execPath)}, ${JSON.stringify(WAIT_FIXTURE)}]`,
      `          cwd: ${JSON.stringify(root)}`,
      '          resource: operation-run',
      '          units: 1',
      '          maxAttempts: 1',
      '          collectBytes: 4096',
      '          resultBytes: 1024',
      '          failureTailBytes: 512',
      '          graceMs: 1000',
      '          timeoutMs: 60000',
      '  - id: tool-operation-run-task-queue',
      "    name: '@deepseek-ai/dsh-tool-operation-run-task-queue'",
      '    inject: [tools, taskQueue]',
      '  - id: tool-task-queue-operation-e2e',
      "    name: '@deepseek-ai/dsh-tool-task-queue'",
      '    inject: [tools, taskQueue, sessions]',
      '    config:',
      '      maxNotificationsPerStep: 1',
      '',
    ].join('\n'))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlayPath, harnessHome: join(root, 'harness-home') })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    page.on('requestfailed', (request) => { failedRequests.push(`${request.method()} ${request.url()}`) })
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    agent = operationAgent(scaffold)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (observedPids !== undefined) {
      expect(processAlive(observedPids.parentPid)).toBe(false)
      expect(processAlive(observedPids.childPid)).toBe(false)
    }
    if (observedRacePid !== undefined) expect(processAlive(observedRacePid)).toBe(false)
    if (scaffold !== undefined) {
      const lockProbe = new WorkQueueStore(join(scaffold.harnessHome, 'task-queue-v3'))
      await lockProbe.open()
      await lockProbe.close()
    }
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('cancels a real child tree through Queue Workspace and retains canceled after refresh', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-operation-queue-cancel'))
    expect(scaffold.ctx.tools.get('operation_run_enqueue')).toBeDefined()
    const enqueued = await scaffold.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('operation-workspace-enqueue'),
      name: 'operation_run_enqueue',
      arguments: { title: 'Fixture wait', operationId: 'fixture.wait', idempotencyKey: 'fixture-wait-v1' },
      agent,
    })
    expect(enqueued.isError).toBe(false)
    if (enqueued.isError) throw new Error(enqueued.error.message)
    const workId = (enqueued.value as { id: string }).id
    let statusRead = 0
    const readStatus = async (): Promise<string> => {
      const result = await scaffold.ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId(`operation-workspace-status-${++statusRead}`),
        name: 'task_queue_status',
        arguments: { id: workId },
        agent,
      })
      if (result.isError) throw new Error(result.error.message)
      return (result.value as { status: string }).status
    }
    await waitFor(async () => await readStatus() === 'running', 'running WorkItem')

    const pidPath = join(root, 'operation-pids.json')
    await waitFor(async () => {
      try { await readFile(pidPath); return true } catch { return false }
    }, 'fixture process ids')
    const pids = JSON.parse(await readFile(pidPath, 'utf8')) as { parentPid: number; childPid: number }
    observedPids = pids
    expect(processAlive(pids.parentPid)).toBe(true)
    expect(processAlive(pids.childPid)).toBe(true)

    await page.getByRole('button', { name: 'Queue' }).click()
    const workspace = page.locator('section[aria-label="Task Queue"]')
    await workspace.waitFor({ timeout: 15_000 })
    const row = workspace.locator('section[aria-label="Task list"] li').filter({ hasText: 'Fixture wait' })
    await row.waitFor({ timeout: 15_000 })
    await expect.poll(() => row.textContent(), { timeout: 15_000 }).toContain('Running')
    await row.getByRole('button', { name: 'Cancel' }).click()
    const dialog = page.getByRole('dialog', { name: 'Cancel task' })
    await dialog.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: 'Confirm' }).click()

    await waitFor(async () => {
      if (await readStatus() !== 'canceled') return false
      expect(processAlive(pids.parentPid)).toBe(false)
      expect(processAlive(pids.childPid)).toBe(false)
      return true
    }, 'durable cancellation after process tree exit')
    const terminal = await scaffold.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('operation-workspace-result'),
      name: 'task_queue_result',
      arguments: { id: workId },
      agent,
    })
    expect(terminal.isError).toBe(false)
    if (terminal.isError) throw new Error(terminal.error.message)
    expect(terminal.value).toMatchObject({ id: workId, status: 'canceled' })
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect.poll(() => row.textContent(), { timeout: 15_000 }).toContain('Done')
    await row.getByRole('button').first().click()
    const detail = workspace.locator('aside[aria-label="Task detail"]')
    await expect.poll(() => detail.textContent(), { timeout: 15_000 }).toContain(workId)
    await expect.poll(() => detail.textContent(), { timeout: 15_000 }).toContain('Canceled')
    await expect.poll(() => detail.textContent(), { timeout: 15_000 }).toContain(OWNER_ID)
    expect(failedRequests).toEqual([])

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByRole('button', { name: 'Queue' }).click()
    const refreshed = page.locator('section[aria-label="Task list"] li').filter({ hasText: 'Fixture wait' })
    await refreshed.waitFor({ timeout: 15_000 })
    await refreshed.getByRole('button').first().click()
    await expect.poll(
      () => page.locator('aside[aria-label="Task detail"]').textContent(),
      { timeout: 15_000 },
    ).toContain('Canceled')
    expect(await readStatus()).toBe('canceled')
    expect(await page.getByRole('alert').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    const expectedReloadDisconnect = `GET ${new URL('/plugins/events', scaffold.baseUrl).href}`
    expect(failedRequests.filter(request => request !== expectedReloadDisconnect)).toEqual([])
    expect(failedRequests.length).toBeLessThanOrEqual(1)

    const evidenceRoot = process.env.DSH_OPERATION_RUN_EVIDENCE_ROOT
    if (evidenceRoot !== undefined && evidenceRoot.length > 0) {
      await mkdir(evidenceRoot, { recursive: true })
      await writeFile(join(evidenceRoot, 'browser-cancel.json'), `${JSON.stringify({
        version: 1,
        recordedAt: new Date().toISOString(),
        consumerTool: 'operation_run_enqueue',
        ownerSessionId: OWNER_ID,
        workId,
        parentPid: pids.parentPid,
        childPid: pids.childPid,
        parentAliveBeforeCancel: true,
        childAliveBeforeCancel: true,
        treeExitedBeforeCanceledObservation: true,
        statusAfterRefresh: 'canceled',
        statusAfterReload: 'canceled',
        freshWebBuild: true,
        pageErrors: tripwire.pageErrors.length,
        consoleWarnings: tripwire.warnings.length,
        unexpectedFailedRequests: failedRequests.filter(request => request !== expectedReloadDisconnect).length,
      }, null, 2)}\n`, 'utf8')
    }
    failedRequests.length = 0
  }, 90_000)

  it('keeps a UI cancellation when the real process then exits zero', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-operation-queue-cancel-exit-zero'))
    const releasePath = join(root, 'exit-zero.release')
    const pidPath = join(root, 'exit-zero-pid.json')
    let processExitCode: number | null | undefined
    let handle: SubprocessHandle | undefined
    const dispose = scaffold.ctx.taskQueue.registerHandler({
      kind: 'operation.exit-zero-race@1' as never,
      async resolveAdmission() { return { releasePath, pidPath } },
      resources() { return [] },
      policy() { return { maxAttempts: 1 } },
      async prepare(resolved) { return resolved },
      start() {
        handle = scaffold.ctx.subprocess.spawn({
          argv: [process.execPath, EXIT_ZERO_FIXTURE, releasePath, pidPath],
          cwd: root,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
          graceMs: 1000,
        })
        return {
          done: (async () => {
            const exit = await handle.done
            processExitCode = exit.exitCode
            const quiescent = await handle.waitForExit()
            if (!quiescent) return { status: 'unknown' as const, failure: { category: 'race-quiescence', message: 'process remained live', sideEffect: 'unknown' as const, retriable: false } }
            if (exit.exitCode === 0) return { status: 'succeeded' as const, output: { exitCode: 0 } }
            return { status: 'failed' as const, failure: { category: 'race-exit', message: `exit ${String(exit.exitCode)}`, sideEffect: 'started' as const, retriable: false } }
          })(),
          async cancel() { await writeFile(releasePath, 'release\n') },
        }
      },
    })
    try {
      const loaderRuntime = scaffold.ctx.loader.internal
      if (loaderRuntime === undefined) throw new Error('Loader runtime is unavailable')
      if (scaffold.ctx.baseUrl === undefined) throw new Error('Loader base URL is unavailable')
      const taskQueueModule = await loaderRuntime.import('@deepseek-ai/dsh-task-queue', scaffold.ctx.baseUrl, {}) as {
        createVerifiedAgentAuthority(session: Agent['session']): unknown
      }
      const owner = scaffold.ctx.taskQueue.forAgent(taskQueueModule.createVerifiedAgentAuthority(agent.session) as never)
      const workId = await owner.enqueue({
        kind: 'operation.exit-zero-race@1',
        title: 'Exit zero race',
        input: {},
        idempotencyKey: 'operation-exit-zero-race-v1',
      } as never)
      await waitFor(() => owner.get(workId).state.status === 'running', 'exit-zero race running')
      await waitFor(async () => {
        try { await readFile(pidPath); return true } catch { return false }
      }, 'exit-zero race pid')
      observedRacePid = (JSON.parse(await readFile(pidPath, 'utf8')) as { pid: number }).pid
      expect(processAlive(observedRacePid)).toBe(true)

      const workspace = page.locator('section[aria-label="Task Queue"]')
      if (await workspace.count() === 0) await page.getByRole('button', { name: 'Queue' }).click()
      await page.getByRole('button', { name: 'Refresh' }).click()
      const row = workspace.locator('section[aria-label="Task list"] li').filter({ hasText: 'Exit zero race' })
      await row.waitFor({ timeout: 15_000 })
      await row.getByRole('button', { name: 'Cancel' }).click()
      const dialog = page.getByRole('dialog', { name: 'Cancel task' })
      await dialog.getByRole('checkbox').check()
      await dialog.getByRole('button', { name: 'Confirm' }).click()

      await waitFor(() => {
        if (owner.get(workId).state.status !== 'canceled') return false
        expect(processExitCode).toBe(0)
        expect(processAlive(observedRacePid!)).toBe(false)
        return true
      }, 'canceled after real exit zero')
      const terminal = owner.get(workId)
      expect(terminal.result).toBeNull()
      expect(terminal.state.status).toBe('canceled')
      await page.getByRole('button', { name: 'Refresh' }).click()
      await expect.poll(() => row.textContent(), { timeout: 15_000 }).toContain('Done')
      await row.getByRole('button').first().click()
      await expect.poll(
        () => workspace.locator('aside[aria-label="Task detail"]').textContent(),
        { timeout: 15_000 },
      ).toContain('Canceled')
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
      expect(failedRequests).toEqual([])
      const evidenceRoot = process.env.DSH_OPERATION_RUN_EVIDENCE_ROOT
      if (evidenceRoot !== undefined && evidenceRoot.length > 0) {
        await mkdir(evidenceRoot, { recursive: true })
        await writeFile(join(evidenceRoot, 'browser-exit-zero-race.json'), `${JSON.stringify({
          version: 1,
          recordedAt: new Date().toISOString(),
          ownerSessionId: OWNER_ID,
          workId,
          processPid: observedRacePid,
          processExitCode,
          processExitedBeforeCanceledObservation: true,
          status: terminal.state.status,
          resultIsNull: terminal.result === null,
          realSubprocess: true,
          canceledThroughQueueWorkspace: true,
          statusAfterRefresh: 'canceled',
        }, null, 2)}\n`, 'utf8')
      }
    } finally {
      dispose()
      if (handle !== undefined && processAlive(handle.pid)) {
        handle.terminate()
        await handle.waitForExit()
      }
    }
  }, 90_000)
})

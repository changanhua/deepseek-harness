import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { assertEntriesLoaded } from '@deepseek-ai/dsh-app-boot'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as OperationRunTaskQueue from '@deepseek-ai/dsh-operation-run-task-queue'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createVerifiedAgentAuthority, createVerifiedOperatorAuthority } from '@deepseek-ai/dsh-task-queue'
import * as ToolOperationRunTaskQueue from '@deepseek-ai/dsh-tool-operation-run-task-queue'
import * as ToolTaskQueue from '@deepseek-ai/dsh-tool-task-queue'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalTaskQueue, { WorkQueueStore } from '../src/index.ts'

const EMIT_FIXTURE = fileURLToPath(new URL('../../operation-run-task-queue/tests/fixtures/emit-operation.mjs', import.meta.url))
const MARKER = 'OPERATION-RUN-V1-OK'
const OWNER_ID = SessionId('operation-v2-owner')

let roots: string[] = []
let contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.reverse()) await context.fiber.dispose()
  contexts = []
  for (const root of roots.reverse()) await rm(root, { recursive: true, force: true })
  roots = []
})

function liveAgent(ctx: Context, sessionId = OWNER_ID): Agent {
  const scope = ctx.plugin({ inject: ['tools'], apply: () => {} })
  const session = ctx.sessions.create(sessionId)
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
  ctx.agents.register(agent)
  return agent
}

async function proposedStep(ctx: Context, agent: Agent): Promise<PreStepDecision> {
  return await ctx.waterfall(
    agent.ctx as never,
    'agent/pre-step',
    { agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

async function boot(queueRoot: string, resourceCapacity?: number, operationUnits = 1): Promise<Context> {
  const configRoot = await mkdtemp(join(tmpdir(), 'dsh-operation-v2-loader-'))
  roots.push(configRoot)
  const configPath = join(configRoot, 'cordis.yml')
  const fixtureDir = dirname(EMIT_FIXTURE)
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-subprocess-local'",
    "- name: '@deepseek-ai/dsh-task-queue-local'",
    '  config:',
    `    queueRoot: ${JSON.stringify(queueRoot)}`,
    '    maxConcurrent: 1',
    '    shutdownTimeoutMs: 5000',
    ...(resourceCapacity === undefined
      ? ['    resourceCapacity: {}']
      : ['    resourceCapacity:', `      operation-run: ${resourceCapacity}`]),
    "- name: '@deepseek-ai/dsh-operation-run-task-queue'",
    '  config:',
    '    operations:',
    '      fixture.echo:',
    '        revision: fixture.echo/v1',
    '        description: Emit the fixed acceptance marker.',
    `        argv: [${JSON.stringify(process.execPath)}, ${JSON.stringify(EMIT_FIXTURE)}]`,
    `        cwd: ${JSON.stringify(fixtureDir)}`,
    '        resource: operation-run',
    `        units: ${operationUnits}`,
    '        maxAttempts: 1',
    '        collectBytes: 4096',
    '        resultBytes: 1024',
    '        failureTailBytes: 512',
    '        graceMs: 1000',
    '        timeoutMs: 10000',
    "- name: '@deepseek-ai/dsh-tool-operation-run-task-queue'",
    "- name: '@deepseek-ai/dsh-tool-task-queue'",
    '  config:',
    '    maxNotificationsPerStep: 4',
    '',
  ].join('\n'))

  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(configRoot).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
    ['@deepseek-ai/dsh-task-queue-local', LocalTaskQueue],
    ['@deepseek-ai/dsh-operation-run-task-queue', OperationRunTaskQueue],
    ['@deepseek-ai/dsh-tool-operation-run-task-queue', ToolOperationRunTaskQueue],
    ['@deepseek-ai/dsh-tool-task-queue', ToolTaskQueue],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  assertEntriesLoaded(ctx, 'operation Queue vertical')
  return ctx
}

describe('operation.run@1 real Loader vertical', () => {
  it('admits ownerless operator single and Batch work idempotently without Session Notifications', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-operation-v2-operator-'))
    roots.push(root)
    const queueRoot = join(root, 'queue')
    const ctx = await boot(queueRoot, 1)
    const operator = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
    const single = {
      kind: 'operation.run@1' as const,
      title: 'Operator fixture echo',
      input: { operationId: 'fixture.echo' },
      idempotencyKey: 'operator-fixture-echo-v1',
    }
    const [firstId, repeatedId] = await Promise.all([operator.enqueue(single), operator.enqueue(single)])
    expect(repeatedId).toBe(firstId)

    const batch = {
      kind: 'operation.run@1' as const,
      items: [
        { title: 'Operator batch echo one', input: { operationId: 'fixture.echo' } },
        { title: 'Operator batch echo two', input: { operationId: 'fixture.echo' } },
      ],
      sharedPayload: { source: 'operator-loader-vertical' },
      idempotencyKey: 'operator-fixture-batch-v1',
      maxParallel: 1,
    }
    const [firstBatchId, repeatedBatchId] = await Promise.all([operator.enqueueBatch(batch), operator.enqueueBatch(batch)])
    expect(repeatedBatchId).toBe(firstBatchId)
    await waitFor(
      () => operator.list().length === 3 && operator.list().every(view => view.state.status === 'succeeded'),
      'operator-owned operations',
    )
    expect(operator.get(firstId).work).toMatchObject({ ownerSessionId: null, batchId: null })
    expect(operator.list().filter(view => view.work.batchId === firstBatchId)).toHaveLength(2)
    expect(operator.list().every(view => view.work.ownerSessionId === null)).toBe(true)

    await ctx.fiber.dispose()
    contexts = contexts.filter(context => context !== ctx)
    const reopened = new WorkQueueStore(queueRoot)
    const projection = await reopened.open()
    try {
      expect(projection.worksById.size).toBe(3)
      expect(projection.notificationsById.size).toBe(0)
      expect([...projection.receiptsByKey.values()]).toEqual(expect.arrayContaining([
        expect.objectContaining({ owner: { type: 'operator' }, source: 'operator', key: 'operator-fixture-echo-v1', workIds: [firstId], batchId: null }),
        expect.objectContaining({ owner: { type: 'operator' }, source: 'operator', key: 'operator-fixture-batch-v1', batchId: firstBatchId }),
      ]))
    } finally {
      await reopened.close()
    }
  }, 30_000)

  it('rejects missing resource capacity without persisting a WorkItem', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-operation-v2-no-capacity-'))
    roots.push(root)
    const ctx = await boot(join(root, 'queue'))
    const agent = liveAgent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('operation-no-capacity'),
      name: 'operation_run_enqueue',
      arguments: { title: 'No capacity', operationId: 'fixture.echo', idempotencyKey: 'no-capacity' },
      agent,
    })
    expect(result.isError).toBe(true)
    const owner = ctx.taskQueue.forAgent(createVerifiedAgentAuthority(agent.session))
    expect(owner.list()).toEqual([])
  })

  it('rejects a claim larger than declared capacity without persisting a WorkItem', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-operation-v2-excess-capacity-'))
    roots.push(root)
    const ctx = await boot(join(root, 'queue'), 1, 2)
    const agent = liveAgent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('operation-excess-capacity'),
      name: 'operation_run_enqueue',
      arguments: { title: 'Excess capacity', operationId: 'fixture.echo', idempotencyKey: 'excess-capacity' },
      agent,
    })
    expect(result.isError).toBe(true)
    const owner = ctx.taskQueue.forAgent(createVerifiedAgentAuthority(agent.session))
    expect(owner.list()).toEqual([])
  })

  it('runs through the registered Agent tool, reopens durable result, and delivers by stable reference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-operation-v2-success-'))
    roots.push(root)
    const queueRoot = join(root, 'queue')
    const first = await boot(queueRoot, 1)
    const firstAgent = liveAgent(first)
    expect(firstAgent.ctx.tools.get('operation_run_enqueue')).toBeDefined()

    const missingAgent = await first.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('operation-missing-agent'),
      name: 'operation_run_enqueue',
      arguments: { title: 'Missing owner', operationId: 'fixture.echo', idempotencyKey: 'missing-agent' },
    })
    expect(missingAgent.isError).toBe(true)

    const extraField = await first.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('operation-extra-field'),
      name: 'operation_run_enqueue',
      arguments: { title: 'Unsafe', operationId: 'fixture.echo', idempotencyKey: 'unsafe', argv: ['node'] },
      agent: firstAgent,
    })
    expect(extraField.isError).toBe(true)

    const unknown = await first.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('operation-unknown'),
      name: 'operation_run_enqueue',
      arguments: { title: 'Unknown', operationId: 'fixture.missing', idempotencyKey: 'unknown' },
      agent: firstAgent,
    })
    expect(unknown.isError).toBe(true)

    const owner = first.taskQueue.forAgent(createVerifiedAgentAuthority(firstAgent.session))
    await expect(owner.enqueue({
      kind: 'operation.run@1',
      title: 'Widened intent',
      input: { operationId: 'fixture.echo', env: { TOKEN: 'secret' } },
      idempotencyKey: 'widened',
    } as never)).rejects.toThrow(/operation\.run admission/)
    expect(owner.list()).toHaveLength(0)

    const enqueued = await first.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('operation-enqueue'),
      name: 'operation_run_enqueue',
      arguments: { title: 'Fixture echo', operationId: 'fixture.echo', idempotencyKey: 'fixture-echo-v1' },
      agent: firstAgent,
    })
    expect(enqueued.isError).toBe(false)
    if (enqueued.isError) throw new Error(enqueued.error.message)
    const workId = (enqueued.value as { id: string }).id
    await waitFor(() => owner.get(workId as never).state.status === 'succeeded', 'operation success')
    const terminal = owner.get(workId as never)
    expect(terminal.work.ownerSessionId).toBe(OWNER_ID)
    expect(terminal.work.resolved).toMatchObject({ operationId: 'fixture.echo', revision: 'fixture.echo/v1' })
    expect(terminal.attempts).toHaveLength(1)
    expect(terminal.result?.output).toEqual({
      operationId: 'fixture.echo',
      revision: 'fixture.echo/v1',
      summary: 'operation completed',
      stdout: { text: MARKER, truncated: false },
    })
    const notification = owner.pendingNotifications()[0]
    expect(notification).toMatchObject({ workId, ownerSessionId: OWNER_ID })

    await first.fiber.dispose()
    contexts = contexts.filter(context => context !== first)

    const second = await boot(queueRoot, 1)
    const secondAgent = liveAgent(second)
    const reopened = second.taskQueue.forAgent(createVerifiedAgentAuthority(secondAgent.session))
    await waitFor(() => {
      try { return reopened.get(workId as never).state.status === 'succeeded' } catch { return false }
    }, 'reopened operation result')
    expect(reopened.get(workId as never).result?.output).toEqual(terminal.result?.output)
    expect(reopened.pendingNotifications()).toHaveLength(1)

    const explicit = await second.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('operation-result'),
      name: 'task_queue_result',
      arguments: { id: workId },
      agent: secondAgent,
    })
    expect(explicit.isError).toBe(false)
    if (explicit.isError) throw new Error(explicit.error.message)
    expect(explicit.value).toMatchObject({ status: 'succeeded', output: { stdout: { text: MARKER } } })

    const decision = await proposedStep(second, secondAgent)
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('owner delivery did not enter')
    expect(decision.messages).toHaveLength(1)
    const message = decision.messages[0]!
    expect(message.id).toBe(notification?.messageId)
    const stableText = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(stableText).toContain(workId)
    expect(stableText).not.toContain(MARKER)
    expect(stableText).not.toContain(EMIT_FIXTURE)
    expect(stableText).not.toContain(process.execPath)
    let flushed = false
    second.on('session/flush', () => { flushed = true })
    secondAgent.session.append('user/message', message, { surfaceOp: 'append' })
    expect(reopened.pendingNotifications()).toHaveLength(1)
    await waitFor(() => reopened.pendingNotifications().length === 0, 'notification acknowledgement')
    expect(flushed).toBe(true)

    const evidenceRoot = process.env.DSH_OPERATION_RUN_EVIDENCE_ROOT
    if (evidenceRoot !== undefined && evidenceRoot.length > 0) {
      await mkdir(evidenceRoot, { recursive: true })
      await writeFile(join(evidenceRoot, 'loader-vertical.json'), `${JSON.stringify({
        version: 1,
        recordedAt: new Date().toISOString(),
        consumerTool: 'operation_run_enqueue',
        ownerSessionId: OWNER_ID,
        workId,
        attemptId: terminal.attempts[0]?.id,
        resultId: terminal.result?.id,
        notificationId: notification?.id,
        notificationMessageId: notification?.messageId,
        resolvedRevision: (terminal.work.resolved as { revision?: string }).revision,
        status: terminal.state.status,
        reopened: true,
        stdoutBytes: Buffer.byteLength(MARKER),
        stdoutTruncated: false,
        notificationAckAfterFlush: flushed && reopened.pendingNotifications().length === 0,
      }, null, 2)}\n`, 'utf8')
    }

    await second.fiber.dispose()
    contexts = contexts.filter(context => context !== second)
    const lockProbe = new WorkQueueStore(queueRoot)
    await lockProbe.open()
    try {
      expect(lockProbe.current().worksById.get(workId as never)?.id).toBe(workId)
    } finally {
      await lockProbe.close()
    }
  }, 30_000)
})

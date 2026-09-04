import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { createVerifiedAgentAuthority } from '@changanhua/dsh-task-queue'
import type { NotificationId, VerifiedAgentAuthority } from '@changanhua/dsh-task-queue'
import { createDshWorkHandler, resolveConfig } from '@changanhua/dsh-task-queue-executor-dsh'
import { createToolTaskQueue, installNotificationDelivery } from '@changanhua/dsh-tool-task-queue'
import { describe, expect, it } from 'vitest'
import LocalTaskQueue from '../src/index.ts'

const PROMPT = 'Return exactly QUEUE-V2-OWNER-DELIVERY-OK. Do not modify files, run commands, or call external services.'

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 2_400; index += 1) {
    if (predicate()) return
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  throw new Error('real agent.run WorkItem did not settle within ten minutes')
}

async function proposedStep(ctx: Context, agent: Agent): Promise<PreStepDecision> {
  return ctx.waterfall(
    agent.ctx as never,
    'agent/pre-step',
    { agent, messages: [], turn: 1, step: 1, signal: AbortSignal.any([]) },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
}

const realIt = process.env.DSH_REAL_AGENT_RUN === '1' ? it : it.skip

describe('real Queue-backed agent.run owner delivery', () => {
  realIt('persists the typed result and acknowledges only after Session flush', async () => {
    const repositoryRoot = resolve(import.meta.dirname, '../../../..')
    const evidenceRoot = join(repositoryRoot, 'outputs', 'task-queue-v2-owner-delivery', 'real-agent-run')
    const runtimeRoot = join(evidenceRoot, 'runtime', `run-${Date.now()}`)
    const queueRoot = join(runtimeRoot, 'queue')
    const sessionRoot = join(runtimeRoot, 'sessions')
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    await mkdir(evidenceRoot, { recursive: true })

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root: sessionRoot, compression: 'none' })
    await ctx.plugin(LocalSubprocessRuntime)
    const queue = new LocalTaskQueue(ctx, {
      queueRoot,
      maxConcurrent: 1,
      resourceCapacity: { 'agent-run': 1 },
    })
    queue.registerHandler(createDshWorkHandler(resolveConfig({
      launcher: [process.execPath, '--import', 'tsx/esm', join(repositoryRoot, 'apps', 'cli', 'src', 'bin.ts')],
      dshHome,
      workspaceDir: repositoryRoot,
      profile: 'task-worker',
      maxAssistantBytes: 64 * 1024,
      collectBytes: 256 * 1024,
      failureTailBytes: 8 * 1024,
      graceMs: 5_000,
      maxAttempts: 1,
    }), ctx.subprocess))

    const session = ctx.sessions.create(SessionId(`queue-v2-real-owner-${Date.now()}`), {
      meta: { cwd: repositoryRoot },
    })
    const ownerQueue = queue.forAgent(createVerifiedAgentAuthority(session))
    const workId = await ownerQueue.enqueue({
      kind: 'agent.run@1',
      title: 'QUEUE-V2-OWNER-DELIVERY',
      input: { prompt: PROMPT },
      idempotencyKey: `queue-v2-real-agent-run-${Date.now()}`,
    })
    await waitFor(() => {
      const status = ownerQueue.get(workId).state.status
      return status === 'succeeded' || status === 'failed' || status === 'unknown' || status === 'canceled'
    })
    const terminal = ownerQueue.get(workId)
    expect(terminal.state.status).toBe('succeeded')
    expect(terminal.result?.output).toMatchObject({ assistantText: 'QUEUE-V2-OWNER-DELIVERY-OK' })
    const notification = ownerQueue.pendingNotifications()[0]
    if (notification === undefined) throw new Error('real owner WorkItem must produce a pending Notification')

    const order: string[] = []
    const deliveryQueue = {
      forAgent(authority: VerifiedAgentAuthority) {
        const facade = queue.forAgent(authority)
        return {
          ...facade,
          async acknowledgeNotification(id: NotificationId, messageId: string) {
            order.push('ack')
            await facade.acknowledgeNotification(id, messageId)
          },
        }
      },
      listKinds: () => queue.listKinds(),
    } as unknown as LocalTaskQueue
    installNotificationDelivery(ctx, { taskQueue: deliveryQueue, maxNotificationsPerStep: 1 })
    ctx.on('session/flush', () => { order.push('flush') })
    const agent = { id: session.id, session, ctx } as Agent
    const decision = await proposedStep(ctx, agent)
    if (decision.kind !== 'enter') throw new Error('real owner delivery step must enter')
    expect(decision.messages).toHaveLength(1)
    const stableMessage = decision.messages[0]!
    const stableText = stableMessage.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    expect(stableMessage.id).toBe(notification.messageId)
    expect(stableText).not.toContain('QUEUE-V2-OWNER-DELIVERY-OK')
    session.append('user/message', stableMessage, { surfaceOp: 'append' })
    await waitFor(() => ownerQueue.pendingNotifications().length === 0)
    expect(order).toEqual(['flush', 'ack'])

    const resultTool = createToolTaskQueue({ taskQueue: queue }).tools
      .find(tool => tool.name === 'task_queue_result')!
    const explicitResult = await resultTool.execute({ id: workId }, { agent: { session } } as never)
    expect(explicitResult).toMatchObject({
      id: workId,
      status: 'succeeded',
      output: { assistantText: 'QUEUE-V2-OWNER-DELIVERY-OK' },
    })
    await ctx.sessions.flush(session)

    const attempt = terminal.attempts.at(-1)
    const evidence = {
      version: 1,
      recordedAt: new Date().toISOString(),
      profile: 'task-worker',
      providerBundle: '@liustack/modlens@3.23.1',
      workId,
      attemptId: attempt?.id,
      resultId: terminal.result?.id,
      notificationId: notification.id,
      messageId: notification.messageId,
      terminalSeq: notification.terminalSeq,
      ownerSessionId: session.id,
      status: terminal.state.status,
      processExitCode: 0,
      flushBeforeAcknowledge: order[0] === 'flush' && order[1] === 'ack',
      stableMessageContainsWorkerOutput: stableText.includes('QUEUE-V2-OWNER-DELIVERY-OK'),
      explicitResultContainsMarker: JSON.stringify(explicitResult).includes('QUEUE-V2-OWNER-DELIVERY-OK'),
      queueRoot: relative(repositoryRoot, queueRoot).replaceAll('\\', '/'),
      sessionRoot: relative(repositoryRoot, sessionRoot).replaceAll('\\', '/'),
    }
    await ctx.fiber.dispose()

    const evidencePath = join(evidenceRoot, 'evidence.json')
    const body = `${JSON.stringify(evidence, null, 2)}\n`
    await writeFile(evidencePath, body, 'utf8')
    const digest = createHash('sha256').update(await readFile(evidencePath)).digest('hex')
    await writeFile(join(evidenceRoot, 'SHA256SUMS'), `${digest}  evidence.json\n`, 'utf8')
  }, 600_000)
})

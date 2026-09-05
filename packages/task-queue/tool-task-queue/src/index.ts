/** Model-facing controls for typed Queue v2 WorkItems. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { messageAccepted, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { freezeMessage, MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import { canonicalJson, createVerifiedAgentAuthority } from '@changanhua/dsh-task-queue'
import type { AgentWorkQueue, TaskQueue, WorkStatus, WorkView } from '@changanhua/dsh-task-queue'
import type { Notification } from '@changanhua/dsh-task-queue'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis loader name. */
export const name = 'tool-task-queue'
/** The tools require a mounted durable v2 Queue provider. */
export const inject = ['tools', 'taskQueue', 'sessions']

/** Dependencies used by the pure tool factory. */
export interface ToolTaskQueueDeps { readonly taskQueue: TaskQueue }
/** Returned model tools. */
export interface ToolTaskQueueKit { readonly tools: readonly ReturnType<typeof defineTool>[] }

function requireAgentQueue(
  queue: TaskQueue,
  exec: { readonly agent?: { readonly session: Parameters<typeof createVerifiedAgentAuthority>[0] } },
): AgentWorkQueue {
  const session = exec.agent?.session
  if (session === undefined) throw new Error('task queue tools require a live Agent session')
  return queue.forAgent(createVerifiedAgentAuthority(session))
}

function summary(view: WorkView) {
  return {
    id: view.work.id,
    kind: view.work.kind,
    title: view.work.title,
    status: view.state.status,
    attemptCount: view.state.attemptCount,
    batchId: view.work.batchId,
  }
}

function counts(views: readonly WorkView[]): Record<WorkStatus, number> {
  const value: Record<WorkStatus, number> = { queued: 0, starting: 0, running: 0, unknown: 0, succeeded: 0, failed: 0, canceled: 0 }
  for (const view of views) value[view.state.status] += 1
  return value
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(canonicalJson(value)) as JsonValue
}

/**
 * Render trusted Notification metadata without exposing executor-controlled result fields.
 * @param view Terminal WorkItem projection.
 * @param notification Pending owner-delivery record.
 * @returns Stable user-message text that directs the Agent to explicit result retrieval.
 */
export function renderNotification(view: WorkView, notification: Notification): string {
  if (view.state.status !== 'succeeded' && view.state.status !== 'failed' && view.state.status !== 'canceled') {
    throw new Error(`Notification ${notification.id} refers to non-terminal WorkItem ${view.work.id}`)
  }
  return [
    'Background work reached a terminal outcome.',
    `Work: ${view.work.title} (${view.work.id})`,
    `Attempt: ${notification.attemptId ?? 'none'}`,
    `Outcome: ${view.state.status}`,
    `Result: ${notification.resultId ?? 'none'}`,
    'Inspect the durable result with task_queue_result.',
  ].join('\n')
}

/** Runtime dependencies and required delivery bound. */
export interface NotificationDeliveryOptions {
  readonly taskQueue: TaskQueue
  readonly maxNotificationsPerStep: number
}

function notificationMessage(view: WorkView, notification: Notification): UserMessage {
  return freezeMessage({
    id: MessageId(notification.messageId),
    role: 'user',
    content: [{ type: 'text', text: renderNotification(view, notification) }],
    source: {
      kind: 'plugin',
      plugin: name,
      form: 'notice',
      summary: 'Background work reached a terminal outcome.',
    },
  })
}

/**
 * Install replay-safe owner Notification delivery on Agent and Session events.
 * @param ctx Cordis context carrying live Agent and Session services.
 * @param options Queue provider and per-step delivery bound.
 * @returns disposer that prevents new injection and acknowledgement work.
 */
export function installNotificationDelivery(ctx: Context, options: NotificationDeliveryOptions): () => void {
  if (!Number.isSafeInteger(options.maxNotificationsPerStep) || options.maxNotificationsPerStep < 1) {
    throw new Error('maxNotificationsPerStep must be a positive safe integer')
  }
  const inFlight = new Map<string, Promise<void>>()
  let active = true

  const finalize = (session: Session, queue: AgentWorkQueue, notification: Notification): Promise<void> => {
    const existing = inFlight.get(notification.messageId)
    if (existing !== undefined) return existing
    const pending = (async () => {
      try {
        await ctx.sessions.flush(session)
        if (!active) return
        await queue.acknowledgeNotification(notification.id, notification.messageId)
      } catch (error: unknown) {
        ctx.logger.warn(`Queue Notification ${notification.id} remains pending after Session flush failure: ${String(error)}`)
      } finally {
        inFlight.delete(notification.messageId)
      }
    })()
    inFlight.set(notification.messageId, pending)
    return pending
  }

  const offPreStep = ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (!active || decision.kind === 'reject') return decision
    const queue = options.taskQueue.forAgent(createVerifiedAgentAuthority(agent.session))
    const additions: UserMessage[] = []
    for (const notification of queue.pendingNotifications()) {
      const accepted = messageAccepted(
        agent.session.events,
        message => message.id === notification.messageId,
      )
      if (accepted) {
        void finalize(agent.session, queue, notification)
        continue
      }
      if (decision.messages.some(message => message.id === notification.messageId)) continue
      if (additions.length >= options.maxNotificationsPerStep) break
      additions.push(notificationMessage(queue.get(notification.workId), notification))
    }
    return additions.length === 0
      ? decision
      : { kind: 'enter', messages: [...decision.messages, ...additions] }
  })

  const offSessionEvent = ctx.on('session/event', (session, event) => {
    if (!active || event.type !== 'user/message') return
    const queue = options.taskQueue.forAgent(createVerifiedAgentAuthority(session))
    const notification = queue.pendingNotifications()
      .find(candidate => candidate.messageId === event.data.id)
    if (notification !== undefined) void finalize(session, queue, notification)
  })

  return () => {
    if (!active) return
    active = false
    offSessionEvent()
    offPreStep()
  }
}

/**
 * Build the Queue v2 tool set.
 * @param deps Queue service dependencies.
 * @returns Model tools restricted to the active Agent session.
 */
export function createToolTaskQueue(deps: ToolTaskQueueDeps): ToolTaskQueueKit {
  const tools = [
    defineTool({
      name: 'task_queue_list', description: 'List this Agent session\'s durable WorkItems.', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { works: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } } } }, render: (_args, value) => [{ type: 'text', text: `${value.works.length} work item(s)` }] },
      execute(_args, exec) {
        return Promise.resolve({ works: requireAgentQueue(deps.taskQueue, exec).list().map(summary) })
      },
      presentCall: () => ({ card: 'generic', title: 'List queue work', kind: 'read' }),
    }),
    defineTool({
      name: 'task_queue_status', description: 'Read one WorkItem owned by this Agent session.', parameters: { id: { type: 'string', required: true } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: { id: { type: 'string', required: true }, status: { type: 'string', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: `${value.id}: ${value.status}` }],
      },
      execute(args, exec) {
        return Promise.resolve(summary(requireAgentQueue(deps.taskQueue, exec).get(args.id as never)))
      },
      presentCall: () => ({ card: 'generic', title: 'Queue work status', kind: 'read' }),
    }),
    defineTool({
      name: 'task_queue_result',
      description: 'Read the typed terminal result or failure for one WorkItem owned by this Agent session.',
      parameters: { id: { type: 'string', required: true } },
      output: { schema: { type: 'object', additionalProperties: true, properties: { status: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: `result status: ${value.status}` }] },
      execute(args, exec) {
        const view = requireAgentQueue(deps.taskQueue, exec).get(args.id as never)
        return Promise.resolve({
          id: view.work.id,
          status: view.state.status,
          output: view.result === null ? null : jsonValue(view.result.output),
          failure: view.state.failure === null ? null : jsonValue(view.state.failure),
        })
      },
      presentCall: () => ({ card: 'generic', title: 'Read queue result', kind: 'read' }),
    }),
    defineTool({
      name: 'task_queue_cancel', description: 'Cancel one non-terminal WorkItem owned by this Agent session.', parameters: { id: { type: 'string', required: true } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: `cancellation requested for ${value.id}` }] },
      async execute(args, exec) { await requireAgentQueue(deps.taskQueue, exec).cancel(args.id as never); return { id: args.id } }, presentCall: () => ({ card: 'generic', title: 'Cancel queue work', kind: 'execute' }),
    }),
    defineTool({
      name: 'task_queue_retry', description: 'Retry one failed WorkItem owned by this Agent session.', parameters: { id: { type: 'string', required: true } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: `retried ${value.id}` }] },
      async execute(args, exec) { await requireAgentQueue(deps.taskQueue, exec).retry(args.id as never); return { id: args.id } }, presentCall: () => ({ card: 'generic', title: 'Retry queue work', kind: 'execute' }),
    }),
    defineTool({
      name: 'task_queue_stats', description: 'Count this Agent session\'s WorkItems by lifecycle status.', parameters: {},
      output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: () => [{ type: 'text', text: 'queue statistics' }] },
      execute(_args, exec) {
        return Promise.resolve({ counts: counts(requireAgentQueue(deps.taskQueue, exec).list()) })
      },
      presentCall: () => ({ card: 'generic', title: 'Queue statistics', kind: 'read' }),
    }),
    defineTool({
      name: 'task_queue_kinds', description: 'List typed WorkKinds enabled by this host.', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { kinds: { type: 'array', required: true, items: { type: 'string' } } } }, render: (_args, value) => [{ type: 'text', text: value.kinds.join(', ') || '(none)' }] },
      execute() { return Promise.resolve({ kinds: [...deps.taskQueue.listKinds()] }) },
      presentCall: () => ({ card: 'generic', title: 'Queue WorkKinds', kind: 'read' }),
    }),
  ]
  return { tools }
}

/** Required owner delivery bound. */
export interface Config {
  /** Maximum pending owner Notifications appended during one Agent pre-step. */
  readonly maxNotificationsPerStep: number
}
/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  maxNotificationsPerStep: z.number().step(1).min(1).required(),
})
/** Register Queue v2 model tools. */
export function apply(ctx: Context, config: Config): void {
  const kit = createToolTaskQueue({ taskQueue: ctx.taskQueue })
  for (const tool of kit.tools) ctx.tools.register(tool)
  ctx.effect(() => installNotificationDelivery(ctx, {
    taskQueue: ctx.taskQueue,
    maxNotificationsPerStep: config.maxNotificationsPerStep,
  }), 'tool-task-queue: owner Notification delivery')
}

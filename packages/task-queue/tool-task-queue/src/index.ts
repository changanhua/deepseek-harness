/**
 * Agent-facing task-queue toolkit. Loading this plugin once registers, in a
 * single apply (no second listener-duplicating mount):
 *
 * 1. the eight `task_queue_*` tools,
 * 2. the `tool:task-queue` system-prompt section,
 * 3. the `agent/pre-step` candidate-notification hook, and
 * 4. the `session/event` append→flush→CAS-ack finalizer plus the `turn/end`
 *    inFlight reconciliation.
 *
 * The host task-queue Service is read via `ctx.get('taskQueue')` (optional):
 * with no backend composed the tools still register but reject with a clear
 * `@deepseek-ai/dsh-task-queue-local` message, and the pre-step/finalizer hooks
 * no-op. The durable-notification outbox protocol (the pre-step prepares
 * injected messages but never flushes or acks them; the append is observed
 * through the `session/event` firehose and the CAS ack runs only after a
 * successful `ctx.sessions.flush`; a candidate whose marker already sits in
 * the session — the append-before-ack crash window — is not re-injected but
 * handed straight to the same finalizer) follows design §7.4.
 *
 * @module @deepseek-ai/dsh-tool-task-queue
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {
  EnqueueSpec,
  ListFilter,
  QueueStats,
  TaskQueue,
  TaskSummary,
} from '@deepseek-ai/dsh-task-queue'
import { TaskId, NotificationId } from '@deepseek-ai/dsh-task-queue'

/** Stable per-notification message id, embedded in the marker line. */
type MessageId = string

/** Executor registry name. `'shell'` is inbox-only and rejected by the tools. */
type ExecutorName = 'claude' | 'codex' | 'opencode' | 'arkcli' | 'shell' | (string & {})

export const name = 'tool-task-queue'
export const inject = ['tools', 'systemPrompt', 'sessions']

/** Marker-line preamble identifying one durable notification (design §7.4). */
const MARKER_PREFIX = '[task-queue-notification '

/** Extract `(notificationId, messageId)` from one notification marker line. */
const MARKER_RE = /\[task-queue-notification\s+([^\s\]]+)\s+([^\s\]]+)\]/g

/** Batch admission cap (design §7.5). */
const BATCH_LIMIT = 200

/** Executors the model-facing tools must never submit. */
const FORBIDDEN_EXECUTORS: readonly ExecutorName[] = ['shell']

/**
 * Identity of one notification candidate ready to be proposed as a pre-step
 * message. `messageId` is the stable dedupe key embedded in the marker line.
 */
interface NotificationCandidate {
  notificationId: string
  messageId: MessageId
  taskId: string
  terminalSeq: number
  ownerSessionId: string
  title: string
  status: string
  /** Result summary from the task's outcome, when the task succeeded. */
  resultSummary?: string
}

/**
 * Render the stable marker line for one notification.
 * @param notificationId - the notification's stable id.
 * @param messageId - the notification's stable message id.
 * @returns the `[task-queue-notification <notificationId> <messageId>]` line.
 */
export function markerLine(notificationId: string, messageId: MessageId): string {
  return `${MARKER_PREFIX}${notificationId} ${messageId}]`
}

/**
 * Parse the first `[task-queue-notification <id> <messageId>]` marker from a
 * text block.
 * @param text - the message text to scan.
 * @returns the marker's `notificationId` and `messageId`, or `undefined` when
 * the text carries no marker.
 */
export function matchMarker(text: string): { notificationId: string; messageId: MessageId } | undefined {
  MARKER_RE.lastIndex = 0
  const match = MARKER_RE.exec(text)
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined
  return { notificationId: match[1], messageId: match[2] }
}

/** Read all marker identities already present in a session's user messages. */
function markersInEvents(events: readonly SessionEvent[]): Set<MessageId> {
  const seen = new Set<MessageId>()
  for (const event of events) {
    if (event.type !== 'user/message') continue
    for (const block of event.data.content) {
      if (block.type !== 'text') continue
      const marker = matchMarker(block.text)
      if (marker !== undefined) seen.add(marker.messageId)
    }
  }
  return seen
}

/** First text of a message's content blocks, if the message has any text. */
function textOf(content: readonly ContentBlock[]): string {
  let out = ''
  for (const block of content) {
    if (block.type === 'text') out += block.text
  }
  return out
}

/** Render one notification candidate into a notice user-message. */
function renderNotification(candidate: NotificationCandidate): ReturnType<typeof createUserMessage> {
  const summary = `task ${candidate.taskId} ${candidate.status}`
  let text = `Background task "${candidate.title || candidate.taskId}" reached ${candidate.status}.\n`
  if (candidate.resultSummary !== undefined) {
    text += `Outcome: ${candidate.resultSummary}\n`
  }
  text += 'Inspect it with task_queue_status for details.\n'
    + markerLine(candidate.notificationId, candidate.messageId)
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name, form: 'notice', summary },
  })
}

/**
 * Validate a raw model-supplied spec into a canonical {@link EnqueueSpec}.
 * @param raw - the model-supplied spec value to validate.
 * @returns the canonical spec, with every supported field validated.
 */
export function validateEnqueueSpec(raw: unknown): EnqueueSpec {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('task_queue_enqueue: spec must be an object')
  }
  const spec = raw as Record<string, unknown>
  if (typeof spec.title !== 'string' || spec.title.trim().length === 0) {
    throw new Error('task_queue_enqueue: `title` must be a non-empty string')
  }
  if (typeof spec.prompt !== 'string' || spec.prompt.length === 0) {
    throw new Error('task_queue_enqueue: `prompt` must be a non-empty string')
  }
  if (typeof spec.executor !== 'string' || spec.executor.length === 0) {
    throw new Error('task_queue_enqueue: `executor` must be a non-empty string')
  }
  if (FORBIDDEN_EXECUTORS.includes(spec.executor)) {
    throw new Error('task_queue_enqueue: executor "shell" is inbox-only; the model tools must not enqueue shell tasks')
  }
  if (spec.idempotencyKey !== undefined) {
    if (typeof spec.idempotencyKey !== 'string') {
      throw new Error('task_queue_enqueue: `idempotencyKey` must be a string')
    }
    if (spec.idempotencyKey.length < 1 || spec.idempotencyKey.length > 128) {
      throw new Error('task_queue_enqueue: `idempotencyKey` must be 1–128 bytes')
    }
    if (spec.idempotencyKey.includes('\u0000')) {
      throw new Error('task_queue_enqueue: `idempotencyKey` must not contain NUL')
    }
  }
  const out: EnqueueSpec = {
    title: spec.title,
    prompt: spec.prompt,
    executor: spec.executor,
  }
  if (spec.priority !== undefined) {
    if (typeof spec.priority !== 'number' || !Number.isSafeInteger(spec.priority)) {
      throw new Error('task_queue_enqueue: `priority` must be a safe integer')
    }
    out.priority = spec.priority
  }
  if (spec.maxAttempts !== undefined) {
    if (typeof spec.maxAttempts !== 'number' || !Number.isSafeInteger(spec.maxAttempts) || spec.maxAttempts < 1) {
      throw new Error('task_queue_enqueue: `maxAttempts` must be a positive integer (default 3)')
    }
    out.maxAttempts = spec.maxAttempts
  }
  if (spec.backoffMs !== undefined) {
    if (typeof spec.backoffMs !== 'number' || !Number.isSafeInteger(spec.backoffMs) || spec.backoffMs < 0) {
      throw new Error('task_queue_enqueue: `backoffMs` must be a non-negative integer')
    }
    out.backoffMs = spec.backoffMs
  }
  if (spec.delayUntil !== undefined) {
    if (typeof spec.delayUntil !== 'string') throw new Error('task_queue_enqueue: `delayUntil` must be an ISO string')
    out.delayUntil = spec.delayUntil
  }
  if (spec.timeoutMs !== undefined) {
    if (typeof spec.timeoutMs !== 'number' || !Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs <= 0) {
      throw new Error('task_queue_enqueue: `timeoutMs` must be a positive integer')
    }
    out.timeoutMs = spec.timeoutMs
  }
  if (spec.outputDir !== undefined) {
    if (typeof spec.outputDir !== 'string') throw new Error('task_queue_enqueue: `outputDir` must be a string')
    out.outputDir = spec.outputDir
  }
  if (spec.tags !== undefined) {
    if (!Array.isArray(spec.tags)) {
      throw new Error('task_queue_enqueue: `tags` must be a string array')
    }
    const tags: string[] = []
    for (const tag of spec.tags) {
      if (typeof tag !== 'string') {
        throw new Error('task_queue_enqueue: `tags` must be a string array')
      }
      tags.push(tag)
    }
    out.tags = tags
  }
  if (spec.idempotencyKey !== undefined) out.idempotencyKey = spec.idempotencyKey
  return out
}

/** Shared param authoring: tag array. */
const TAGS_PARAM = {
  type: 'array',
  description: 'Free-form filter tags.',
  items: { type: 'string' },
} as const

/** Shared param authoring: the enqueue spec object. */
const SPEC_PARAM = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', required: true, description: 'One-line title.' },
    prompt: { type: 'string', required: true, description: 'Complete instruction handed to the executor.' },
    executor: { type: 'string', required: true, description: "Registered executor name. Built-ins: claude/codex/opencode/arkcli (CLI coding agents) and node (local Node script; prompt must be JSON { script, args? }). Never 'shell' (inbox-only). Query task_queue_executors for the currently enabled set." },
    priority: { type: 'integer', description: 'Lower is higher precedence (default 10).' },
    maxAttempts: { type: 'integer', description: 'Total execution attempts; default 3.' },
    backoffMs: { type: 'integer', description: 'Backoff base in ms (default 30000).' },
    delayUntil: { type: 'string', description: 'ISO timestamp; not claimable before it.' },
    timeoutMs: { type: 'integer', description: 'Per-execution timeout in ms (default 1800000).' },
    outputDir: { type: 'string', description: 'Output directory.' },
    tags: TAGS_PARAM,
    idempotencyKey: { type: 'string', description: 'Cross-call dedupe key (1–128 bytes, no NUL).' },
  },
} as const

/** Shared task-summary output schema. */
export const TASK_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    executor: { type: 'string', required: true },
    status: { type: 'string', required: true },
    priority: { type: 'integer', required: true },
    attempt: { type: 'integer', required: true },
    maxAttempts: { type: 'integer', required: true },
    tags: { type: 'array', required: true, items: { type: 'string' } },
    createdAt: { type: 'string', required: true },
    updatedAt: { type: 'string', required: true },
    // The contract summary carries these two nullable fields (task-queue
    // TaskSummary); declaring them (optional) keeps `task_queue_list` from
    // rejecting the backend projection under additionalProperties:false. The
    // `status` tool spreads these properties too but does not project
    // ownerSessionId, so neither is required.
    lastError: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    ownerSessionId: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    dismissed: { type: 'boolean', required: true },
  },
} as const

/** Summary status counts for `task_queue_stats`. */
const STATUS_COUNT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pending: { type: 'integer', required: true },
    starting: { type: 'integer', required: true },
    running: { type: 'integer', required: true },
    stopping: { type: 'integer', required: true },
    succeeded: { type: 'integer', required: true },
    failed: { type: 'integer', required: true },
    canceled: { type: 'integer', required: true },
  },
} as const

// ---------------------------------------------------------------------------
// Injectable factory.
// ---------------------------------------------------------------------------

const ENQUEUE_DESCRIPTION =
  'Enqueue one durable, cross-session task on the host task queue. Use the queue for '
  + 'batch work (3 or more independent tasks), long-running jobs, work that may need '
  + 'retry, or anything that should survive the session; use inline execution for a single '
  + 'quick interaction. Rejects executor "shell".'

/** Dependencies the toolkit needs beyond the Cordis context. */
export interface ToolTaskQueueDeps {
  /** The host task-queue Service; `undefined` means no backend is composed. */
  taskQueue: TaskQueue | undefined
  /** Read a session's live events (dedup + reconciliation). */
  sessionEvents: (session: Session) => readonly SessionEvent[]
  /** Flush a live session to durable storage (`ctx.sessions.flush`). */
  flushSession: (session: Session) => Promise<boolean>
}

/** The assembled toolkit surface returned by {@link createToolTaskQueue}: the
 * registered tools, prompt section, pre-step/finalizer handlers, and the shared
 * `inFlight` set. */
export interface ToolTaskQueueKit {
  /** The shared `inFlight` message-id set (reconciled on turn/end). */
  inFlight: Set<MessageId>
  tools: ToolDefinition[]
  section: { name: string; order: number; text: string }
  /** Pre-step handler: returns the (possibly extended) decision. Never acks. */
  preStep: (agent: Agent, decision: PreStepDecision) => PreStepDecision
  /** session/event listener: observes markers, runs the finalizer, reconciles turn/end. */
  sessionEvent: (session: Session, event: SessionEvent) => void
}

/**
 * The `tool:task-queue` system-prompt section.
 * @returns the named section record with `order` 107 (after `tool:jobs`).
 */
export function buildSection(): { name: string; order: number; text: string } {
  return {
    name: 'tool:task-queue',
    order: 107,
    text: 'Use the task_queue_* tools for durable cross-session work. Enqueue a batch first, then report the '
      + 'queued ids — do not inline a batch of 3 or more independent tasks, long-running jobs, or anything that '
      + 'may need retry or should survive the session. At session start, call task_queue_stats to see the backlog, '
      + 'and task_queue_executors to see which executors this deployment enables. For batch LLM/script work use '
      + 'the node executor with a local script (prompt JSON { script, args? }); use claude/codex/opencode/arkcli '
      + 'only for full coding-agent jobs. Never submit shell (inbox-only). When a task is failed, report it '
      + 'proactively and suggest task_queue_retry. For a failure you have diagnosed and will not retry, '
      + 'task_queue_dismiss soft-concludes it (leaves attention, keeps the record); task_queue_undismiss '
      + 'restores it. Do not re-enqueue duplicate work: call task_queue_list first '
      + 'to check for an existing matching task. Your responsibilities are delivery (enqueue), monitoring '
      + '(list/status/stats/executors), failure triage (retry/cancel), and reporting results.',
  }
}

/**
 * Build the full toolkit around an injectable set of dependencies. Standalone
 * tests drive this factory directly; `apply` wires it to the Cordis services.
 * @param deps - the toolkit dependencies (host Service, and the session-event
 * reader and flush callbacks).
 * @returns the assembled {@link ToolTaskQueueKit}.
 */
export function createToolTaskQueue(deps: ToolTaskQueueDeps): ToolTaskQueueKit {
  const { taskQueue, sessionEvents, flushSession } = deps
  const inFlight = new Set<MessageId>()

  const resolveTaskQueue = (): TaskQueue => {
    if (taskQueue === undefined) {
      throw new Error('task queue unavailable: load @deepseek-ai/dsh-task-queue-local in the host composition')
    }
    return taskQueue
  }

  // --- tools -------------------------------------------------------------
  const tools: ToolDefinition[] = [
    defineTool({
      name: 'task_queue_enqueue',
      description: ENQUEUE_DESCRIPTION,
      parameters: { spec: { ...SPEC_PARAM, required: true } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `enqueued task ${value.id}` }],
      },
      async execute(args, exec) {
        const spec = validateEnqueueSpec(args.spec)
        const ownerSessionId = ownerSessionIdOf(exec)
        if (ownerSessionId !== undefined) spec.ownerSessionId = ownerSessionId
        const id = await resolveTaskQueue().enqueueFromTool(spec)
        return { id }
      },
      presentCall: args => ({ card: 'generic', title: 'Enqueue task', kind: 'execute', rawInput: args.spec }),
    }),
    defineTool({
      name: 'task_queue_enqueue_batch',
      description: 'Enqueue up to 200 tasks in one batch. Use for 3 or more independent tasks. Rejects any executor "shell".',
      parameters: {
        specs: {
          type: 'array',
          required: true,
          description: 'Task specs to enqueue (at most 200).',
          items: SPEC_PARAM,
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ids: { type: 'array', required: true, items: { type: 'string' } } } },
        render: (_args, value) => [{ type: 'text', text: `enqueued ${value.ids.length} tasks: ${value.ids.join(', ')}` }],
      },
      async execute(args, exec) {
        if (args.specs.length > BATCH_LIMIT) {
          throw new Error(`task_queue_enqueue_batch: at most ${BATCH_LIMIT} specs per call (got ${args.specs.length})`)
        }
        const ownerSessionId = ownerSessionIdOf(exec)
        const specs = args.specs.map((raw: unknown) => {
          const spec = validateEnqueueSpec(raw)
          if (ownerSessionId !== undefined) spec.ownerSessionId = ownerSessionId
          return spec
        })
        const ids = await resolveTaskQueue().enqueueBatchFromTool(specs)
        return { ids }
      },
      presentCall: args => ({ card: 'generic', title: `Enqueue ${args.specs.length} tasks`, kind: 'execute' }),
    }),
    defineTool({
      name: 'task_queue_list',
      description: 'List queued tasks with optional status/executor/tags filters and a limit. Use before enqueueing to avoid duplicates.',
      parameters: {
        status: { type: 'string', description: 'Filter by status (pending/starting/running/stopping/succeeded/failed/canceled).' },
        executor: { type: 'string', description: 'Filter by executor name.' },
        tags: TAGS_PARAM,
        limit: { type: 'integer', description: 'Maximum tasks to return.' },
      },
      output: {
        schema: { type: 'array', items: TASK_SUMMARY_SCHEMA },
        render: (_args, tasks) => tasks.length === 0
          ? [{ type: 'text', text: '(no tasks)' }]
          : [{ type: 'text', text: (tasks as TaskSummary[]).map(t => `${t.id} [${t.executor}] ${t.status} — ${t.title}`).join('\n') }],
      },
      execute(args, _exec) {
        const filter: ListFilter = {}
        if (args.status !== undefined) filter.status = args.status as TaskSummary['status']
        if (args.executor !== undefined) filter.executor = args.executor
        if (args.tags !== undefined) filter.tags = args.tags
        if (args.limit !== undefined) filter.limit = args.limit
        return Promise.resolve(resolveTaskQueue().list(filter))
      },
      presentCall: () => ({ card: 'generic', title: 'List tasks', kind: 'read' }),
    }),
    defineTool({
      name: 'task_queue_status',
      description: 'Get the full record of one task by id.',
      parameters: { id: { type: 'string', required: true, description: 'Task id returned by enqueue.' } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...TASK_SUMMARY_SCHEMA.properties,
            prompt: { type: 'string', required: true },
            delayUntil: { type: 'string' },
            timeoutMs: { type: 'integer', required: true },
            backoffMs: { type: 'integer', required: true },
            outputDir: { type: 'string' },
            lastError: { type: 'string' },
            result: { type: 'object', additionalProperties: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `${value.id} [${value.executor}] ${value.status} — ${value.title}` }],
      },
      async execute(args, _exec) {
        const task = resolveTaskQueue().get(TaskId(args.id))
        // Project null-able fields away so the output schema stays closed.
        return {
          id: task.id,
          title: task.title,
          executor: task.executor,
          status: task.status,
          priority: task.priority,
          attempt: task.attempt,
          maxAttempts: task.maxAttempts,
          tags: task.tags,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          dismissed: task.dismissed,
          prompt: task.prompt,
          ...(task.delayUntil !== null ? { delayUntil: task.delayUntil } : {}),
          timeoutMs: task.timeoutMs,
          backoffMs: task.backoffMs,
          outputDir: task.outputDir,
          ...(task.lastError !== null ? { lastError: task.lastError } : {}),
          ...(task.result !== null ? { result: task.result as unknown as Record<string, import('@deepseek-ai/dsh-session').JsonValue> } : {}),
        }
      },
      presentCall: args => ({ card: 'generic', title: `Task ${args.id}`, kind: 'read', rawInput: args.id }),
    }),
    defineTool({
      name: 'task_queue_cancel',
      description: 'Cancel a pending task (or request stop of a starting/running one) by id.',
      parameters: { id: { type: 'string', required: true, description: 'Task id to cancel.' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { outcome: { type: 'string', required: true, enum: ['canceled', 'stopping'] } } },
        render: (_args, value) => [{ type: 'text', text: `task ${value.outcome === 'canceled' ? 'canceled' : 'stop requested (stopping)'}` }],
      },
      async execute(args, exec) {
        const tq = resolveTaskQueue()
        const task = tq.get(TaskId(args.id))
        assertOwnerOrHost(exec, task.ownerSessionId)
        return { outcome: await tq.cancel(TaskId(args.id)) }
      },
      presentCall: args => ({ card: 'generic', title: `Cancel task ${args.id}`, kind: 'execute', rawInput: args.id }),
    }),
    defineTool({
      name: 'task_queue_retry',
      description: 'Retry a failed task (attempts reset, returns to pending).',
      parameters: { id: { type: 'string', required: true, description: 'Failed task id to retry.' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `task ${value.id} returned to pending` }],
      },
      async execute(args, exec) {
        const tq = resolveTaskQueue()
        const task = tq.get(TaskId(args.id))
        assertOwnerOrHost(exec, task.ownerSessionId)
        return { id: await tq.retry(TaskId(args.id)) }
      },
      presentCall: args => ({ card: 'generic', title: `Retry task ${args.id}`, kind: 'execute', rawInput: args.id }),
    }),
    defineTool({
      name: 'task_queue_dismiss',
      description: 'Soft-conclude a terminal task (succeeded/failed/canceled) by id: it leaves the attention badge and "needs attention" filter but keeps its record. Reversible with task_queue_undismiss. Use for failures you have diagnosed and decided not to retry.',
      parameters: {
        id: { type: 'string', required: true, description: 'Terminal task id to dismiss.' },
        dismissed: { type: 'boolean', description: 'true to conclude (default), false to restore.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, dismissed: { type: 'boolean', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `task ${value.id} ${value.dismissed ? 'dismissed' : 'restored'}` }],
      },
      async execute(args, exec) {
        const tq = resolveTaskQueue()
        const task = tq.get(TaskId(args.id))
        assertOwnerOrHost(exec, task.ownerSessionId)
        const dismissed = args.dismissed !== false
        await tq.dismiss(TaskId(args.id), dismissed)
        return { id: args.id, dismissed }
      },
      presentCall: args => ({ card: 'generic', title: `Dismiss task ${args.id}`, kind: 'execute', rawInput: args.id }),
    }),
    defineTool({
      name: 'task_queue_undismiss',
      description: 'Restore a dismissed terminal task to attention by id. Reverses task_queue_dismiss.',
      parameters: { id: { type: 'string', required: true, description: 'Dismissed task id to restore.' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, dismissed: { type: 'boolean', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `task ${value.id} restored` }],
      },
      async execute(args, exec) {
        const tq = resolveTaskQueue()
        const task = tq.get(TaskId(args.id))
        assertOwnerOrHost(exec, task.ownerSessionId)
        await tq.dismiss(TaskId(args.id), false)
        return { id: args.id, dismissed: false }
      },
      presentCall: args => ({ card: 'generic', title: `Restore task ${args.id}`, kind: 'execute', rawInput: args.id }),
    }),
    defineTool({
      name: 'task_queue_stats',
      description: 'Aggregate queue health: service state, per-status counts, and per-executor counts. Use at session start to see the backlog.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            serviceState: { type: 'string', required: true, enum: ['running', 'paused', 'faulted'] },
            fault: { type: 'object', additionalProperties: false, properties: { message: { type: 'string', required: true } } },
            counts: { ...STATUS_COUNT_SCHEMA, required: true },
            byExecutor: { type: 'object', additionalProperties: true, required: true },
          },
        },
        render: (_args, value) => {
          const counts = value.counts
          const line = `[${value.serviceState}] pending:${counts.pending} running:${counts.running} failed:${counts.failed} succeeded:${counts.succeeded}`
          const fault = value.fault?.message ?? ''
          return [{ type: 'text', text: fault.length > 0 ? `${line} — fault: ${fault}` : line }]
        },
      },
      execute(_args, _exec) {
        const stats: QueueStats = resolveTaskQueue().stats()
        // Normalize the contract's byStatus record into the declared counts shape.
        const counts = {
          pending: stats.byStatus.pending ?? 0,
          starting: stats.byStatus.starting ?? 0,
          running: stats.byStatus.running ?? 0,
          stopping: stats.byStatus.stopping ?? 0,
          succeeded: stats.byStatus.succeeded ?? 0,
          failed: stats.byStatus.failed ?? 0,
          canceled: stats.byStatus.canceled ?? 0,
        }
        return Promise.resolve({
          serviceState: stats.serviceState,
          ...(stats.fault !== undefined ? { fault: { message: stats.fault.reason } } : {}),
          counts,
          byExecutor: stats.byExecutor,
        })
      },
      presentCall: () => ({ card: 'generic', title: 'Task queue stats', kind: 'read' }),
    }),
    defineTool({
      name: 'task_queue_executors',
      description: 'List the executors this task queue has registered, with whether each is enabled for admission and whether the model tools may submit it. Call this before enqueueing to pick a valid executor.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            executors: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  enabled: { type: 'boolean', required: true },
                  toolAllowed: { type: 'boolean', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.executors.length === 0
            ? '(no executors registered)'
            : (value.executors as { name: string; enabled: boolean; toolAllowed: boolean }[])
              .map(e => `${e.name}: ${e.enabled ? 'enabled' : 'disabled'}${e.toolAllowed ? '' : ' (inbox-only)'}`)
              .join(' | '),
        }],
      },
      execute(_args, _exec) {
        return Promise.resolve({ executors: resolveTaskQueue().listExecutors() })
      },
      presentCall: () => ({ card: 'generic', title: 'Task queue executors', kind: 'read' }),
    }),
  ]

  // --- pre-step hook ------------------------------------------------------
  /**
   * Read this session's pending notifications and propose candidate messages.
   * Sorts by `terminalSeq`, skips anything already `inFlight`. A candidate
   * whose marker is already present in the session (append-before-ack crash)
   * is not re-injected — instead the pre-step starts the same flush→CAS
   * finalizer the `session/event` listener would have run before the crash
   * (design §7.4 step 6). This hook never flushes and never acks an injected
   * candidate — the finalizer does that only after observing the append.
   */
  const preStep = (agent: Agent, decision: PreStepDecision): PreStepDecision => {
    if (taskQueue === undefined || decision.kind === 'reject') return decision
    const session = agent.session
    const records = taskQueue.listNotifications({ ownerSessionId: session.id })
    if (records.length === 0) return decision
    const already = markersInEvents(sessionEvents(session))
    const chosenIds = new Set<MessageId>()
    const candidates = records
      .filter(r => r.status === 'pending')
      .filter(r => !inFlight.has(r.messageId))
      .sort((a, b) => a.terminalSeq - b.terminalSeq)
    const messages: ReturnType<typeof createUserMessage>[] = []
    for (const record of candidates) {
      if (already.has(record.messageId)) {
        inFlight.add(record.messageId)
        void finalize(session, record.notificationId, record.messageId)
        continue
      }
      const task = safeGetTask(taskQueue, record.taskId)
      const candidate: NotificationCandidate = {
        notificationId: record.notificationId,
        messageId: record.messageId,
        taskId: record.taskId,
        terminalSeq: record.terminalSeq,
        ownerSessionId: record.ownerSessionId,
        title: task?.title ?? record.taskId,
        status: task?.status ?? 'failed',
        ...(task?.resultSummary !== undefined ? { resultSummary: task.resultSummary } : {}),
      }
      inFlight.add(record.messageId)
      chosenIds.add(record.messageId)
      messages.push(renderNotification(candidate))
    }
    return {
      kind: 'enter',
      messages: [...decision.messages, ...messages],
    }
  }

  // --- session/event finalizer -------------------------------------------
  /**
   * Observe `user/message` appends for notification markers. On a match the
   * listener returns immediately (no append reentry) and launches a controlled
   * async finalizer: flush → CAS ack. On turn/end it reconciles `inFlight`, the
   * `messageId`s marked but never appended, back to unflighted.
   */
  const sessionEvent = (session: Session, event: SessionEvent): void => {
    if (taskQueue === undefined) return
    if (event.type === 'turn/end') {
      reconcile(session)
      return
    }
    if (event.type !== 'user/message') return
    const text = textOf(event.data.content)
    const marker = matchMarker(text)
    if (marker === undefined) return
    // Prevent my own injected notices from re-entering the finalizer for a
    // marker that has already been consumed; the marker itself is the key.
    void finalize(session, marker.notificationId, marker.messageId)
  }

  /**
   * Reconcile `inFlight`: drop any messageId whose marker never appears in the
   * session's user messages (a pre-step that was aborted/rejected). Retaining
   * them would pin the notification forever; clearing lets the next pre-step
   * re-inject. (design §7.4 step 4)
   */
  function reconcile(session: Session): void {
    const already = markersInEvents(sessionEvents(session))
    for (const id of inFlight) {
      if (!already.has(id)) inFlight.delete(id)
    }
  }

  /**
   * The append→flush→ack finalizer (design §7.4 step 5). A failed/absent
   * flush or a dead session clears `inFlight` and keeps the notification
   * pending; only success acks, and ack is CAS-idempotent.
   */
  async function finalize(session: Session, notificationId: string, messageId: MessageId): Promise<void> {
    if (taskQueue === undefined) return
    try {
      let flushed = false
      try {
        flushed = await flushSession(session)
      } catch {
        flushed = false
      }
      if (!flushed) {
        inFlight.delete(messageId)
        return
      }
      await taskQueue.ackNotification(NotificationId(notificationId), messageId)
      inFlight.delete(messageId)
    } catch {
      // Ack failure or flush rejection: keep the notification pending for the
      // next pre-step; it is idempotent under CAS.
      inFlight.delete(messageId)
    }
  }

  return {
    inFlight,
    tools,
    section: buildSection(),
    preStep,
    sessionEvent,
  }
}

/** Look up a task without throwing (missing record → undefined). */
function safeGetTask(taskQueue: TaskQueue, id: string): { title: string; status: string; resultSummary?: string } | undefined {
  try {
    const task = taskQueue.get(TaskId(id))
    const result: { title: string; status: string; resultSummary?: string } = {
      title: task.title,
      status: task.status,
    }
    if (task.result?.summary !== undefined) result.resultSummary = task.result.summary
    return result
  } catch {
    return undefined
  }
}

/**
 * Enforce that the caller is either the task's owner Agent or a host operator
 * (no Agent context). The model cannot set `ownerSessionId` itself, so the
 * Agent identity derived from the tool execution is the only authority path.
 * @param exec - the tool execution context carrying the caller Agent.
 * @param ownerSessionId - the task's owner session id; `null` for unowned tasks.
 * @throws when a non-owner Agent attempts to operate on another session's task.
 */
function assertOwnerOrHost(exec: ToolRunContext, ownerSessionId: string | null): void {
  const callerSession = exec.agent?.session.id
  if (callerSession === undefined) return // host-operator: no Agent context
  if (callerSession === ownerSessionId) return // agent-owner: matches
  throw new Error(
    `task_queue: this task is owned by session ${ownerSessionId ?? '(none)'}, `
    + `but the caller is session ${callerSession}. Only the task's owner or a host operator can cancel, retry, or dismiss it.`,
  )
}

/**
 * The session that owns a task admitted through the model tools. The model
 * cannot set `ownerSessionId` itself — `validateEnqueueSpec` strips it from
 * model input — so the initiator Agent recorded on the tool execution is the
 * only source; a call with no Agent (host-plane dispatch) admits an unowned
 * task, which then produces no notification.
 * @param exec - the tool execution context carrying the initiator Agent.
 * @returns the owning session id, or `undefined` when the call has no Agent.
 */
function ownerSessionIdOf(exec: ToolRunContext): string | undefined {
  return exec.agent?.session.id
}

/** Tool-task-queue plugin configuration (reserved; currently empty). */
export interface Config {}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({})

/**
 * Register all eight tools, the system-prompt section, the pre-step hook, and
 * the session/event finalizer in one apply. The host task-queue Service is
 * read optionally via `ctx.get('taskQueue')`.
 */
export function apply(ctx: Context, config: Config): void {
  void config
  const taskQueue = ctx.get('taskQueue')
  const kit = createToolTaskQueue({
    taskQueue,
    sessionEvents: session => session.events,
    flushSession: session => ctx.sessions.flush(session),
  })

  ctx.systemPrompt.section(kit.section)

  for (const tool of kit.tools) {
    ctx.tools.register(tool)
  }

  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (signal.aborted) return decision
    return kit.preStep(agent, decision)
  })

  ctx.on('session/event', (session, event) => {
    kit.sessionEvent(session, event)
  })
}

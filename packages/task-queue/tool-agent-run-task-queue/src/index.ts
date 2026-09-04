/** Agent-run-specific Queue admission tools. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createVerifiedAgentAuthority } from '@changanhua/dsh-task-queue'
import type { AgentWorkQueue, TaskQueue } from '@changanhua/dsh-task-queue'
import type {} from '@changanhua/dsh-task-queue-executor-dsh'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-agent-run-task-queue'
export const inject = ['tools', 'taskQueue']
/** Reserved admission-tool configuration. */
export interface Config {}
export const Config: z<Config> = z.object({})

/** Dependencies used by the pure admission-tool factory. */
export interface AgentRunTaskQueueDeps { readonly taskQueue: TaskQueue }
/** Agent-run admission tools returned for registration. */
export interface AgentRunTaskQueueKit { readonly tools: readonly ReturnType<typeof defineTool>[] }

function queueFor(
  queue: TaskQueue,
  exec: { readonly agent?: { readonly session: Parameters<typeof createVerifiedAgentAuthority>[0] } },
): AgentWorkQueue {
  if (exec.agent === undefined) throw new Error('agent.run queue admission requires a live Agent session')
  return queue.forAgent(createVerifiedAgentAuthority(exec.agent.session))
}

/**
 * Build the WorkKind-specific agent.run admission tools.
 * @param deps Queue service dependency.
 * @returns the two admission tools without host execution controls.
 */
export function createAgentRunTaskQueue(deps: AgentRunTaskQueueDeps): AgentRunTaskQueueKit {
  return { tools: [defineTool({
    name: 'task_queue_enqueue', description: 'Durably enqueue one restricted Harness worker request.',
    parameters: { title: { type: 'string', required: true }, prompt: { type: 'string', required: true }, idempotencyKey: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: `enqueued ${value.id}` }] },
    async execute(args, exec) { return { id: await queueFor(deps.taskQueue, exec).enqueue({ kind: 'agent.run@1', title: args.title, input: { prompt: args.prompt }, idempotencyKey: args.idempotencyKey }) } },
    presentCall: () => ({ card: 'generic', title: 'Enqueue worker task', kind: 'execute' }),
  }), defineTool({
    name: 'task_queue_enqueue_batch', description: 'Atomically enqueue restricted Harness worker requests.',
    parameters: { items: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string', required: true }, prompt: { type: 'string', required: true } } } }, idempotencyKey: { type: 'string', required: true }, maxParallel: { type: 'integer', required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: `enqueued batch ${value.id}` }] },
    async execute(args, exec) { if (args.maxParallel < 1) throw new Error('task queue batch maxParallel must be positive'); return { id: await queueFor(deps.taskQueue, exec).enqueueBatch({ kind: 'agent.run@1', items: args.items.map(item => ({ title: item.title, input: { prompt: item.prompt } })), sharedPayload: {}, idempotencyKey: args.idempotencyKey, maxParallel: args.maxParallel }) } },
    presentCall: () => ({ card: 'generic', title: 'Enqueue worker batch', kind: 'execute' }),
  })] }
}

/** Register the agent.run Queue admission tools. */
export function apply(ctx: Context, config: Config): void {
  void config
  for (const tool of createAgentRunTaskQueue({ taskQueue: ctx.taskQueue }).tools) ctx.tools.register(tool)
}

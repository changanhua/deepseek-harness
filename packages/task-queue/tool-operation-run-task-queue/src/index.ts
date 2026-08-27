/** Operation-run-specific Queue admission tools. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createVerifiedAgentAuthority } from '@deepseek-ai/dsh-task-queue'
import type { AgentWorkQueue, TaskQueue } from '@deepseek-ai/dsh-task-queue'
import type {} from '@deepseek-ai/dsh-operation-run-task-queue'
import { defineTool, ToolArgsError, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'

/** Cordis loader name. */
export const name = 'tool-operation-run-task-queue'
/** Services required to admit operation work. */
export const inject = ['tools', 'taskQueue']

/** Reserved admission-tool configuration. */
export interface Config {}
/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({})

/** Dependencies used by the pure operation admission-tool factory. */
export interface OperationRunTaskQueueDeps { readonly taskQueue: TaskQueue }
/** Operation admission tools returned for registration. */
export interface OperationRunTaskQueueKit { readonly tools: readonly ReturnType<typeof defineTool>[] }

function queueFor(
  taskQueue: TaskQueue,
  exec: { readonly agent?: { readonly session: Parameters<typeof createVerifiedAgentAuthority>[0] } },
): AgentWorkQueue {
  if (exec.agent === undefined) throw new Error('operation Queue admission requires a live Agent session')
  return taskQueue.forAgent(createVerifiedAgentAuthority(exec.agent.session))
}

/** Close the otherwise-open parameter object before ToolRuntime dispatches a Queue admission. */
function closeParameters(tool: ReturnType<typeof defineTool>): ReturnType<typeof defineTool> {
  const parameters: JsonSchemaNode = {
    ...(tool.parameters as unknown as JsonSchemaNode),
    additionalProperties: false,
  }
  return {
    ...tool,
    parameters: parameters as unknown as Record<string, unknown>,
    async execute(args, exec) {
      const violations = validateJsonSchemaValue(parameters, args, '')
      if (violations.length > 0) throw new ToolArgsError(violations)
      return tool.execute(args, exec)
    },
  }
}

/**
 * Build the WorkKind-specific operation admission tools.
 * @param deps Queue service dependency.
 * @returns the two `operation.run@1` admission tools.
 */
export function createOperationRunTaskQueue(deps: OperationRunTaskQueueDeps): OperationRunTaskQueueKit {
  return { tools: [
    closeParameters(defineTool({
      name: 'operation_run_enqueue',
      description: 'Durably enqueue one host-configured operation by its operation id.',
      parameters: {
        title: { type: 'string', required: true, description: 'Title for this WorkItem.' },
        operationId: { type: 'string', required: true, description: 'Host-configured operation id.' },
        idempotencyKey: { type: 'string', required: true, description: 'Stable dedupe key for this logical operation.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `enqueued operation ${value.id}` }],
      },
      async execute(args, exec) {
        const id = await queueFor(deps.taskQueue, exec).enqueue({
          kind: 'operation.run@1', title: args.title, input: { operationId: args.operationId }, idempotencyKey: args.idempotencyKey,
        })
        return { id }
      },
      presentCall: () => ({ card: 'generic', title: 'Enqueue operation', kind: 'execute' }),
    })),
    closeParameters(defineTool({
      name: 'operation_run_enqueue_batch',
      description: 'Atomically enqueue individually titled host-configured operations.',
      parameters: {
        items: {
          type: 'array', required: true,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              title: { type: 'string', required: true, description: 'Title for this WorkItem.' },
              operationId: { type: 'string', required: true, description: 'Host-configured operation id.' },
            },
          },
        },
        idempotencyKey: { type: 'string', required: true, description: 'Stable dedupe key for this logical operation batch.' },
        maxParallel: { type: 'integer', required: true, description: 'Positive batch concurrency bound.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `enqueued operation batch ${value.id}` }],
      },
      async execute(args, exec) {
        if (!Number.isSafeInteger(args.maxParallel) || args.maxParallel < 1) {
          throw new Error('operation Queue Batch maxParallel must be a positive safe integer')
        }
        const id = await queueFor(deps.taskQueue, exec).enqueueBatch({
          kind: 'operation.run@1',
          items: args.items.map(item => ({ title: item.title, input: { operationId: item.operationId } })),
          sharedPayload: {},
          idempotencyKey: args.idempotencyKey,
          maxParallel: args.maxParallel,
        })
        return { id }
      },
      presentCall: () => ({ card: 'generic', title: 'Enqueue operation batch', kind: 'execute' }),
    })),
  ] }
}

/** Register the operation Queue admission tools. */
export function apply(ctx: Context, config: Config): () => void {
  void config
  const disposers = createOperationRunTaskQueue({ taskQueue: ctx.taskQueue }).tools
    .map(tool => ctx.tools.register(tool))
  return () => { for (const dispose of disposers) dispose() }
}

/** Agent-facing admission tools for the explicit Queue v2 image WorkKind. */
import type { Context } from '@deepseek-ai/cordis'
import { createVerifiedAgentAuthority } from '@deepseek-ai/dsh-task-queue'
import type { AgentWorkQueue, TaskQueue } from '@deepseek-ai/dsh-task-queue'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-image-generation-task-queue'

/** Cordis loader name. */
export const name = 'tool-image-generation-task-queue'
/** Services required to admit image work. */
export const inject = ['tools', 'taskQueue']

/** Dependencies used by the pure image admission-tool factory. */
export interface ImageGenerationTaskQueueDeps { readonly taskQueue: TaskQueue }
/** Image admission tools returned for registration. */
export interface ImageGenerationTaskQueueKit { readonly tools: readonly ReturnType<typeof defineTool>[] }

function queueFor(
  taskQueue: TaskQueue,
  exec: { readonly agent?: { readonly session?: Parameters<typeof createVerifiedAgentAuthority>[0] } },
): AgentWorkQueue {
  const session = exec.agent?.session
  if (session === undefined) throw new Error('image Queue admission requires an agent session')
  return taskQueue.forAgent(createVerifiedAgentAuthority(session))
}

const imageFields = {
  prompt: { type: 'string' as const, required: true, description: 'Complete visual prompt.' },
  size: { type: 'string' as const, required: true, description: 'Requested provider-supported size, for example 1920x1920.' },
  outputFormat: { type: 'string' as const, required: true, enum: ['png', 'jpeg'] as const, description: 'Image container.' },
  watermark: { type: 'boolean' as const, required: true, description: 'Whether the output contains a watermark.' },
  provider: { type: 'string' as const, description: 'Explicit provider id. Omit only when exactly one image provider is configured.' },
  model: { type: 'string' as const, description: 'Optional provider model selector.' },
} as const

function imageInput(args: {
  readonly prompt: string
  readonly size: string
  readonly outputFormat: 'png' | 'jpeg'
  readonly watermark: boolean
  readonly provider?: string
  readonly model?: string
}) {
  return {
    prompt: args.prompt,
    size: args.size,
    outputFormat: args.outputFormat,
    watermark: args.watermark,
    ...(args.provider === undefined ? {} : { provider: args.provider }),
    ...(args.model === undefined ? {} : { model: args.model }),
  }
}

/**
 * Build single and Batch image-generation admission tools.
 * @param deps Queue service dependency.
 * @returns the two `image.generate@1` admission tools.
 */
export function createImageGenerationTaskQueue(deps: ImageGenerationTaskQueueDeps): ImageGenerationTaskQueueKit {
  return { tools: [
    defineTool({
      name: 'image_generate_enqueue',
      description: 'Durably enqueue one image-generation request. Supply the finished visual prompt and requested output settings; the host resolves the ArkCLI Agent Plan model before generation begins.',
      parameters: {
        ...imageFields,
        idempotencyKey: { type: 'string', required: true, description: 'Stable dedupe key for this logical image request.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `enqueued image task ${value.id}` }],
      },
      async execute(args, exec) {
        const id = await queueFor(deps.taskQueue, exec).enqueue({
          kind: 'image.generate@1',
          title: 'Image generation',
          input: imageInput(args),
          idempotencyKey: args.idempotencyKey,
        })
        return { id }
      },
      presentCall: () => ({ card: 'generic', title: 'Enqueue image generation', kind: 'execute' }),
    }),
    defineTool({
      name: 'image_generate_enqueue_batch',
      description: 'Atomically enqueue individually titled image-generation requests from completed prompts.',
      parameters: {
        items: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string', required: true, description: 'Title for this WorkItem.' },
              ...imageFields,
            },
          },
        },
        idempotencyKey: { type: 'string', required: true, description: 'Stable dedupe key for this logical image Batch.' },
        maxParallel: { type: 'integer', required: true, description: 'Positive Batch concurrency bound.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `enqueued image batch ${value.id}` }],
      },
      async execute(args, exec) {
        if (args.maxParallel < 1) throw new Error('image Queue Batch maxParallel must be positive')
        const id = await queueFor(deps.taskQueue, exec).enqueueBatch({
          kind: 'image.generate@1',
          items: args.items.map(item => ({ title: item.title, input: imageInput(item) })),
          sharedPayload: {},
          idempotencyKey: args.idempotencyKey,
          maxParallel: args.maxParallel,
        })
        return { id }
      },
      presentCall: () => ({ card: 'generic', title: 'Enqueue image generation batch', kind: 'execute' }),
    }),
  ] }
}

/** Register the model-facing image admission tools. */
export function apply(ctx: Context): () => void {
  const disposers = createImageGenerationTaskQueue({ taskQueue: ctx.taskQueue }).tools
    .map(tool => ctx.tools.register(tool))
  return () => { for (const dispose of disposers) dispose() }
}

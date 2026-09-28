import { createUserMessage } from '@deepseek-ai/dsh-llm'

// Real Loader fixture: each configured preset contributes native ToolRuntime
// entries to its standing scope. Tests never replace the registry itself.
export const name = 'mcp-server-capability-fixture'
export const inject = ['tools']

export function apply(ctx, config) {
  if (config.ptc === true) ctx.tools.presentAs('ptc')
  ctx.effect(() => ctx.tools.register({
    name: config.name,
    description: config.description,
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async ({ text }, exec) => {
      if (config.additionalContext === true) {
        exec.deferContext(createUserMessage({ content: [{ type: 'text', text: 'fixture context' }], source: { kind: 'plugin', plugin: name } }))
      }
      if (config.concludesTurn === true) exec.concludeTurn()
      return config.size === undefined ? `${config.name}:${text}` : 'x'.repeat(config.size)
    },
  }))
  if (config.ask === true) {
    ctx.on('tools/pre-execute', async () => ({ kind: 'ask', reason: 'fixture approval required' }))
  }
}

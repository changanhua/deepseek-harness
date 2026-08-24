import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
// Import ToolRuntime from the source plane so the gate is exercised directly,
// not through built lib/ (the repo's test resolution facade points bare
// workspace imports at src, but a relative import pins it unambiguously).
import ToolRuntime, { defineTool } from '../src/index.ts'

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

const echoTool = defineTool({
  name: 'echo',
  description: 'echo arguments back',
  parameters: { text: { type: 'string' } },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args) {
    return args.text ?? ''
  },
})

describe('ToolRuntime register gate — object-rooted parameters (function-calling wire contract)', () => {
  // The adapter passes `parameters` verbatim to the provider wire, where an
  // object root is required (a bare `oneOf` root or an empty `{}` is rejected
  // by strict OpenAI-compatible gateways). `defineTool` already compiles to an
  // object root; this gate asserts the raw-registration path.

  it('rejects a bare `oneOf` root (the runtime_inspect regression)', async () => {
    const ctx = await setup()
    expect(() => ctx.tools.register({
      ...echoTool,
      name: 'oneof-root',
      parameters: {
        oneOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'number' } } },
        ],
      },
    })).toThrow(/parameters must be an object-rooted JSON Schema/)
    // A rejected registration must not leak into the registry.
    expect(ctx.tools.get('oneof-root')).toBeUndefined()
    expect(ctx.tools.schemas().map(t => t.name)).not.toContain('oneof-root')
  })

  it('rejects an empty `parameters: {}` (no explicit object root)', async () => {
    const ctx = await setup()
    expect(() => ctx.tools.register({
      ...echoTool,
      name: 'empty-parameters',
      parameters: {},
    })).toThrow(/parameters must be an object-rooted JSON Schema \(model-facing function calling requires type: "object"\)/)
    expect(ctx.tools.get('empty-parameters')).toBeUndefined()
  })

  it('accepts a raw registration with an explicit object-rooted parameters schema', async () => {
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'object-root-ok',
      parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
    })
    const schema = ctx.tools.schemas().find(t => t.name === 'object-root-ok')
    expect(schema?.parameters).toEqual({ type: 'object', properties: { x: { type: 'string' } }, required: ['x'] })
  })

  it('accepts a `defineTool` fixture (compiled to an object root) unchanged', async () => {
    const ctx = await setup()
    ctx.tools.register(echoTool)
    const schema = ctx.tools.schemas().find(t => t.name === 'echo')
    expect(schema?.parameters).toEqual({ type: 'object', properties: { text: { type: 'string' } } })
  })
})

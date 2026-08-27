import { describe, expect, it } from 'vitest'
import type { Config, OperationDefinition } from '../src/types.ts'

const definition: OperationDefinition = {
  revision: 'fixture.echo/v1',
  description: 'Emit the fixed acceptance marker.',
  argv: ['node', 'emit-operation.mjs'],
  cwd: 'C:/fixtures',
  resource: 'operation-run',
  units: 1,
  maxAttempts: 1,
  collectBytes: 4096,
  resultBytes: 1024,
  failureTailBytes: 512,
  graceMs: 1000,
  timeoutMs: 10_000,
}

async function createHandler(config: unknown): Promise<unknown> {
  const module = await import('../src/index.ts') as unknown as {
    createOperationRunHandler?: (config: Config, subprocess: { spawn(): never }) => unknown
  }
  if (module.createOperationRunHandler === undefined) throw new Error('operation handler factory is missing')
  return module.createOperationRunHandler(config as Config, { spawn() { throw new Error('not started') } })
}

async function resolveAdmission(input: unknown): Promise<unknown> {
  const handler = await createHandler({ operations: { 'fixture.echo': definition } }) as {
    resolveAdmission(input: unknown, context: { signal: AbortSignal }): Promise<unknown>
  }
  return handler.resolveAdmission(input, { signal: new AbortController().signal })
}

describe('operation.run@1 configuration', () => {
  it('accepts one complete allowlisted operation', async () => {
    await expect(createHandler({ operations: { 'fixture.echo': definition } })).resolves.toBeDefined()
  })

  it.each([
    ['blank operation id', { operations: { '': definition } }],
    ['operation id with leading whitespace', { operations: { ' fixture.echo': definition } }],
    ['operation id with trailing whitespace', { operations: { 'fixture.echo ': definition } }],
    ['blank revision', { operations: { echo: { ...definition, revision: ' ' } } }],
    ['blank description', { operations: { echo: { ...definition, description: '' } } }],
    ['empty argv', { operations: { echo: { ...definition, argv: [] } } }],
    ['blank argv item', { operations: { echo: { ...definition, argv: ['node', ''] } } }],
    ['blank cwd', { operations: { echo: { ...definition, cwd: '' } } }],
    ['blank resource', { operations: { echo: { ...definition, resource: '' } } }],
    ['zero maxAttempts', { operations: { echo: { ...definition, maxAttempts: 0 } } }],
    ['zero collectBytes', { operations: { echo: { ...definition, collectBytes: 0 } } }],
    ['negative graceMs', { operations: { echo: { ...definition, graceMs: -1 } } }],
    ['zero timeoutMs', { operations: { echo: { ...definition, timeoutMs: 0 } } }],
    ['resultBytes over collectBytes', { operations: { echo: { ...definition, resultBytes: 4097 } } }],
    ['failureTailBytes over collectBytes', { operations: { echo: { ...definition, failureTailBytes: 4097 } } }],
    ['environment field', { operations: { echo: { ...definition, env: { TOKEN: 'secret' } } } }],
    ['credential-shaped field', { operations: { echo: { ...definition, apiKey: 'secret' } } }],
  ])('rejects %s', async (_name, config) => {
    await expect(createHandler(config)).rejects.toThrow(/operation\.run configuration/)
  })

  it.each([
    ['units', 'units'],
    ['maxAttempts', 'maxAttempts'],
    ['collectBytes', 'collectBytes'],
    ['resultBytes', 'resultBytes'],
    ['failureTailBytes', 'failureTailBytes'],
    ['graceMs', 'graceMs'],
    ['timeoutMs', 'timeoutMs'],
  ] as const)('rejects non-safe-integer %s values', async (_name, field) => {
    for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(createHandler({ operations: { echo: {
        ...definition, [field]: value,
      } } })).rejects.toThrow(/operation\.run configuration/)
    }
  })

  it.each([
    ['split api-key flag', ['node', 'task.mjs', '--api-key', 'secret']],
    ['inline token flag', ['node', 'task.mjs', '--token=secret']],
    ['split password flag', ['node', 'task.mjs', '--password', 'secret']],
    ['split secret flag', ['node', 'task.mjs', '--secret', 'secret']],
    ['split credential flag', ['node', 'task.mjs', '--credential', 'secret']],
    ['split authorization flag', ['node', 'task.mjs', '--authorization', 'Bearer secret']],
    ['bearer authorization header', ['curl', '--header', 'Authorization: Bearer secret']],
    ['sensitive environment assignment', ['API_TOKEN=secret', 'node', 'task.mjs']],
    ['URL userinfo', ['curl', 'https://user:password@example.test/path']],
    ['common API key literal', ['node', 'task.mjs', 'sk-live-not-a-real-key']],
    ['curl short user flag with separate value', ['curl', '-u', 'alice:password', 'https://example.test']],
    ['curl short user flag with inline value', ['curl', '-ualice:password', 'https://example.test']],
    ['curl user flag', ['curl', '--user', 'alice:password', 'https://example.test']],
    ['wget proxy user flag', ['wget', '--proxy-user=alice', 'https://example.test']],
    ['curl password flag', ['curl', '--password=secret', 'https://example.test']],
    ['curl HTTP user flag', ['curl', '--http-user=alice', 'https://example.test']],
    ['curl HTTP password flag', ['curl', '--http-password=secret', 'https://example.test']],
    ['curl proxy password flag', ['curl', '--proxy-password=secret', 'https://example.test']],
    ['curl OAuth bearer flag', ['curl', '--oauth2-bearer', 'secret', 'https://example.test']],
    ['npm auth token flag', ['npm', '--_authToken=secret', 'whoami']],
    ['npm scoped auth token key', ['npm', 'config', 'set', '//registry.npmjs.org/:_authToken', 'secret']],
  ])('rejects credential-shaped argv: %s', async (_name, argv) => {
    await expect(createHandler({ operations: { echo: { ...definition, argv } } })).rejects.toThrow(/operation\.run configuration/)
  })

  it('does not reject ordinary arguments that merely contain key-like substrings', async () => {
    await expect(createHandler({ operations: { echo: {
      ...definition, argv: ['node', 'monkey-tokenizer.mjs', '--monkey=banana'],
    } } })).resolves.toBeDefined()
  })

  it('does not mistake --user-agent for a credential carrier', async () => {
    await expect(createHandler({ operations: { echo: { ...definition, argv: ['curl', '--user-agent=operation-run', 'https://example.test'] } } })).resolves.toBeDefined()
  })
})

describe('operation.run@1 admission', () => {
  it.each([
    ['env', { operationId: 'fixture.echo', env: { TOKEN: 'secret' } }],
    ['argv', { operationId: 'fixture.echo', argv: ['node', 'unexpected.mjs'] }],
    ['credential', { operationId: 'fixture.echo', credential: 'secret' }],
    ['generic JSON', { operationId: 'fixture.echo', metadata: { arbitrary: ['json'] } }],
  ])('rejects widened intent containing %s', async (_name, input) => {
    await expect(resolveAdmission(input)).rejects.toThrow(/operation\.run admission/)
  })
})

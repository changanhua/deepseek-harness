import type {
  Config,
  OperationDefinition,
  OperationRunIntent,
  OperationRunOutput,
  PreparedOperationRun,
  ResolvedOperationRun,
} from '../src/index.ts'

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
const config: Config = { operations: { 'fixture.echo': definition } }
const intent: OperationRunIntent = { operationId: 'fixture.echo' }
const resolved: ResolvedOperationRun = { operationId: intent.operationId, ...definition }
const prepared: PreparedOperationRun = resolved
const output: OperationRunOutput = {
  operationId: resolved.operationId,
  revision: resolved.revision,
  summary: 'operation completed',
  stdout: { text: 'OPERATION-RUN-V1-OK', truncated: false },
}

// @ts-expect-error callers cannot choose argv
const argvIntent: OperationRunIntent = { operationId: 'fixture.echo', argv: ['node'] }
// @ts-expect-error callers cannot choose cwd
const cwdIntent: OperationRunIntent = { operationId: 'fixture.echo', cwd: 'C:/' }
// @ts-expect-error callers cannot choose env
const envIntent: OperationRunIntent = { operationId: 'fixture.echo', env: { TOKEN: 'secret' } }
// @ts-expect-error callers cannot choose a shell
const shellIntent: OperationRunIntent = { operationId: 'fixture.echo', shell: true }
// @ts-expect-error callers cannot choose a profile
const profileIntent: OperationRunIntent = { operationId: 'fixture.echo', profile: 'worker' }
// @ts-expect-error callers cannot choose a model
const modelIntent: OperationRunIntent = { operationId: 'fixture.echo', model: 'provider-model' }
// @ts-expect-error callers cannot supply credentials
const credentialIntent: OperationRunIntent = { operationId: 'fixture.echo', credential: 'secret' }
// @ts-expect-error operation definitions never accept an environment map
const envDefinition: OperationDefinition = { ...definition, env: { TOKEN: 'secret' } }

void [config, prepared, output, argvIntent, cwdIntent, envIntent, shellIntent, profileIntent, modelIntent, credentialIntent, envDefinition]

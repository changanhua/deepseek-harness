import {
  AttemptId,
  type AdmissionContext, type LiveAttempt, type PrepareContext, type StartContext,
  type TaskQueue, type VerifiedAgentAuthority, type VerifiedOperatorAuthority,
  type WorkHandler, type WorkKindDefinition,
} from '@changanhua/dsh-task-queue'

declare module '@changanhua/dsh-task-queue' {
  interface WorkKindMap {
    'typecheck@1': WorkKindDefinition<
      { readonly input: string },
      { readonly resolved: string },
      { readonly prepared: string },
      { readonly output: string }
    >
  }
}

declare const live: LiveAttempt<'typecheck@1'>
declare const queue: TaskQueue
declare const agentAuthority: VerifiedAgentAuthority
declare const operatorAuthority: VerifiedOperatorAuthority

const handler: WorkHandler<'typecheck@1'> = {
  kind: 'typecheck@1',
  async resolveAdmission(input, _context: AdmissionContext) { return { resolved: input.input } },
  resources() { return [{ resource: 'test', units: 1 }] },
  policy() { return { maxAttempts: 1 } },
  async prepare(resolved, _context: PrepareContext) { return { prepared: resolved.resolved } },
  start(_prepared, _context: StartContext) { return live },
}

const synchronousLiveAttempt: LiveAttempt<'typecheck@1'> = handler.start(
  { prepared: 'ready' },
  { attemptId: AttemptId('attempt-1'), signal: new AbortController().signal },
)
const immediateRegistration = queue.registerHandler(handler)
const stagedRegistration = queue.registerHandler(handler, {
  activation: 'staged',
})
stagedRegistration.activate()
stagedRegistration()
immediateRegistration()
queue.forAgent(agentAuthority)
const operator = queue.forOperator(operatorAuthority)
void operator.enqueue({
  kind: 'typecheck@1',
  title: 'ownerless work',
  input: { input: 'ready' },
  idempotencyKey: 'operator-single',
})
void operator.enqueueBatch({
  kind: 'typecheck@1',
  items: [{ title: 'ownerless batch member', input: { input: 'ready' } }],
  sharedPayload: {},
  idempotencyKey: 'operator-batch',
  maxParallel: 1,
})

// @ts-expect-error a raw session id is not verified authority
queue.forAgent('session-1')
// @ts-expect-error agent authority cannot obtain operator capability
queue.forOperator(agentAuthority)
// @ts-expect-error no naked-string facade factory remains
void queue.agent
// @ts-expect-error no publicly retrievable operator facade remains
void queue.operator

void synchronousLiveAttempt

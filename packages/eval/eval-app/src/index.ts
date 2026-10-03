/**
 * One-shot, profile-owned CLI consumer for safe Eval run operations.
 * @module @changanhua/dsh-eval-app
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { EvalRunError } from '@changanhua/dsh-eval-runs'
import type { EvalRunAccess, EvalRunView } from '@changanhua/dsh-eval-runs'
import { EvalGateError } from '@changanhua/dsh-eval-gates'
import { EvalActivationError } from '@changanhua/dsh-eval-activation'
import type { ActivationRequestFactory, ContinuationPolicy, EvalActivationAccess } from '@changanhua/dsh-eval-activation'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { z } from 'zod'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@changanhua/dsh-eval-runs'
import type {} from '@changanhua/dsh-eval-gates'
import type {} from '@changanhua/dsh-eval-activation'

/** Stable plugin name used by an Eval CLI Profile. */
export const name = 'eval-app'
/** The app starts only after its safe run owner and trusted Workspace registry mount. */
export const inject = ['cmdlineArgs', 'evalRuns', 'workspaceRegistry']

/** Trusted Profile binding; command-line callers cannot replace these facts. */
export interface Config {
  /** Profile identity rendered in command help. */
  readonly profile: string
  /** Registered Workspace identity this Profile is permitted to operate. */
  readonly workspaceId: string
  /** Auditable operator identity retained with every control. */
  readonly actorId: string
  /** Execution policies the Profile may select by id. */
  readonly policyIds: string[]
  /** Gate policies the Profile may ask the trusted Gate owner to evaluate. */
  readonly gatePolicyIds: string[]
  /** Optional explicit continuation Grants installed by trusted Host composition. */
  readonly continuationPolicies?: {
    /** Policy selector accepted by the continue command. */
    readonly id: string
    /** Fixed Session, Goal, Budget, expiry and message; none are command-line input. */
    readonly policy: ContinuationPolicy
  }[]
  /** Host capability deriving current Queue/Gate facts; required only for continuation. */
  readonly activationRequests?: ActivationRequestFactory
  /** Upper bound for one JSON result, including its envelope. */
  readonly maxOutputBytes: number
  /** Maximum bounded observation interval for `start --wait`. */
  readonly waitMs: number
}

const configSchema = z.object({
  profile: z.string().trim().min(1).max(128),
  workspaceId: z.string().trim().min(1).max(256),
  actorId: z.string().trim().min(1).max(256),
  policyIds: z.array(z.string().trim().min(1).max(256)).min(1).max(64),
  gatePolicyIds: z.array(z.string().trim().min(1).max(256)).min(1).max(64),
  continuationPolicies: z.array(z.object({
    id: z.string().trim().min(1).max(256), policy: z.custom<ContinuationPolicy>(),
  }).strict()).max(64).optional(),
  activationRequests: z.custom<ActivationRequestFactory>(value => typeof value === 'function').optional(),
  maxOutputBytes: z.number().int().min(512).max(1024 * 1024),
  waitMs: z.number().int().min(100).max(10 * 60 * 1000),
}).strict()

/** Schema for trusted, Profile-composed application configuration. */
export const Config: Schema<Config> = Schema.object({
  profile: Schema.string().required(), workspaceId: Schema.string().required(), actorId: Schema.string().required(),
  policyIds: Schema.array(Schema.string().required()).required(), gatePolicyIds: Schema.array(Schema.string().required()).required(),
  continuationPolicies: Schema.array(Schema.object({ id: Schema.string().required(), policy: Schema.any().required() })),
  activationRequests: Schema.any(),
  maxOutputBytes: Schema.number().step(1).min(512).required(),
  waitMs: Schema.number().step(1).min(100).required(),
})

const identity = z.string().trim().min(1).max(256)
const revision = z.string().regex(/^[a-f0-9]{64}$/u)
const cell = z.string().regex(/^[a-f0-9]{64}$/u)
const evidence = z.string().trim().min(1).max(4096)
const startOptions = z.object({
  request: identity, plan: identity, version: identity, policy: identity, wait: z.boolean().optional(),
}).strict()
const controlOptions = z.object({
  operation: identity, revision, resolution: z.enum(['confirm-failed', 'authorize-retry']).optional(), evidence: evidence.optional(),
}).strict()

type Invocation =
  | { readonly kind: 'start'; readonly requestId: string; readonly plan: { readonly id: string; readonly version: string }; readonly policyId: string; readonly wait: boolean }
  | { readonly kind: 'show'; readonly runId: string }
  | { readonly kind: 'list' }
  | { readonly kind: 'cancel'; readonly runId: string; readonly operationId: string; readonly expectedRevision: string }
  | { readonly kind: 'retry'; readonly runId: string; readonly cellId: string; readonly operationId: string; readonly expectedRevision: string }
  | { readonly kind: 'resolve-unknown'; readonly runId: string; readonly cellId: string; readonly operationId: string; readonly expectedRevision: string; readonly resolution: 'confirm-failed' | 'authorize-retry'; readonly evidence: string }
  | { readonly kind: 'evidence'; readonly runId: string; readonly cellId: string; readonly attemptId: string }
  | { readonly kind: 'gate-evaluate'; readonly runId: string; readonly policyId: string }
  | { readonly kind: 'gate-show'; readonly gateId: string }
  | { readonly kind: 'continue'; readonly gateId: string; readonly grantId: string; readonly operationId: string }
  | { readonly kind: 'activation-show'; readonly activationId: string }

interface EvalAppInternals {
  stdout: { write(text: string): unknown }
  stderr: { write(text: string): unknown }
  now(): number
  sleep(ms: number): Promise<void>
}

/** Process streams are replaceable by focused tests. */
export const internals: EvalAppInternals = {
  stdout: process.stdout,
  stderr: process.stderr,
  now: () => Date.now(),
  sleep: ms => new Promise<void>((resolve) => { setTimeout(resolve, ms) }),
}

/** Build a fresh, profile-labelled command grammar. */
function command(profile: string, accept: (input: Invocation, program: Command) => void): Command {
  const program = new Command()
    .name(`dsh --profile ${profile}`)
    .description('Submit, inspect, and explicitly control a trusted Eval run.')
    .helpOption('-h, --help', 'show this help')
    .addHelpText('after', `
Examples:
  dsh --profile ${profile} start --request nightly-17 --plan regression --version 1 --policy approved --wait
  dsh --profile ${profile} show run-123
  dsh --profile ${profile} gate evaluate run-123 --policy release
  dsh --profile ${profile} continue gate-123 --grant approved-followup --request review-17
  dsh --profile ${profile} resolve-unknown run-123 <cell-id> --operation review-1 --revision <view-revision> --resolution authorize-retry --evidence "approved after review"

Run outcomes are operational observations. A passed outcome is not a Gate decision.
`)
  const parse = (schema: typeof identity, value: unknown, owner: Command): string => {
    const result = schema.safeParse(value)
    if (result.success) return result.data
    owner.error('error: invalid Eval command input')
    throw new Error('Commander must throw after program.error')
  }
  program.command('start')
    .description('admit or recover one request and enqueue its approved cells')
    .requiredOption('--request <requestId>', 'stable request identity')
    .requiredOption('--plan <planId>', 'approved Plan id')
    .requiredOption('--version <version>', 'approved Plan version')
    .requiredOption('--policy <policyId>', 'Profile-approved execution policy')
    .option('--wait', 'observe the run until it settles or the Profile wait limit expires')
    .action((options: unknown, owner: Command) => {
      const parsed = startOptions.safeParse(options)
      if (!parsed.success) {
        owner.error('error: invalid Eval command input')
        return
      }
      const value = parsed.data
      accept({ kind: 'start', requestId: value.request, plan: { id: value.plan, version: value.version }, policyId: value.policy, wait: value.wait === true }, owner)
    })
  program.command('show <runId>').description('read one safe run view').action((...args: unknown[]) => {
    const owner = args.at(-1) as Command
    accept({ kind: 'show', runId: parse(identity, args[0], owner) }, owner)
  })
  program.command('list').description('list safe run views in this Profile Workspace').action((...args: unknown[]) => {
    accept({ kind: 'list' }, args.at(-1) as Command)
  })
  const controlled = (command: Command, action: 'cancel' | 'retry' | 'resolve-unknown'): void => {
    command.requiredOption('--operation <operationId>', 'stable control operation identity').requiredOption('--revision <revision>', 'run view revision')
    if (action === 'resolve-unknown') command.requiredOption('--resolution <resolution>', 'confirm-failed or authorize-retry')
      .requiredOption('--evidence <text>', 'operator evidence for this authorization')
    command.action((...args: unknown[]) => {
      const owner = args.at(-1) as Command
      const options = args.at(-2)
      const positional = args.slice(0, -2)
      const parsed = controlOptions.safeParse(options)
      if (!parsed.success) {
        owner.error('error: invalid Eval command input')
        return
      }
      const common = parsed.data
      const runId = parse(identity, positional[0], owner)
      if (action === 'cancel') {
        accept({ kind: 'cancel', runId, operationId: common.operation, expectedRevision: common.revision }, owner)
        return
      }
      const cellId = parse(cell, positional[1], owner)
      if (action === 'retry') {
        accept({ kind: 'retry', runId, cellId, operationId: common.operation, expectedRevision: common.revision }, owner)
        return
      }
      if (!common.resolution || !common.evidence) {
        owner.error('error: invalid Eval command input')
        throw new Error('Commander must throw after program.error')
      }
      accept({ kind: 'resolve-unknown', runId, cellId, operationId: common.operation, expectedRevision: common.revision,
        resolution: common.resolution, evidence: common.evidence }, owner)
    })
  }
  controlled(program.command('cancel <runId>').description('request cancellation with an exact observed revision'), 'cancel')
  controlled(program.command('retry <runId> <cellId>').description('explicitly authorize one failed cell retry'), 'retry')
  controlled(program.command('resolve-unknown <runId> <cellId>').description('resolve one unknown Attempt after review'), 'resolve-unknown')
  program.command('evidence <runId> <cellId> <attemptId>').description('read safe retained Attempt evidence').action((...args: unknown[]) => {
    const owner = args.at(-1) as Command
    accept({ kind: 'evidence', runId: parse(identity, args[0], owner), cellId: parse(cell, args[1], owner), attemptId: parse(identity, args[2], owner) }, owner)
  })
  const gate = program.command('gate').description('evaluate or read an independent retained Gate decision')
  gate.command('evaluate <runId>').description('evaluate one Profile-approved Gate policy from a frozen run').requiredOption('--policy <policyId>', 'Profile-approved Gate policy')
    .action((...args: unknown[]) => {
      const owner = args.at(-1) as Command, options = args.at(-2)
      const parsed = z.object({ policy: identity }).strict().safeParse(options)
      if (!parsed.success) {
        owner.error('error: invalid Eval command input')
        return
      }
      accept({ kind: 'gate-evaluate', runId: parse(identity, args[0], owner), policyId: parsed.data.policy }, owner)
    })
  gate.command('show <gateId>').description('read one retained independent Gate decision').action((...args: unknown[]) => {
    const owner = args.at(-1) as Command
    accept({ kind: 'gate-show', gateId: parse(identity, args[0], owner) }, owner)
  })
  program.command('continue <gateId>').requiredOption('--grant <grantId>').requiredOption('--request <operationId>').action((...args: unknown[]) => {
    const owner = args.at(-1) as Command, parsed = z.object({ grant: identity, request: identity }).strict().safeParse(args.at(-2))
    if (!parsed.success) { owner.error('error: invalid Eval command input'); return }
    accept({ kind: 'continue', gateId: parse(identity, args[0], owner), grantId: parsed.data.grant, operationId: parsed.data.request }, owner)
  })
  const activation = program.command('activation')
  activation.command('show <activationId>').action((...args: unknown[]) => {
    const owner = args.at(-1) as Command
    accept({ kind: 'activation-show', activationId: parse(identity, args[0], owner) }, owner)
  })
  return program
}

function terminal(view: EvalRunView): boolean { return ['settled', 'canceled', 'needs-attention'].includes(view.phase) }

/** Run a parsed invocation only after the Profile's full plugin tree is ready. */
async function execute(ctx: Context, config: Config, input: Invocation): Promise<unknown> {
  const workspace = ctx.workspaceRegistry.get(WorkspaceId(config.workspaceId))
  if (!workspace) throw new EvalRunError('unauthorized')
  const access: EvalRunAccess = { workspace, entrypoint: 'cli', actorId: config.actorId,
    authorize: () => {
      if (ctx.workspaceRegistry.get(workspace.id) !== workspace) throw new EvalRunError('unauthorized')
    } }
  const allowed = new Set(config.policyIds)
  const allowedGates = new Set(config.gatePolicyIds)
  const activationAccess: EvalActivationAccess = { actorId: config.actorId, workspaceId: config.workspaceId, authorize: access.authorize }
  switch (input.kind) {
    case 'start': {
      if (!allowed.has(input.policyId)) throw new EvalRunError('unauthorized')
      let run = await ctx.evalRuns.start(access, { requestId: input.requestId, plan: input.plan, policyId: input.policyId })
      if (input.wait) {
        const deadline = internals.now() + config.waitMs
        while (!terminal(run) && internals.now() < deadline) {
          await internals.sleep(Math.min(250, Math.max(1, deadline - internals.now())))
          if (run.id) run = await ctx.evalRuns.get(access, run.id)
        }
      }
      return run
    }
    case 'show': return await ctx.evalRuns.get(access, input.runId)
    case 'list': return await ctx.evalRuns.list(access)
    case 'cancel': return await ctx.evalRuns.control(access, { runId: input.runId, operationId: input.operationId, expectedRevision: input.expectedRevision, action: 'cancel' })
    case 'retry': return await ctx.evalRuns.control(access, { runId: input.runId, operationId: input.operationId, expectedRevision: input.expectedRevision, action: 'retry', cellId: input.cellId })
    case 'resolve-unknown': return await ctx.evalRuns.control(access, { runId: input.runId, operationId: input.operationId, expectedRevision: input.expectedRevision,
      action: 'resolve-unknown', cellId: input.cellId, resolution: input.resolution, evidence: input.evidence })
    case 'evidence': return await ctx.evalRuns.evidence(access, input.runId, input.cellId, input.attemptId)
    case 'gate-evaluate': {
      if (!allowedGates.has(input.policyId)) throw new EvalGateError('unauthorized')
      const gates = ctx.get('evalGates')
      if (!gates) throw new EvalGateError('unavailable')
      return await gates.evaluate(access, input.runId, input.policyId)
    }
    case 'gate-show': {
      const gates = ctx.get('evalGates')
      if (!gates) throw new EvalGateError('unavailable')
      return await gates.get(access, input.gateId)
    }
    case 'continue': {
      const selected = config.continuationPolicies?.find(item => item.id === input.grantId)
      if (!selected || selected.policy.expiresAt <= internals.now()) throw new EvalActivationError('expired')
      const activation = ctx.get('evalActivation')
      if (!activation || !config.activationRequests) throw new EvalActivationError('unavailable')
      const request = await config.activationRequests(activationAccess, selected.policy, input.gateId, input.operationId)
      return await activation.activate(activationAccess, request)
    }
    case 'activation-show': {
      const activation = ctx.get('evalActivation')
      if (!activation) throw new EvalActivationError('unavailable')
      return await activation.get(activationAccess, input.activationId)
    }
  }
}

function writeResult(value: unknown, maxBytes: number): void {
  const text = JSON.stringify({ kind: 'success', result: value })
  if (Buffer.byteLength(text) > maxBytes) throw new EvalRunError('capacity')
  internals.stdout.write(`${text}\n`)
}

/** Parse the Profile invocation and perform one bounded, safe Eval operation. */
export function apply(ctx: Context, supplied: Config): void {
  const { continuationPolicies, activationRequests, ...base } = configSchema.parse(supplied)
  const config: Config = { ...base, ...(continuationPolicies ? { continuationPolicies } : {}),
    ...(activationRequests ? { activationRequests } : {}) }
  const exit = ctx.get('appExit'), ready = ctx.get('appReady')
  if (!exit || !ready) throw new Error('eval-app: the launcher must provide ctx.appReady and ctx.appExit before the tree mounts')
  let invocation: Invocation | undefined
  const program = command(config.profile, (input) => { invocation = input })
  parseCmdline(ctx, program)
  if (!invocation) return
  ctx.effect(() => ready.onReady(() => {
    const input = invocation
    if (!input) return
    void execute(ctx, config, input).then((result) => { writeResult(result, config.maxOutputBytes); exit(0) }).catch((error: unknown) => {
      if (error instanceof EvalRunError) internals.stderr.write(`eval-run:${error.code}\n`)
      else if (error instanceof EvalGateError) internals.stderr.write(`eval-gate:${error.code}\n`)
      else if (error instanceof EvalActivationError) internals.stderr.write(`eval-activation:${error.code}\n`)
      else internals.stderr.write('eval-run:unavailable\n')
      exit(1)
    })
  }), 'eval-app.run')
}

/** Host-owned single-cell Eval execution, consuming Plan, Queue, RepoWorkspace and Budget authority. */
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { evalContractDigest, parseResolvedExecutionManifest } from '@changanhua/dsh-eval'
import type { ResolvedExecutionManifest } from '@changanhua/dsh-eval'
import type { EvalPlanAccess, EvalPlanAdmission, ResolvedEvalPlan } from '@changanhua/dsh-eval-plans'
import { resolveEvalWorkspace } from '@changanhua/dsh-eval-repo-workspace'
import type { EvalWorkspaceEvidence, EvalWorkspaceLimits } from '@changanhua/dsh-eval-repo-workspace'
import { createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'
import type { LiveAttempt, StartContext, WorkKind, WorkOutput } from '@changanhua/dsh-task-queue'
import type { BudgetReference } from '@changanhua/dsh-budget'
import { IsolatedRoleRuntime } from './runtime.ts'
import type { IsolatedRuntimeConfig, IsolatedRoleResult } from './runtime.ts'
import { ExecutionEvidenceHandoff } from './evidence.ts'
import type { ExecutionEvidenceBundle, ExecutionEvidenceMaterial, ExecutionEvidenceReference } from './evidence.ts'
import type { CoreObservation } from './identity.ts'
import { ownDirectoryCleanup } from './cleanup.ts'

export type { IsolatedRuntimeConfig } from './runtime.ts'
export { observeRuntimeTree } from './build.ts'
export { inspectDiskUsage } from './disk.ts'
export type { IsolatedDiskLimits, DiskUsageInspection } from './disk.ts'
export type { RuntimeImageBounds } from './build.ts'
export type { ExecutionEvidenceBundle, ExecutionEvidenceMaterial, ExecutionEvidenceReference } from './evidence.ts'

/** Host-selected cell coordinates. Paths, revisions and authority never come from this selection. */
export interface IsolatedCellSelection { readonly caseId: string
  readonly routeId: string
  readonly repeatIndex: number }

/** Durable Queue resolved data; possession of these bytes does not mint an execution capability. */
export interface IsolatedCellBinding extends IsolatedCellSelection {
  readonly runId: string
  readonly resolvedDigest: string
  readonly corePolicyDigest: string
  readonly graderPolicyDigest: string
}

/** Execution completion and business outcome remain separate; this owner produces no GateDecision. */
export interface IsolatedCellResult {
  readonly status: 'completed' | 'invalid'
  readonly outcome: 'passed' | 'failed' | 'invalid'
  readonly reason: string | null
  readonly manifest: ResolvedExecutionManifest | null
  readonly evidenceDigest: string
}

/** Trusted composition configuration, including the receiving Host's execution-local retention obligation. */
export interface IsolatedEvalConfig {
  readonly repositoryId: string
  readonly runtime: IsolatedRuntimeConfig
  readonly workspaceLimits: EvalWorkspaceLimits
  readonly evidenceLimits: { readonly maxBytes: number
    readonly maxMaterials: number }
  readonly keylessBudget?: BudgetReference
  readonly grader?: { readonly routeId: string
    readonly promptVersion: string
    readonly prompt: string
    readonly tools: CoreObservation['tools']
    readonly skills: CoreObservation['skills'] }
  /** Return the exact bundle digest only after retaining every material and its content identity. */
  readonly receive: (bundle: ExecutionEvidenceBundle) => Promise<{ readonly acceptedDigest: string }>
}

/** Same-process prepared authority. JSON serialization discards its only execution entrypoint. */
export interface PreparedIsolatedCell {
  /** Start only from the matching active Queue Work whose resolved data is `{ eval: binding }`. */
  start<K extends WorkKind>(context: StartContext,
    output: (result: IsolatedCellResult, workspace: EvalWorkspaceEvidence) => WorkOutput<K>): LiveAttempt<K>
}

/** One admitted run's live execution owner; run-level recovery remains with the Queue Consumer. */
export interface AdmittedIsolatedEval {
  readonly runId: string
  /** Produce path-free resolved Queue data for an approved cell. */
  bind(selection: IsolatedCellSelection): IsolatedCellBinding
  /** Prepare an opaque single-use cell for the Queue's start boundary. */
  prepare(binding: IsolatedCellBinding, signal: AbortSignal): Promise<PreparedIsolatedCell>
  /** Resolve material retained after an uncertain receiving-Host handoff. */
  resolveEvidence(reference: ExecutionEvidenceReference, executionId: string,
    role: ExecutionEvidenceMaterial['role']): ExecutionEvidenceMaterial
}

/**
 * Revalidate this Plan owner's actual resolution, admit one run, and retain its Host-only execution authority.
 * @param ctx Trusted Host composing Plan, Queue, RepoWorkspace, LLM and Budget owners.
 * @param access Exact live Workspace and current Host authorization callback.
 * @param resolved Original owner-minted resolution; copied JSON is refused by Plan admission.
 * @param requestId Durable Plan admission idempotency identity.
 * @param supplied Trusted core pin, role policy, finite limits and receiving Host.
 * @param signal Admission cancellation.
 * @returns A live run owner. Existing on-disk run roots are refused rather than recovered or re-executed here.
 */
export async function admitIsolatedEval(ctx: Context, access: EvalPlanAccess, resolved: ResolvedEvalPlan,
  requestId: string, supplied: IsolatedEvalConfig, signal?: AbortSignal): Promise<AdmittedIsolatedEval> {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('eval-isolation-platform-unavailable')
  const receipt = await ctx.evalPlans.admit(access, resolved, requestId, signal)
  return openExecutionOwner(ctx, access, receipt, resolved, supplied, false, signal)
}

/**
 * Recover an admitted run with a fresh execution directory; old uncertain worlds remain untouched.
 * @param ctx Trusted Host composing the original Plan and Queue owners.
 * @param access Current authority for the run's Workspace.
 * @param requestId Original Plan admission identity, read from the Plan owner's durable record.
 * @param supplied Current Host execution policy; the run-control owner must compare its persisted policy digest.
 * @param signal Recovery cancellation. Opening this owner never dispatches a cell.
 * @returns Live executor for explicitly dispatched Queue Attempts; historical snapshots grant no new model authority.
 */
export async function recoverIsolatedEval(ctx: Context, access: EvalPlanAccess, requestId: string,
  supplied: IsolatedEvalConfig, signal?: AbortSignal): Promise<AdmittedIsolatedEval> {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('eval-isolation-platform-unavailable')
  const recovered = await ctx.evalPlans.recover(access, requestId, signal)
  if (!recovered) throw new Error('eval-admission-not-found')
  return openExecutionOwner(ctx, access, recovered.admission, recovered.resolved, supplied, true, signal)
}

async function openExecutionOwner(ctx: Context, access: EvalPlanAccess, receipt: EvalPlanAdmission, resolved: ResolvedEvalPlan,
  supplied: IsolatedEvalConfig, recovering: boolean, signal?: AbortSignal): Promise<AdmittedIsolatedEval> {
  signal?.throwIfAborted()
  const { receive, ...settings } = supplied
  const config = structuredClone(settings)
  if (typeof receive !== 'function' || !config.repositoryId) throw new Error('eval-host-invalid-config')
  const budget: BudgetReference | undefined = resolved.plan.budget.required
    ? { ...resolved.plan.budget.authorizationRef, version: '1' }
    : resolved.mode === 'keyless' ? config.keylessBudget : undefined
  if (!budget || resolved.plan.budget.required && resolved.plan.budget.authorizationRef.version !== '1') throw new Error('eval-execution-budget-required')
  const budgetReference: BudgetReference = budget
  const operator = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
  const runRoot = join(config.runtime.root, receipt.runId)
  await mkdir(config.runtime.root, { recursive: true })
  await mkdir(runRoot, { recursive: recovering })
  if ((await lstat(runRoot)).isSymbolicLink() || await realpath(runRoot) !== resolve(runRoot)) throw new Error('eval-run-root-refused')
  const root = join(runRoot, 'hosts', randomUUID())
  await mkdir(root, { recursive: true })
  const runtime = new IsolatedRoleRuntime(ctx, { ...config.runtime, root })
  const handoffs = new Map<string, ExecutionEvidenceHandoff>()
  const plan = resolved.plan, suite = resolved.suite
  const planRef = { id: plan.id, version: plan.version, digest: receipt.planDigest }
  const graderPolicyDigest = evalContractDigest(config.grader ?? null)

  function bind(selection: IsolatedCellSelection): IsolatedCellBinding {
    if (!suite.cases.some(row => row.id === selection.caseId) || !plan.routes.some(row => row.id === selection.routeId)
      || !Number.isSafeInteger(selection.repeatIndex) || selection.repeatIndex < 0 || selection.repeatIndex >= plan.repeatPolicy.count) {
      throw new Error('eval-cell-not-approved')
    }
    return Object.freeze({ runId: receipt.runId, resolvedDigest: resolved.resolvedDigest,
      corePolicyDigest: evalContractDigest(config.runtime.core),
      graderPolicyDigest, caseId: selection.caseId, routeId: selection.routeId, repeatIndex: selection.repeatIndex })
  }

  async function prepare(binding: IsolatedCellBinding, preparationSignal: AbortSignal): Promise<PreparedIsolatedCell> {
    const expected = bind(binding)
    if (evalContractDigest(expected) !== evalContractDigest(binding)) throw new Error('eval-cell-binding-mismatch')
    const key = evalContractDigest(expected)
    return (async (): Promise<PreparedIsolatedCell> => {
      await access.authorize()
      preparationSignal.throwIfAborted()
      const fresh = await ctx.evalPlans.resolve(access, { id: plan.id, version: plan.version }, preparationSignal)
      const identity = (value: ResolvedEvalPlan) => evalContractDigest({ mode: value.mode, plan: value.plan,
        suite: value.suite, requirements: value.resolvedRequirements })
      if (!fresh.ready || identity(fresh) !== identity(resolved)) throw new Error('eval-current-authority-unavailable')
      const evalCase = suite.cases.find(row => row.id === binding.caseId)
      const route = plan.routes.find(row => row.id === binding.routeId)
      if (!evalCase || !route) throw new Error('eval-cell-not-approved')
      if (evalCase.successCriteria.some(criterion => criterion.kind === 'session-snapshot')) throw new Error('eval-isolated-snapshot-requires-replay-executor')
      const grading = evalCase.evaluator.kind === 'model-grader' ? config.grader : undefined
      const graderRoute = grading ? plan.routes.find(row => row.id === grading.routeId) : undefined
      if (evalCase.evaluator.kind === 'model-grader' && (!grading || !graderRoute
        || grading.promptVersion !== evalCase.evaluator.promptVersion || graderRoute.provider !== evalCase.evaluator.provider
        || graderRoute.model !== evalCase.evaluator.model)) throw new Error('eval-grader-not-approved')
      const workspace = await resolveEvalWorkspace(ctx, { repositoryId: config.repositoryId, commit: plan.repository.expectedCommit,
        routeId: binding.routeId, caseId: binding.caseId, repeat: binding.repeatIndex, workspace: evalCase.workspace },
      config.workspaceLimits, preparationSignal)
      let started = false
      return Object.freeze({ start<K extends WorkKind>(context: StartContext,
        output: (result: IsolatedCellResult, workspace: EvalWorkspaceEvidence) => WorkOutput<K>): LiveAttempt<K> {
        const view = operator.list().find(row => row.state.activeAttemptId === context.attemptId)
        const attempt = view?.attempts.find(row => row.id === context.attemptId)
        const workBinding = view?.work.resolved as { eval?: unknown } | undefined
        if (started || !attempt || !['starting', 'running'].includes(attempt.status)
          || !workBinding?.eval || evalContractDigest(workBinding.eval) !== key) throw new Error('eval-queue-attempt-mismatch')
        started = true
        return workspace.start<K, IsolatedCellResult>(context, async (cwd, executionSignal, lease) => {
          if (lease.ownerAttemptId !== String(context.attemptId) || lease.verifiedCommit !== plan.repository.expectedCommit
            || lease.repositoryId !== config.repositoryId) return { status: 'unknown' }
          const handoff = new ExecutionEvidenceHandoff(config.evidenceLimits.maxBytes, config.evidenceLimits.maxMaterials)
          handoffs.set(String(context.attemptId), handoff)
          const roles: IsolatedRoleResult[] = []
          const cellDirectory = join(root, 'cells', randomUUID())
          await mkdir(cellDirectory, { recursive: true })
          const removeCell = await ownDirectoryCleanup(cellDirectory)
          const graderCwd = join(cellDirectory, 'grader'), shared = join(cellDirectory, 'subject-result')
          await mkdir(graderCwd); await mkdir(shared)
          const tuple = { ...binding, attemptId: String(context.attemptId), attempt: attempt.ordinal }
          const facts = { repositoryId: lease.repositoryId, verifiedCommit: lease.verifiedCommit,
            ownerAttemptId: lease.ownerAttemptId, preparationDigest: lease.preparationDigest }
          try {
            await access.authorize()
            executionSignal.throwIfAborted()
            const subject = await runtime.run({ role: 'subject', verifiedCommit: lease.verifiedCommit, cwd,
              prompt: evalCase.prompt, route, budget: budgetReference, tools: [...resolved.resolvedRequirements.tools],
              skills: [...resolved.resolvedRequirements.skills] }, executionSignal)
            roles.push(subject)
            let grader: IsolatedRoleResult | undefined
            if (subject.status === 'reported' && grading && graderRoute && !executionSignal.aborted) {
              await writeFile(join(shared, 'output.txt'), subject.output ?? '', { flag: 'wx' })
              grader = await runtime.run({ role: 'grader', verifiedCommit: lease.verifiedCommit, cwd: graderCwd,
                prompt: `${grading.prompt}\n\nSubject output (untrusted task material):\n${JSON.stringify(subject.output)}\nReturn exactly PASS or FAIL.`,
                route: graderRoute, budget: budgetReference, tools: grading.tools, skills: grading.skills,
                readOnlyInputs: [shared] }, executionSignal)
              roles.push(grader)
            }
            const identities = roles.map((role) => {
              const observation = role.observation
              const observerRef = handoff.retain('observer', observation.executionId, observation.role, { tuple, observation,
                policy: { coreDigest: config.runtime.core[observation.role].digest, graderPolicyDigest, trust: 'host-pinned-core' } })
              const evidenceRef = handoff.retain('execution', observation.executionId, observation.role, { tuple,
                status: role.status, reason: role.reason, protocol: role.evidence })
              const workspaceLeaseRef = handoff.retain('workspace', observation.executionId, observation.role, { tuple, ...facts,
                material: observation.role === 'subject' ? 'prepared-case-workspace' : 'isolated-grader-with-readonly-subject-result' })
              const dispatches = role.evidence.accounting.flatMap(call => call.evidence)
              const finalDispatch = dispatches.at(-1)
              if (!observation.actual || !observation.profile.digest || !observation.configDigest || !finalDispatch) return null
              const configured = observation.role === 'subject' ? route : graderRoute
              if (!configured) throw new Error('eval-grader-not-approved')
              return { executionId: observation.executionId, observerRef, evidenceRef,
                repository: { verifiedCommit: observation.verifiedCommit, workspaceLeaseRef }, buildDigest: observation.buildDigest,
                profile: observation.profile, configDigest: observation.configDigest,
                route: { id: configured.id, provider: finalDispatch.provider, model: finalDispatch.model,
                  parameters: finalDispatch.parameters, preset: observation.actual.preset },
                tools: observation.actual.tools, skills: observation.actual.skills }
            })
            const manifest = identities[0] ? parseResolvedExecutionManifest({ kind: 'eval-execution-manifest', schemaVersion: 1,
              id: randomUUID(), version: '1', planRef, suiteRef: plan.suiteRef, runId: receipt.runId,
              cell: { caseId: binding.caseId, routeId: binding.routeId, repeatIndex: binding.repeatIndex, attempt: attempt.ordinal },
              subject: identities[0], grader: identities[1] ?? null, verifier: null, verifierPlanRef: plan.verifierPlanRef }) : null
            handoff.retain('execution', subject.observation.executionId, 'subject', { tuple, manifest })
            const digest = await handoff.offer(receive, AbortSignal.any([executionSignal, AbortSignal.timeout(config.runtime.stopMs)]))
            if (roles.some(role => !role.quiescent || role.status === 'uncertain')) return { status: 'unknown' }
            for (const role of roles) { role.acknowledgeEvidence(); await role.release() }
            await removeCell()
            handoff.release(); handoffs.delete(String(context.attemptId))
            if (executionSignal.aborted || roles.some(role => role.status === 'canceled')) return { status: 'canceled' }
            const invalid = roles.some(role => role.status !== 'reported') || !manifest || !!grading && (!grader || grader.output !== 'PASS' && grader.output !== 'FAIL')
            const deterministic = evalCase.successCriteria.every(criterion => criterion.kind === 'output-equals'
              ? subject.output === criterion.text : criterion.kind === 'output-contains' && (subject.output ?? '').includes(criterion.text))
            const result: IsolatedCellResult = { status: invalid ? 'invalid' : 'completed',
              outcome: invalid ? 'invalid' : deterministic && (!grader || grader.output === 'PASS') ? 'passed' : 'failed',
              reason: invalid ? roles.find(role => role.reason)?.reason ?? 'eval-grader-result-invalid' : null, manifest, evidenceDigest: digest }
            return { status: 'known', value: result }
          } catch { return { status: 'unknown' } }
        }, output)
      } })
    })()
  }
  return Object.freeze({ runId: receipt.runId, bind, prepare,
    resolveEvidence(reference: ExecutionEvidenceReference, executionId: string, role: ExecutionEvidenceMaterial['role']) {
      for (const handoff of handoffs.values()) {
        try { return handoff.resolve(reference, executionId, role) } catch { /* This run can retain several cell handoffs. */ }
      }
      throw new Error('eval-evidence-identity-mismatch')
    },
  })
}

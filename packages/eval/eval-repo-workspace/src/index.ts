import { mkdir, lstat, readdir, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { evalContractDigest, evalWorkspaceSchema } from '@changanhua/dsh-eval'
import type { EvalWorkspace } from '@changanhua/dsh-eval'
import { GitCommitId, QueueAttemptIdRef, RepositoryId, RepositoryRelativePath } from '@changanhua/dsh-delivery-protocol'
import type { ChangeWorkspaceLease, VerifiedRepositoryRevision } from '@changanhua/dsh-repo-workspace'
import type { AttemptOutcome, LiveAttempt, StartContext, WorkKind, WorkOutput } from '@changanhua/dsh-task-queue'

/** Host-only pinned repository intent; paths never cross admission. */
export interface EvalRepositoryInput {
  readonly repositoryId: string
  readonly commit: string
  readonly routeId: string
  readonly caseId: string
  readonly repeat: number
  readonly workspace: EvalWorkspace
}

/** Provider-observed identity retained in a report; no durable absolute path. */
export interface EvalWorkspaceEvidence {
  readonly repositoryId: string
  readonly verifiedCommit: string
  readonly ownerAttemptId: string
  readonly routeId: string
  readonly caseId: string
  readonly repeat: number
  readonly preparationDigest: string | null
  readonly disposition: 'removed' | 'preserved' | 'needs-attention'
}

/** Host callback must resolve known only after all owned execution has quiesced. */
export type EvalCellCompletion<T> = { readonly status: 'known'; readonly value: T } | { readonly status: 'unknown' } | { readonly status: 'canceled' }

/** Unknown completion always retains the exact Attempt lease for operator attention. */
export type EvalWorkspaceOutcome<T> =
  | { readonly status: 'known'; readonly value: T; readonly evidence: EvalWorkspaceEvidence }
  | { readonly status: 'failed' | 'canceled'; readonly reason: 'preparation-failed' | 'cancelled'; readonly evidence: EvalWorkspaceEvidence }
  | { readonly status: 'unknown'; readonly reason: 'execution-uncertain' | 'preparation-conflict' | 'cleanup-uncertain'; readonly evidence: EvalWorkspaceEvidence }

/** Explicit fixture preparation bounds, shared across the complete tree. */
export interface EvalWorkspaceLimits { readonly maxFixtureFiles: number; readonly maxFixtureBytes: number }

/**
 * Resolve the full commit through the configured repository owner before Queue admission.
 * The returned closure holds the actual provider proof, never a caller reconstruction.
 * @param ctx Host services; no ambient cwd or local path is accepted.
 * @param input Host-resolved exact cell identity.
 * @param limits Bounds for complete fixture preparation.
 * @param signal Admission cancellation.
 * @returns One Attempt runner reusable by the Queue handler's start boundary.
 */
export async function resolveEvalWorkspace(
  ctx: Context, input: EvalRepositoryInput, limits: EvalWorkspaceLimits, signal?: AbortSignal,
): Promise<ResolvedEvalWorkspace> {
  for (const limit of Object.values(limits)) if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('invalid fixture bound')
  if (!input.routeId || !input.caseId || !Number.isSafeInteger(input.repeat) || input.repeat < 0) throw new Error('invalid Eval cell identity')
  const workspace = evalWorkspaceSchema.parse(input.workspace)
  const owner = ctx.repoWorkspace
  const revision = await owner.inspectRevision({ repositoryId: RepositoryId(input.repositoryId),
    commit: GitCommitId(input.commit), ...(signal ? { signal } : {}) })
  return new ResolvedEvalWorkspace(owner, revision, { ...input, workspace }, { ...limits })
}

/** Same-process bridge retaining the repository provider's proof and delegating all lease lifecycle work to it. */
export class ResolvedEvalWorkspace {
  constructor(
    private readonly owner: Context['repoWorkspace'],
    private readonly revision: VerifiedRepositoryRevision,
    private readonly input: EvalRepositoryInput,
    private readonly limits: EvalWorkspaceLimits,
  ) {}

  /**
   * Hold a real Queue Attempt through workspace preparation, execution and cleanup.
   * Unknown execution or cleanup always becomes Queue unknown Attention, regardless of the output mapper.
   * @param context Queue-owned Attempt identity and cancellation.
   * @param execute Cooperative executor; cancellation resolves only after its work is quiescent.
   * @param output Pure successful-result projection retaining the workspace evidence.
   * @returns Synchronous live ownership, whose cancellation awaits the same terminal promise.
   */
  start<K extends WorkKind, T>(
    context: StartContext,
    execute: (cwd: string, signal: AbortSignal) => Promise<EvalCellCompletion<T>>,
    output: (value: T, evidence: EvalWorkspaceEvidence) => WorkOutput<K>,
  ): LiveAttempt<K> {
    const controller = new AbortController()
    const signal = AbortSignal.any([context.signal, controller.signal])
    const done: Promise<AttemptOutcome<K>> = this.run({ ...context, signal }, execute).then((result): AttemptOutcome<K> => {
      if (result.status === 'known') return { status: 'succeeded', output: output(result.value, result.evidence) }
      if (result.status === 'canceled') return { status: 'canceled' }
      return { status: result.status === 'unknown' ? 'unknown' : 'failed', failure: {
        category: `eval-workspace-${result.reason}`, sideEffect: result.status === 'unknown' ? 'unknown' : 'not-started',
        retriable: false, message: JSON.stringify(result.evidence),
      } }
    }).catch((): AttemptOutcome<K> => ({ status: 'unknown', failure: { category: 'eval-workspace-ownership-uncertain',
      sideEffect: 'unknown', retriable: false, message: `Attempt ${context.attemptId} requires workspace ownership inspection` } }))
    return { done, cancel: async (reason) => { controller.abort(new Error(reason)); await done } }
  }

  /**
   * Run one Queue-owned Attempt in a new checkout. Reopened preparation markers refuse re-execution.
   * @param context The real Queue StartContext; its attemptId is the only lease owner.
   * @param execute The isolated executor/grader Consumer, which owns child quiescence.
   * @returns Known outcome after remove, or unknown outcome after preserve/cleanup ambiguity.
   */
  async run<T>(context: StartContext, execute: (cwd: string,
    signal: AbortSignal) => Promise<EvalCellCompletion<T>>): Promise<EvalWorkspaceOutcome<T>> {
    const attempt = QueueAttemptIdRef(String(context.attemptId))
    context.signal.throwIfAborted()
    const lease = await this.owner.openChange({ ownerAttemptId: attempt, base: this.revision, signal: context.signal })
    let preparationDigest: string | null = null
    const evidence = (disposition: EvalWorkspaceEvidence['disposition']): EvalWorkspaceEvidence => ({
      repositoryId: lease.repositoryId, verifiedCommit: lease.baseCommit, ownerAttemptId: lease.ownerAttemptId,
      routeId: this.input.routeId, caseId: this.input.caseId, repeat: this.input.repeat, preparationDigest, disposition,
    })
    const preserve = async (reason: 'execution-uncertain' | 'preparation-conflict'): Promise<EvalWorkspaceOutcome<T>> => {
      try { await lease.close('preserve'); return { status: 'unknown', reason, evidence: evidence('preserved') } }
      catch { return { status: 'unknown', reason: 'cleanup-uncertain', evidence: evidence('needs-attention') } }
    }
    let cwd: string
    let created = false
    try {
      // Exclusive creation distinguishes a new preparation from any prior Attempt activity.
      // The repository owner remains the sole owner of checkout removal and recovery markers.
      const root = await realpath(lease.cwd)
      const marker = join(root, '.eval-attempt')
      await mkdir(marker)
      created = true
      await writeFile(join(marker, 'identity.json'), JSON.stringify({ attempt, ...this.input }), { flag: 'wx' })
      const prepared = await this.prepare(lease, marker, context.signal)
      cwd = prepared.cwd
      preparationDigest = prepared.digest
      context.signal.throwIfAborted()
    } catch {
      if (!created) return preserve('preparation-conflict')
      try { await lease.close('remove') }
      catch { return { status: 'unknown', reason: 'cleanup-uncertain', evidence: evidence('needs-attention') } }
      return { status: context.signal.aborted ? 'canceled' : 'failed', reason: context.signal.aborted ? 'cancelled' : 'preparation-failed', evidence: evidence('removed') }
    }
    let completion: EvalCellCompletion<T>
    try { completion = await execute(cwd, context.signal) }
    catch { return preserve('execution-uncertain') }
    if (completion.status === 'unknown') return preserve('execution-uncertain')
    try { await lease.close('remove') }
    catch { return { status: 'unknown', reason: 'cleanup-uncertain', evidence: evidence('needs-attention') } }
    if (completion.status === 'canceled') return { status: 'canceled', reason: 'cancelled', evidence: evidence('removed') }
    return { status: 'known', value: completion.value, evidence: evidence('removed') }
  }

  private async prepare(lease: ChangeWorkspaceLease, marker: string, signal: AbortSignal): Promise<{ cwd: string; digest: string }> {
    const policy = this.input.workspace
    const root = await realpath(lease.cwd)
    if (policy.kind === 'repository') return { cwd: root, digest: evalContractDigest({ kind: policy.kind, commit: lease.baseCommit }) }
    const cwd = join(marker, 'workspace')
    await mkdir(cwd)
    const files: Array<{ path: string; blobId: string; bytes: number }> = []
    if (policy.kind === 'fixture') {
      if (isAbsolute(policy.path) || win32.isAbsolute(policy.path) || policy.path.split(/[\\/]/u).some(part => !part || part === '..' || part === '.git' || part === '.eval-attempt')) {
        throw new Error('fixture path is not a contained repository-relative directory')
      }
      const source = resolve(root, policy.path)
      const base = await this.owner.resolveBase({ repositoryId: this.revision.repositoryId,
        selectionRule: { kind: 'commit', commit: this.revision.commit }, signal })
      let bytes = 0
      const walk = async (directory: string, destination: string): Promise<void> => {
        signal.throwIfAborted()
        const physical = await realpath(directory)
        const rel = relative(root, physical)
        if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || physical !== directory) throw new Error('fixture escaped its verified checkout')
        if (!(await lstat(directory)).isDirectory()) throw new Error('fixture is not a directory')
        for (const child of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
          signal.throwIfAborted()
          if (child.isSymbolicLink() || child.name === '.git' || child.name === '.eval-attempt' || child.name === '.dsh') throw new Error('fixture contains an unsafe entry')
          const path = join(directory, child.name)
          const target = join(destination, child.name)
          if (child.isDirectory()) { await mkdir(target); await walk(path, target); continue }
          if (!child.isFile() || files.length >= this.limits.maxFixtureFiles) throw new Error('fixture exceeds file bound or contains a special file')
          const repositoryPath = relative(root, path).split(sep).join('/')
          const blob = await this.owner.readBlob({ base, path: RepositoryRelativePath(repositoryPath),
            maxBytes: this.limits.maxFixtureBytes - bytes, signal })
          bytes += blob.bytes.byteLength
          if (bytes > this.limits.maxFixtureBytes) throw new Error('fixture exceeds complete byte bound')
          await writeFile(target, blob.bytes, { flag: 'wx' })
          files.push({ path: relative(source, path).split(sep).join('/'), blobId: blob.blobId, bytes: blob.bytes.byteLength })
        }
      }
      await walk(source, cwd)
    }
    return { cwd, digest: evalContractDigest({ policy, commit: lease.baseCommit, files }) }
  }
}

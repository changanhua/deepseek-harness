/** Local Git repository facts and Attempt-owned worktree provider. @module @deepseek-ai/dsh-repo-workspace-git-local */

import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  GitBlobId,
  GitCommitId,
  RepositoryRelativePath,
  canonicalJson,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  GitCommitId as GitCommitIdType,
  QueueAttemptIdRef,
  RepositoryId,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  RepositoryWorkspace,
  RepositoryWorkspaceError,
} from '@deepseek-ai/dsh-repo-workspace'
import type {
  ChangeWorkspaceLease,
  CreateCheckpointRequest,
  InspectRepositoryRangeRequest,
  InspectRepositoryRevisionRequest,
  OpenChangeWorkspaceRequest,
  OpenVerificationWorkspaceRequest,
  ReadRepositoryBlobRequest,
  RepositoryRangeFacts,
  RepositoryCheckpoint,
  RepositoryWorkspaceDisposition,
  ResolveRepositoryBaseRequest,
  VerificationWorkspaceLease,
  VerifiedRepositoryBase,
  VerifiedRepositoryBlob,
  VerifiedRepositoryRevision,
} from '@deepseek-ai/dsh-repo-workspace'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'

const DEFAULT_GIT_GRACE_MS = 5_000
const DEFAULT_GIT_OUTPUT_BYTES = 4 * 1024 * 1024
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Configured repository identities and the isolated worktree parent. */
export interface Config {
  /** Closed map from stable repository id to its local Git checkout root. */
  readonly repositories: Readonly<Record<string, string>>
  /** Directory below which attempt-owned worktrees are created. */
  readonly worktreeRoot: string
  /** Git process TERM-to-KILL grace. */
  readonly graceMs?: number
  /** Complete-byte cap for one Git command stream. */
  readonly maxGitOutputBytes?: number
}

/** Loader configuration schema. */
export const Config: z<Config> = z.object({
  repositories: z.dict(z.string()).required(),
  worktreeRoot: z.string().required(),
  graceMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
  maxGitOutputBytes: z.number().step(1).min(1).max(MAX_GIT_OUTPUT_BYTES),
})

interface GitResult {
  readonly outcome: SubprocessOutcome
  readonly stdout: Uint8Array
  readonly stderr: string
}

interface OwnedLease {
  readonly signature: string
  readonly lease: Promise<ChangeWorkspaceLease | VerificationWorkspaceLease>
}

interface ChangeLeaseMarker {
  readonly format: 'dsh-repository-workspace-lease@1'
  readonly ownerAttemptId: QueueAttemptIdRef
  readonly kind: 'change'
  readonly repositoryId: RepositoryId
  readonly baseCommit: GitCommitIdType
}

interface VerificationLeaseMarker {
  readonly format: 'dsh-repository-workspace-lease@1'
  readonly ownerAttemptId: QueueAttemptIdRef
  readonly kind: 'verification'
  readonly repositoryId: RepositoryId
  readonly baseCommit: GitCommitIdType
  readonly targetCommit: GitCommitIdType
}

type LeaseMarker = ChangeLeaseMarker | VerificationLeaseMarker

/** Git/Subprocess-backed provider selected for local MVP repositories. */
export class GitLocalRepositoryWorkspace extends RepositoryWorkspace {
  /** Git commands execute only through the governed Subprocess service. */
  static inject = ['subprocess']
  static Config = Config
  private readonly context: Context
  private readonly repositories: ReadonlyMap<string, string>
  private readonly worktreeRoot: string
  private readonly graceMs: number
  private readonly maxGitOutputBytes: number
  private readonly verifiedBases = new WeakSet<object>()
  private readonly verifiedRevisions = new WeakSet<object>()
  private readonly leases = new Map<QueueAttemptIdRef, OwnedLease>()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.context = ctx
    this.repositories = new Map(Object.entries(config.repositories).map(([id, path]) => [id, resolve(path)]))
    this.worktreeRoot = resolve(config.worktreeRoot)
    this.graceMs = config.graceMs ?? DEFAULT_GIT_GRACE_MS
    this.maxGitOutputBytes = config.maxGitOutputBytes ?? DEFAULT_GIT_OUTPUT_BYTES
  }

  async resolveBase(request: ResolveRepositoryBaseRequest): Promise<VerifiedRepositoryBase> {
    request.signal?.throwIfAborted()
    const repository = await this.repository(request.repositoryId, request.signal)
    const selectionRule = { ...request.selectionRule }
    const commit = selectionRule.kind === 'commit'
      ? await this.resolveCommit(repository, selectionRule.commit, request.signal, 'revision-not-found')
      : await this.resolveCommit(repository, selectionRule.ref, request.signal, 'reference-not-found')
    const base = this.verifiedBase(request.repositoryId, selectionRule, commit)
    this.verifiedBases.add(base)
    this.verifiedRevisions.add(base)
    return base
  }

  async inspectRevision(request: InspectRepositoryRevisionRequest): Promise<VerifiedRepositoryRevision> {
    request.signal?.throwIfAborted()
    const repository = await this.repository(request.repositoryId, request.signal)
    const commit = await this.resolveCommit(repository, request.commit, request.signal, 'revision-not-found')
    const revision = this.verifiedRevision(request.repositoryId, commit)
    this.verifiedRevisions.add(revision)
    return revision
  }

  async readBlob(request: ReadRepositoryBlobRequest): Promise<VerifiedRepositoryBlob> {
    request.signal?.throwIfAborted()
    if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes <= 0) {
      throw new TypeError('repo-workspace-git-local: maxBytes must be a positive safe integer')
    }
    if (!this.verifiedBases.has(request.base)) {
      throw new RepositoryWorkspaceError('revision-not-found', 'repository base was not minted by this provider')
    }
    const repository = await this.repository(request.base.repositoryId, request.signal)
    const object = await this.runGit(repository, [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${request.base.commit}:${request.path}`,
    ], request.signal)
    if (object.outcome.exitCode !== 0) {
      throw new RepositoryWorkspaceError(
        'blob-not-found',
        `Git has no blob '${request.path}' at '${request.base.commit}'`,
      )
    }
    let blobId
    try {
      blobId = GitBlobId(new TextDecoder('utf-8', { fatal: true }).decode(object.stdout).trim())
    } catch (error) {
      throw new RepositoryWorkspaceError('blob-not-found', `Git returned an invalid blob id for '${request.path}'`, { cause: error })
    }
    const type = await this.runGit(repository, ['cat-file', '-t', blobId], request.signal)
    if (type.outcome.exitCode !== 0 || new TextDecoder().decode(type.stdout).trim() !== 'blob') {
      throw new RepositoryWorkspaceError('blob-not-found', `Git object '${blobId}' is not a blob`)
    }
    const sizeResult = await this.runGit(repository, ['cat-file', '-s', blobId], request.signal)
    if (sizeResult.outcome.exitCode !== 0) {
      throw new RepositoryWorkspaceError('blob-not-found', `Git returned an invalid size for blob '${blobId}'`)
    }
    let size: number
    try {
      size = Number(new TextDecoder('utf-8', { fatal: true }).decode(sizeResult.stdout).trim())
    } catch (error) {
      throw new RepositoryWorkspaceError('blob-not-found', `Git returned an invalid size for blob '${blobId}'`, { cause: error })
    }
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new RepositoryWorkspaceError('blob-not-found', `Git returned an invalid size for blob '${blobId}'`)
    }
    if (size > request.maxBytes) {
      throw new RepositoryWorkspaceError(
        'blob-too-large',
        `Git blob '${request.path}' is ${String(size)} bytes; limit is ${String(request.maxBytes)}`,
      )
    }
    const content = await this.runGit(repository, ['cat-file', 'blob', blobId], request.signal, request.maxBytes)
    if (content.outcome.exitCode !== 0 || content.stdout.byteLength !== size) {
      throw new RepositoryWorkspaceError('blob-not-found', `Git could not read complete blob '${blobId}'`)
    }
    return this.verifiedBlob(request.base, request.path, blobId, content.stdout)
  }

  async inspectRange(request: InspectRepositoryRangeRequest): Promise<RepositoryRangeFacts> {
    request.signal?.throwIfAborted()
    if (request.base.repositoryId !== request.target.repositoryId) {
      throw new RepositoryWorkspaceError('repository-mismatch', 'range revisions belong to different repositories')
    }
    if (!this.verifiedRevisions.has(request.base) || !this.verifiedRevisions.has(request.target)) {
      throw new RepositoryWorkspaceError('revision-not-found', 'range revision was not minted by this provider')
    }
    const repository = await this.repository(request.base.repositoryId, request.signal)
    const ancestry = await this.runGit(repository, [
      'merge-base',
      '--is-ancestor',
      request.base.commit,
      request.target.commit,
    ], request.signal)
    if (ancestry.outcome.exitCode !== 0 && ancestry.outcome.exitCode !== 1) {
      throw new RepositoryWorkspaceError('revision-not-found', 'Git could not compare repository ancestry')
    }
    const diff = await this.runGit(repository, [
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      request.base.commit,
      request.target.commit,
      '--',
    ], request.signal)
    if (diff.outcome.exitCode !== 0) {
      throw new RepositoryWorkspaceError('revision-not-found', 'Git could not derive changed paths')
    }
    const changedPaths = decodeGitPaths(diff.stdout)
    return Object.freeze({
      repositoryId: request.base.repositoryId,
      baseCommit: request.base.commit,
      targetCommit: request.target.commit,
      descendsFromBase: ancestry.outcome.exitCode === 0,
      changedPaths: Object.freeze(changedPaths),
    })
  }

  async openChange(request: OpenChangeWorkspaceRequest): Promise<ChangeWorkspaceLease> {
    request.signal?.throwIfAborted()
    if (!this.verifiedRevisions.has(request.base)) {
      throw new RepositoryWorkspaceError('revision-not-found', 'change base was not minted by this provider')
    }
    const signature = canonicalJson({
      kind: 'change',
      repositoryId: request.base.repositoryId,
      baseCommit: request.base.commit,
    })
    const prior = this.leases.get(request.ownerAttemptId)
    if (prior !== undefined) {
      if (prior.signature !== signature) {
        throw new RepositoryWorkspaceError('owner-conflict', 'one Attempt owner cannot identify different repository workspaces')
      }
      return await prior.lease as ChangeWorkspaceLease
    }
    const lease = this.createChangeLease(request)
    this.leases.set(request.ownerAttemptId, { signature, lease })
    try {
      return await lease
    } catch (error) {
      this.leases.delete(request.ownerAttemptId)
      throw error
    }
  }

  async openVerification(request: OpenVerificationWorkspaceRequest): Promise<VerificationWorkspaceLease> {
    request.signal?.throwIfAborted()
    if (!this.verifiedRevisions.has(request.base) || !this.verifiedRevisions.has(request.target)) {
      throw new RepositoryWorkspaceError('revision-not-found', 'verification revision was not minted by this provider')
    }
    if (request.base.repositoryId !== request.target.repositoryId) {
      throw new RepositoryWorkspaceError('repository-mismatch', 'verification revisions belong to different repositories')
    }
    const signature = canonicalJson({
      kind: 'verification',
      repositoryId: request.base.repositoryId,
      baseCommit: request.base.commit,
      targetCommit: request.target.commit,
    })
    const prior = this.leases.get(request.ownerAttemptId)
    if (prior !== undefined) {
      if (prior.signature !== signature) {
        throw new RepositoryWorkspaceError('owner-conflict', 'one Attempt owner cannot identify different repository workspaces')
      }
      return await prior.lease as VerificationWorkspaceLease
    }
    const lease = this.createVerificationLease(request)
    this.leases.set(request.ownerAttemptId, { signature, lease })
    try {
      return await lease
    } catch (error) {
      this.leases.delete(request.ownerAttemptId)
      throw error
    }
  }

  private async repository(repositoryId: RepositoryId, signal?: AbortSignal): Promise<string> {
    const configured = this.repositories.get(repositoryId)
    if (configured === undefined) {
      throw new RepositoryWorkspaceError('repository-not-found', `repository '${repositoryId}' is not configured`)
    }
    const result = await this.runGit(configured, ['rev-parse', '--show-toplevel'], signal)
    if (result.outcome.exitCode !== 0) {
      throw new RepositoryWorkspaceError('repository-not-found', `repository '${repositoryId}' is not a Git checkout`)
    }
    let configuredRoot: string
    let gitRoot: string
    try {
      configuredRoot = await realpath(configured)
      gitRoot = await realpath(new TextDecoder('utf-8', { fatal: true }).decode(result.stdout).trim())
    } catch (error) {
      throw new RepositoryWorkspaceError('repository-not-found', `repository '${repositoryId}' path cannot be verified`, { cause: error })
    }
    if (!samePath(configuredRoot, gitRoot)) {
      throw new RepositoryWorkspaceError('repository-mismatch', `repository '${repositoryId}' is configured below another checkout`)
    }
    return gitRoot
  }

  private async createChangeLease(request: OpenChangeWorkspaceRequest): Promise<ChangeWorkspaceLease> {
    await this.ensureRealDirectory(this.worktreeRoot)
    const ownerDirectory = join(this.worktreeRoot, `attempt-${ownerHash(request.ownerAttemptId)}`)
    const marker: ChangeLeaseMarker = {
      format: 'dsh-repository-workspace-lease@1',
      ownerAttemptId: request.ownerAttemptId,
      kind: 'change',
      repositoryId: request.base.repositoryId,
      baseCommit: request.base.commit,
    }
    await this.ensureLeaseDirectory(ownerDirectory, marker)
    const cwd = join(ownerDirectory, 'checkout')
    const repository = await this.repository(request.base.repositoryId, request.signal)
    const checkout = await fileStatus(cwd)
    if (checkout === undefined) {
      const added = await this.runGit(repository, [
        'worktree',
        'add',
        '--detach',
        cwd,
        request.base.commit,
      ], request.signal)
      if (added.outcome.exitCode !== 0) {
        throw new RepositoryWorkspaceError('unavailable', `Git could not create Attempt worktree '${cwd}'`)
      }
    } else {
      if (!checkout.isDirectory() || checkout.isSymbolicLink()) {
        throw new RepositoryWorkspaceError('owner-conflict', `Attempt checkout '${cwd}' must be a real directory`)
      }
      await this.verifyRecoveredCheckout(repository, cwd, request.base.commit, request.signal)
    }
    return new GitChangeWorkspaceLease(
      request.ownerAttemptId,
      request.base.repositoryId,
      request.base.commit,
      cwd,
      checkpoint => this.createCheckpoint(request.base.repositoryId, repository, cwd, request.base.commit, checkpoint),
      disposition => this.closeLease(repository, ownerDirectory, cwd, disposition),
    )
  }

  private async createVerificationLease(
    request: OpenVerificationWorkspaceRequest,
  ): Promise<VerificationWorkspaceLease> {
    await this.ensureRealDirectory(this.worktreeRoot)
    const ownerDirectory = join(this.worktreeRoot, `attempt-${ownerHash(request.ownerAttemptId)}`)
    const marker: VerificationLeaseMarker = {
      format: 'dsh-repository-workspace-lease@1',
      ownerAttemptId: request.ownerAttemptId,
      kind: 'verification',
      repositoryId: request.base.repositoryId,
      baseCommit: request.base.commit,
      targetCommit: request.target.commit,
    }
    await this.ensureLeaseDirectory(ownerDirectory, marker)
    const cwd = join(ownerDirectory, 'checkout')
    const repository = await this.repository(request.base.repositoryId, request.signal)
    const checkout = await fileStatus(cwd)
    if (checkout === undefined) {
      const added = await this.runGit(repository, [
        'worktree',
        'add',
        '--detach',
        cwd,
        request.target.commit,
      ], request.signal)
      if (added.outcome.exitCode !== 0) {
        throw new RepositoryWorkspaceError('unavailable', `Git could not create Attempt worktree '${cwd}'`)
      }
    } else {
      if (!checkout.isDirectory() || checkout.isSymbolicLink()) {
        throw new RepositoryWorkspaceError('owner-conflict', `Attempt checkout '${cwd}' must be a real directory`)
      }
      await this.verifyRecoveredCheckout(repository, cwd, request.target.commit, request.signal)
    }
    return new GitVerificationWorkspaceLease(
      request.ownerAttemptId,
      request.base.repositoryId,
      request.base.commit,
      request.target.commit,
      cwd,
      disposition => this.closeLease(repository, ownerDirectory, cwd, disposition),
    )
  }

  private async closeLease(
    repository: string,
    ownerDirectory: string,
    cwd: string,
    disposition: RepositoryWorkspaceDisposition,
  ): Promise<void> {
    if (disposition === 'preserve') return
    try {
      const owner = await fileStatus(ownerDirectory)
      if (owner === undefined || !owner.isDirectory() || owner.isSymbolicLink()) {
        throw new RepositoryWorkspaceError('cleanup-failed', `Attempt workspace '${ownerDirectory}' is not a real directory`)
      }
      await removeTreeSafe(cwd)
      const removed = await this.runGit(repository, ['worktree', 'remove', '--force', cwd])
      if (removed.outcome.exitCode !== 0 && await this.isRegisteredWorktree(repository, cwd)) {
        const pruned = await this.runGit(repository, ['worktree', 'prune', '--expire=now'])
        if (pruned.outcome.exitCode !== 0 || await this.isRegisteredWorktree(repository, cwd)) {
          throw new RepositoryWorkspaceError('cleanup-failed', `Git retained Attempt worktree registration '${cwd}'`)
        }
      }
      const marker = join(ownerDirectory, 'lease.json')
      const markerStatus = await fileStatus(marker)
      if (markerStatus === undefined || (!markerStatus.isFile() && !markerStatus.isSymbolicLink())) {
        throw new RepositoryWorkspaceError('cleanup-failed', `Attempt workspace '${ownerDirectory}' has no removable marker`)
      }
      await unlink(marker)
      await rmdir(ownerDirectory)
    } catch (error) {
      if (error instanceof RepositoryWorkspaceError && error.code === 'cleanup-failed') throw error
      throw new RepositoryWorkspaceError('cleanup-failed', `cannot remove Attempt workspace '${cwd}'`, { cause: error })
    }
  }

  private async isRegisteredWorktree(repository: string, cwd: string): Promise<boolean> {
    const listed = await this.runGit(repository, ['worktree', 'list', '--porcelain', '-z'])
    if (listed.outcome.exitCode !== 0) {
      throw new RepositoryWorkspaceError('cleanup-failed', 'Git could not inspect worktree registrations')
    }
    const records = new TextDecoder('utf-8', { fatal: true }).decode(listed.stdout).split('\0')
    return records.some(record => record.startsWith('worktree ') && samePath(record.slice('worktree '.length), cwd))
  }

  private async createCheckpoint(
    repositoryId: RepositoryId,
    repository: string,
    cwd: string,
    baseCommit: GitCommitIdType,
    request: CreateCheckpointRequest,
  ): Promise<RepositoryCheckpoint> {
    try {
      request.signal?.throwIfAborted()
      await this.verifyRecoveredCheckout(repository, cwd, baseCommit, request.signal)
      const added = await this.runGit(cwd, ['add', '--all', '--'], request.signal)
      if (added.outcome.exitCode !== 0) {
        throw new RepositoryWorkspaceError('checkpoint-failed', `Git could not stage checkpoint '${cwd}'`)
      }
      const committed = await this.runGit(cwd, [
        '-c',
        'user.name=DeepSeek Harness Delivery',
        '-c',
        'user.email=delivery@local.invalid',
        '-c',
        'commit.gpgSign=false',
        'commit',
        '--no-gpg-sign',
        '--no-verify',
        '--allow-empty',
        '-m',
        request.message,
      ], request.signal)
      if (committed.outcome.exitCode !== 0) {
        throw new RepositoryWorkspaceError('checkpoint-failed', `Git could not create checkpoint '${cwd}'`)
      }
      const checkpointCommit = await this.resolveCommit(cwd, 'HEAD', request.signal, 'checkpoint-failed')
      const ancestry = await this.runGit(cwd, ['merge-base', '--is-ancestor', baseCommit, checkpointCommit], request.signal)
      if (ancestry.outcome.exitCode !== 0) {
        throw new RepositoryWorkspaceError('checkpoint-failed', 'checkpoint does not descend from its lease base')
      }
      const diff = await this.runGit(cwd, [
        'diff',
        '--name-only',
        '--no-renames',
        '-z',
        baseCommit,
        checkpointCommit,
        '--',
      ], request.signal)
      if (diff.outcome.exitCode !== 0) {
        throw new RepositoryWorkspaceError('checkpoint-failed', 'Git could not derive checkpoint changed paths')
      }
      const status = await this.runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], request.signal)
      if (status.outcome.exitCode !== 0 || status.stdout.byteLength !== 0) {
        throw new RepositoryWorkspaceError('checkpoint-failed', 'checkpoint worktree is not clean')
      }
      return Object.freeze({
        repositoryId,
        baseCommit,
        checkpointCommit,
        changedPaths: Object.freeze(decodeGitPaths(diff.stdout)),
        clean: true,
        descendsFromBase: true,
      })
    } catch (error) {
      request.signal?.throwIfAborted()
      if (error instanceof RepositoryWorkspaceError && error.code === 'checkpoint-failed') throw error
      throw new RepositoryWorkspaceError('checkpoint-failed', `cannot create governed checkpoint in '${cwd}'`, { cause: error })
    }
  }

  private async ensureLeaseDirectory(ownerDirectory: string, marker: LeaseMarker): Promise<void> {
    const staging = join(this.worktreeRoot, `.lease-${randomUUID()}`)
    const markerName = 'lease.json'
    try {
      await mkdir(staging, { mode: 0o700 })
      await writeFile(join(staging, markerName), `${canonicalJson(marker)}\n`, { flag: 'wx', mode: 0o600 })
      try {
        await rename(staging, ownerDirectory)
      } catch (error) {
        /* v8 ignore next -- a rename failure without a competing owner directory requires a host filesystem fault. */
        if (await fileStatus(ownerDirectory) === undefined) throw error
      }
    } finally {
      /* v8 ignore next 3 -- the private staging marker is present or already moved; other unlink outcomes require an OS fault. */
      await unlink(join(staging, markerName)).catch((error: unknown) => {
        if (!isCode(error, 'ENOENT')) throw error
      })
      /* v8 ignore next 3 -- the private staging directory is present or already moved; other rmdir outcomes require an OS fault. */
      await rmdir(staging).catch((error: unknown) => {
        if (!isCode(error, 'ENOENT')) throw error
      })
    }

    const ownerStatus = await fileStatus(ownerDirectory)
    if (ownerStatus === undefined || !ownerStatus.isDirectory() || ownerStatus.isSymbolicLink()) {
      throw new RepositoryWorkspaceError('owner-conflict', `Attempt workspace '${ownerDirectory}' must be a real directory`)
    }
    const markerPath = join(ownerDirectory, markerName)
    const markerStatus = await fileStatus(markerPath)
    if (markerStatus === undefined || !markerStatus.isFile() || markerStatus.isSymbolicLink()) {
      throw new RepositoryWorkspaceError('owner-conflict', `Attempt workspace '${ownerDirectory}' has no safe ownership marker`)
    }
    let stored: unknown
    try {
      stored = JSON.parse(await readFile(markerPath, 'utf8'))
    } catch (error) {
      throw new RepositoryWorkspaceError('owner-conflict', `Attempt workspace '${ownerDirectory}' has an invalid marker`, { cause: error })
    }
    if (canonicalJson(stored) !== canonicalJson(marker)) {
      throw new RepositoryWorkspaceError('owner-conflict', 'one Attempt owner cannot identify different repository workspaces')
    }
  }

  private async verifyRecoveredCheckout(
    repository: string,
    cwd: string,
    expectedCommit: GitCommitIdType,
    signal?: AbortSignal,
  ): Promise<void> {
    const head = await this.resolveCommit(cwd, 'HEAD', signal, 'revision-not-found')
    if (head !== expectedCommit) {
      throw new RepositoryWorkspaceError('owner-conflict', `Attempt checkout '${cwd}' has another HEAD`)
    }
    const toplevel = await this.runGit(cwd, ['rev-parse', '--show-toplevel'], signal)
    const resolvedTop = await realpath(new TextDecoder().decode(toplevel.stdout).trim())
    /* v8 ignore next 3 -- requires replacement or corruption after HEAD was resolved in this checkout. */
    if (toplevel.outcome.exitCode !== 0 || resolvedTop !== await realpath(cwd)) {
      throw new RepositoryWorkspaceError('owner-conflict', `Attempt checkout '${cwd}' has another Git toplevel`)
    }
    if (await this.commonGitDirectory(repository, signal) !== await this.commonGitDirectory(cwd, signal)) {
      throw new RepositoryWorkspaceError('repository-mismatch', `Attempt checkout '${cwd}' belongs to another repository`)
    }
  }

  private async commonGitDirectory(repository: string, signal?: AbortSignal): Promise<string> {
    const result = await this.runGit(repository, ['rev-parse', '--git-common-dir'], signal)
    /* v8 ignore next 3 -- requires replacement or corruption after callers resolved HEAD and toplevel. */
    if (result.outcome.exitCode !== 0) {
      throw new RepositoryWorkspaceError('repository-not-found', `Git cannot resolve repository identity for '${repository}'`)
    }
    const value = new TextDecoder().decode(result.stdout).trim()
    return await realpath(isAbsolute(value) ? value : resolve(repository, value))
  }

  private async ensureRealDirectory(path: string): Promise<void> {
    try {
      await mkdir(path, { recursive: true, mode: 0o700 })
      const status = await lstat(path)
      if (!status.isDirectory() || status.isSymbolicLink()) {
        throw new RepositoryWorkspaceError('unavailable', `worktree path '${path}' must be a real directory`)
      }
    } catch (error) {
      if (error instanceof RepositoryWorkspaceError) throw error
      throw new RepositoryWorkspaceError('unavailable', `cannot prepare worktree path '${path}'`, { cause: error })
    }
  }

  private async resolveCommit(
    repository: string,
    revision: string,
    signal: AbortSignal | undefined,
    missingCode: 'revision-not-found' | 'reference-not-found' | 'checkpoint-failed',
  ): Promise<GitCommitIdType> {
    const result = await this.runGit(repository, [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${revision}^{commit}`,
    ], signal)
    if (result.outcome.exitCode !== 0) {
      throw new RepositoryWorkspaceError(missingCode, `Git cannot resolve '${revision}' as a full commit in '${repository}'`)
    }
    try {
      const value = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout).trim()
      return GitCommitId(value)
    } catch (error) {
      throw new RepositoryWorkspaceError(missingCode, `Git returned an invalid commit id for '${revision}'`, { cause: error })
    }
  }

  private async runGit(
    repository: string,
    args: readonly string[],
    signal?: AbortSignal,
    stdoutMaxBytes = this.maxGitOutputBytes,
  ): Promise<GitResult> {
    signal?.throwIfAborted()
    let handle: SubprocessHandle
    try {
      const executable = await this.context.subprocess.resolveExecutable('git', undefined, signal)
      handle = this.context.subprocess.spawn({
        argv: [executable, '-C', repository, ...args],
        cwd: dirname(repository),
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
        graceMs: this.graceMs,
        signal,
      })
    } catch (error) {
      signal?.throwIfAborted()
      throw new RepositoryWorkspaceError('unavailable', `Git subprocess could not start in '${repository}'`, { cause: error })
    }
    try {
      try {
        const [stdout, stderr, outcome] = await Promise.all([
          collect(handle.stdout, stdoutMaxBytes, () => { handle.terminate() }),
          collect(handle.stderr, this.maxGitOutputBytes, () => { handle.terminate() }),
          handle.done,
        ])
        signal?.throwIfAborted()
        return {
          outcome,
          stdout,
          stderr: new TextDecoder().decode(stderr),
        }
      } catch (error) {
        signal?.throwIfAborted()
        if (error instanceof RepositoryWorkspaceError) throw error
        throw new RepositoryWorkspaceError('unavailable', `Git subprocess failed in '${repository}'`, { cause: error })
      }
    } finally {
      await handle.waitForExit()
    }
  }
}

class GitChangeWorkspaceLease implements ChangeWorkspaceLease {
  private closed: RepositoryWorkspaceDisposition | undefined
  private checkpointStarted = false
  private active: Promise<void> = Promise.resolve()
  private closing: { readonly disposition: RepositoryWorkspaceDisposition; readonly promise: Promise<void> } | undefined

  constructor(
    readonly ownerAttemptId: QueueAttemptIdRef,
    readonly repositoryId: RepositoryId,
    readonly baseCommit: GitCommitIdType,
    readonly cwd: string,
    private readonly createCheckpoint: (request: CreateCheckpointRequest) => Promise<RepositoryCheckpoint>,
    private readonly closeWorkspace: (disposition: RepositoryWorkspaceDisposition) => Promise<void>,
  ) {}

  checkpoint(request: CreateCheckpointRequest): Promise<RepositoryCheckpoint> {
    if (request.message.trim().length === 0) {
      return Promise.reject(new RepositoryWorkspaceError('checkpoint-failed', 'checkpoint message must be non-blank'))
    }
    if (this.closed !== undefined || this.closing !== undefined || this.checkpointStarted) {
      return Promise.reject(new RepositoryWorkspaceError('checkpoint-failed', 'change workspace cannot create another checkpoint'))
    }
    this.checkpointStarted = true
    const operation = this.active.then(async () => await this.createCheckpoint(request))
    this.active = operation.then(() => undefined, () => undefined)
    return operation
  }

  close(disposition: RepositoryWorkspaceDisposition): Promise<void> {
    if (this.closed !== undefined) {
      return this.closed === disposition
        ? Promise.resolve()
        : Promise.reject(new RepositoryWorkspaceError('owner-conflict', 'workspace was already closed with another disposition'))
    }
    if (this.closing !== undefined) {
      return this.closing.disposition === disposition
        ? this.closing.promise
        : Promise.reject(new RepositoryWorkspaceError('owner-conflict', 'workspace is closing with another disposition'))
    }
    const promise = this.active.then(async () => {
      await this.closeWorkspace(disposition)
      this.closed = disposition
    })
    this.closing = { disposition, promise }
    return promise
  }
}

class GitVerificationWorkspaceLease implements VerificationWorkspaceLease {
  private closed: RepositoryWorkspaceDisposition | undefined
  private closing: { readonly disposition: RepositoryWorkspaceDisposition; readonly promise: Promise<void> } | undefined

  constructor(
    readonly ownerAttemptId: QueueAttemptIdRef,
    readonly repositoryId: RepositoryId,
    readonly baseCommit: GitCommitIdType,
    readonly targetCommit: GitCommitIdType,
    readonly cwd: string,
    private readonly closeWorkspace: (disposition: RepositoryWorkspaceDisposition) => Promise<void>,
  ) {}

  close(disposition: RepositoryWorkspaceDisposition): Promise<void> {
    if (this.closed !== undefined) {
      return this.closed === disposition
        ? Promise.resolve()
        : Promise.reject(new RepositoryWorkspaceError('owner-conflict', 'workspace was already closed with another disposition'))
    }
    if (this.closing !== undefined) {
      return this.closing.disposition === disposition
        ? this.closing.promise
        : Promise.reject(new RepositoryWorkspaceError('owner-conflict', 'workspace is closing with another disposition'))
    }
    const promise = this.closeWorkspace(disposition).then(() => { this.closed = disposition })
    this.closing = { disposition, promise }
    return promise
  }
}

async function collect(stream: Readable | undefined, maxBytes: number, overflow: () => void): Promise<Uint8Array> {
  if (stream === undefined) throw new Error('Git subprocess did not expose a piped stream')
  const chunks: Uint8Array[] = []
  let byteLength = 0
  for await (const chunk of stream) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk)
    byteLength += bytes.byteLength
    if (byteLength > maxBytes) {
      overflow()
      throw new RepositoryWorkspaceError('unavailable', `Git output exceeds ${String(maxBytes)} bytes`)
    }
    chunks.push(bytes)
  }
  const output = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function decodeGitPaths(bytes: Uint8Array): RepositoryRangeFacts['changedPaths'] {
  if (bytes.byteLength === 0) return []
  if (bytes[bytes.byteLength - 1] !== 0) {
    throw new RepositoryWorkspaceError('unavailable', 'Git changed-path output is not NUL terminated')
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, -1))
    return [...new Set(text.split('\0').map(path => RepositoryRelativePath(path)))].sort()
  } catch (error) {
    throw new RepositoryWorkspaceError('unavailable', 'Git returned an invalid changed-path set', { cause: error })
  }
}

function ownerHash(ownerAttemptId: QueueAttemptIdRef): string {
  return createHash('sha256').update(ownerAttemptId, 'utf8').digest('hex')
}

function isCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}

async function fileStatus(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    /* v8 ignore next 2 -- non-ENOENT lstat failures require a host filesystem or permission fault. */
    if (!isCode(error, 'ENOENT')) throw error
    return undefined
  }
}

async function removeTreeSafe(path: string): Promise<void> {
  const status = await fileStatus(path)
  if (status === undefined) return
  if (status.isSymbolicLink() || !status.isDirectory()) {
    await unlink(path)
    return
  }
  for (const name of await readdir(path)) await removeTreeSafe(join(path, name))
  await rmdir(path)
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  /* v8 ignore next 3 -- path case semantics are selected by the native host; each platform executes its own branch. */
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

export default GitLocalRepositoryWorkspace

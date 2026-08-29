/** Local Git repository-workspace provider scaffold. @module @deepseek-ai/dsh-repo-workspace-git-local */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  RepositoryWorkspace,
  RepositoryWorkspaceError,
} from '@deepseek-ai/dsh-repo-workspace'
import type {
  ChangeWorkspaceLease,
  InspectRepositoryRangeRequest,
  InspectRepositoryRevisionRequest,
  OpenChangeWorkspaceRequest,
  OpenVerificationWorkspaceRequest,
  ReadRepositoryBlobRequest,
  RepositoryRangeFacts,
  ResolveRepositoryBaseRequest,
  VerificationWorkspaceLease,
  VerifiedRepositoryBase,
  VerifiedRepositoryBlob,
  VerifiedRepositoryRevision,
} from '@deepseek-ai/dsh-repo-workspace'
import type {} from '@deepseek-ai/dsh-subprocess'

const UNAVAILABLE = 'repo-workspace-git-local is unavailable because Git ownership is not implemented'

/** Configured repository identities and the isolated worktree parent. */
export interface Config {
  /** Closed map from stable repository id to its local Git checkout root. */
  readonly repositories: Readonly<Record<string, string>>
  /** Directory below which attempt-owned worktrees are created. */
  readonly worktreeRoot: string
}

/** Loader configuration schema. */
export const Config: z<Config> = z.object({
  repositories: z.dict(z.string()).required(),
  worktreeRoot: z.string().required(),
})

/** Git/Subprocess-backed provider selected for local MVP repositories. */
export class GitLocalRepositoryWorkspace extends RepositoryWorkspace {
  /** Git commands execute only through the governed Subprocess service. */
  static inject = ['subprocess']
  static Config = Config

  constructor(ctx: Context, config: Config) {
    super(ctx)
    void config
  }

  private unavailable(): RepositoryWorkspaceError {
    return new RepositoryWorkspaceError('unavailable', UNAVAILABLE)
  }

  resolveBase(_request: ResolveRepositoryBaseRequest): Promise<VerifiedRepositoryBase> {
    return Promise.reject(this.unavailable())
  }

  inspectRevision(_request: InspectRepositoryRevisionRequest): Promise<VerifiedRepositoryRevision> {
    return Promise.reject(this.unavailable())
  }

  readBlob(_request: ReadRepositoryBlobRequest): Promise<VerifiedRepositoryBlob> {
    return Promise.reject(this.unavailable())
  }

  inspectRange(_request: InspectRepositoryRangeRequest): Promise<RepositoryRangeFacts> {
    return Promise.reject(this.unavailable())
  }

  openChange(_request: OpenChangeWorkspaceRequest): Promise<ChangeWorkspaceLease> {
    return Promise.reject(this.unavailable())
  }

  openVerification(_request: OpenVerificationWorkspaceRequest): Promise<VerificationWorkspaceLease> {
    return Promise.reject(this.unavailable())
  }
}

export default GitLocalRepositoryWorkspace

/** Host Workspace Remote owner: explicit commands and reconnect-safe state. */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { ProjectResources, type ResourceOptions } from './resources.ts'
import type { ResourceId, ResourceInput, ResourceList, ResourceView, ResourceFile } from './types.ts'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceCommands } from './commands.ts'
import { DirectoryPickerController } from './directory-picker.ts'
import { WorkspaceFeed } from './feed.ts'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceFollowFrame,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceRenameRequest,
  WorkspaceValue,
} from './types.ts'

export type * from './types.ts'
export { DirectoryPickerController } from './directory-picker.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Workspace business API and Remote namespace owner. */
    workspaceController: WorkspaceController
  }
}

/** Host service backing the generated `ctx.remote.workspace` namespace. */
export class WorkspaceController extends TypertRemoteService {
  static inject = ['typert', 'workspaceRegistry']
  static Config = z.object({
    resourceMaxBytes: z.natural().min(1024).default(262144),
    resourceLogBytes: z.natural().min(2).default(65536),
    resourceGraceMs: z.natural().min(1).max(2147483647).default(2000),
  })

  private readonly commands: WorkspaceCommands
  private readonly feed: WorkspaceFeed
  private readonly resources: ProjectResources

  /**
   * @param ctx - Host context containing the Workspace registry.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'workspaceController', { namespace: 'workspace' })
    this.commands = new WorkspaceCommands(ctx)
    this.feed = new WorkspaceFeed(ctx)
    const options: ResourceOptions = {
      maxBytes: config.resourceMaxBytes ?? 262144,
      logBytes: config.resourceLogBytes ?? 65536,
      graceMs: config.resourceGraceMs ?? 2000,
    }
    this.resources = new ProjectResources((id) => {
      const workspace = ctx.workspaceRegistry.get(id)
      if (workspace === undefined) throw new Error(`Unknown workspace: ${id}`)
      return workspace.path
    }, () => {
      const subprocess = ctx.get('subprocess')
      if (subprocess === undefined) throw new Error('Local subprocess provider is unavailable')
      return subprocess
    }, options)
    ctx.effect(() => () => this.resources.dispose(), 'workspace.resources')
    // This package is the Loader entry for both Remote owners it hosts: the
    // directory-picking seam is abstract and never an entry itself. The child
    // stays pending until a picking backend is composed, so a host without one
    // registers no picking namespace instead of answering an unservable verb.
    ctx.plugin(DirectoryPickerController)
  }

  /**
   * Read project resource configuration and process observations.
   * @param workspaceId - registered project.
   * @returns saved resources and configuration path.
   */
  @Remote('resourcesList')
  resourcesList(workspaceId: WorkspaceId): Promise<ResourceList> { return this.resources.list(workspaceId) }

  /**
   * Add a Markdown note, file reference or manual service recipe.
   * @param workspaceId - registered project.
   * @param input - human-authored resource.
   * @returns saved entry.
   */
  @Remote('resourcesAdd')
  resourcesAdd(workspaceId: WorkspaceId, input: ResourceInput): Promise<ResourceView> { return this.resources.add(workspaceId, input) }

  /**
   * Preview a bounded plain-text project file.
   * @param workspaceId - registered project.
   * @param id - resource identity.
   * @returns resolved path and plain text.
   */
  @Remote('resourcesRead')
  resourcesRead(workspaceId: WorkspaceId, id: ResourceId): Promise<ResourceFile> { return this.resources.read(workspaceId, id) }

  /**
   * Remove an entry while retaining its files.
   * @param workspaceId - registered project.
   * @param id - stopped resource identity.
   */
  @Remote('resourcesRemove')
  resourcesRemove(workspaceId: WorkspaceId, id: ResourceId): Promise<void> { return this.resources.remove(workspaceId, id) }

  /**
   * Start an owned local service without tying it to a Session.
   * @param workspaceId - registered project.
   * @param id - service identity.
   * @returns process observation, not a health guarantee.
   */
  @Remote('resourcesStart')
  resourcesStart(workspaceId: WorkspaceId, id: ResourceId): Promise<ResourceView> { return this.resources.start(workspaceId, id) }

  /**
   * Stop an owned service and await its process tree.
   * @param workspaceId - registered project.
   * @param id - service identity.
   */
  @Remote('resourcesStop')
  resourcesStop(workspaceId: WorkspaceId, id: ResourceId): Promise<void> { return this.resources.stop(workspaceId, id) }

  /**
   * Create or idempotently resolve one Workspace over an existing directory.
   * @param request - directory path to register.
   * @returns the Workspace and whether this call created it.
   */
  @Remote('create')
  create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    return this.commands.create(request)
  }

  /**
   * Rename one Workspace to a unique non-blank title.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   */
  @Remote('rename')
  rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    return this.commands.rename(request)
  }

  /**
   * Remove one Workspace registration while retaining files and Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   */
  @Remote('delete')
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.commands.delete(request)
  }

  /**
   * Move one Workspace within the registry display order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   */
  @Remote('insertBefore')
  insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    return this.commands.insertBefore(request)
  }

  /**
   * Move one accounted Session within a Workspace.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   */
  @Remote('insertSessionBefore')
  insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    return this.commands.insertSessionBefore(request)
  }

  /**
   * Hide one known Session from Workspace grouping surfaces.
   * @param request - Session identity to archive.
   * @returns the complete resulting archive set.
   */
  @Remote('archiveSession')
  archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    return this.commands.archiveSession(request)
  }

  /**
   * Stream a complete Workspace baseline followed by ordered increments.
   * @param signal - generation cancellation.
   * @returns baseline followed by ordered Workspace increments.
   */
  @Remote({ mode: 'stream' })
  follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    return this.feed.follow(signal)
  }
}

export default WorkspaceController

/** Project resource storage, preview, output and shutdown bounds. */
export interface Config {
  /** Maximum bytes in a resource configuration or text preview. */
  resourceMaxBytes?: number
  /** Combined retained stdout and stderr bytes per service. */
  resourceLogBytes?: number
  /** Grace before process-tree termination escalates. */
  resourceGraceMs?: number
}

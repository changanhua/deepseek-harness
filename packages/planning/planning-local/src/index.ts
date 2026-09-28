import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import Planning, {
  PlanningError,
  planningCommandSchema,
  planningLinkHandoffSchema,
  planningPrepareHandoffSchema,
} from '@changanhua/dsh-planning'
import type {
  LinkDeliveryHandoffInput,
  PlanningAccess,
  PlanningBoardSnapshot,
  PlanningCommand,
  PlanningHandoff,
  PlanningMutationResult,
  PlanningSourceInput,
  PrepareDeliveryHandoffInput,
} from '@changanhua/dsh-planning/types'
import { capturePlanningSources } from './sources.ts'
import { PlanningStore } from './store.ts'
import { acquirePlanningOwnership } from './ownership.ts'

/** Configuration for one local Planning provider. */
export interface LocalPlanningConfig {
  /** Required absolute directory used to acquire the single-Host ownership lock. */
  readonly ownershipRoot: string
  /** Maximum serialized bytes for one Board; writes over this bound reject before commit. */
  readonly maxBoardBytes?: number
}

/** Local durable provider. The source reader is a trusted Host service, never wire input. */
export class LocalPlanning extends Planning {
  static inject = ['storageDomain', 'workspaceRegistry', 'sessionQuery']
  private store?: PlanningStore
  private ownership?: { release(): Promise<void> }
  private pending = new Set<Promise<unknown>>()
  private closing = false
  static Config: z<LocalPlanningConfig, Required<LocalPlanningConfig>> = z.object({
    ownershipRoot: z.string().required(),
    maxBoardBytes: z
      .number()
      .step(1)
      .min(1024)
      .max(64 * 1024 * 1024)
      .default(2 * 1024 * 1024),
  })
  private readonly config: { ownershipRoot: string; maxBoardBytes: number }
  constructor(ctx: import('@deepseek-ai/cordis').Context, config: LocalPlanningConfig) {
    super(ctx)
    this.config = LocalPlanning.Config(config)
  }
  protected async [Service.init](): Promise<void> {
    this.ownership = await acquirePlanningOwnership(this.config.ownershipRoot)
    try {
      this.store = await PlanningStore.open(this.ctx.storageDomain, { maxBytes: this.config.maxBoardBytes })
    } catch (error) {
      await this.ownership.release()
      throw error
    }
    this.ctx.effect(
      () => async () => {
        this.closing = true
        await Promise.allSettled([...this.pending])
        await this.store?.close()
        await this.ownership?.release()
      },
      'planning local storage',
    )
  }
  async snapshot(access: PlanningAccess, signal?: AbortSignal): Promise<PlanningBoardSnapshot> {
    return this.use(async (store) => {
      signal?.throwIfAborted()
      await access.authorize()
      this.requireWorkspace(access.workspaceId)
      const snapshot = store.snapshot(access.workspaceId)
      await access.authorize()
      signal?.throwIfAborted()
      return snapshot
    })
  }
  async execute(
    access: PlanningAccess,
    command: PlanningCommand,
    signal?: AbortSignal,
  ): Promise<PlanningMutationResult> {
    return this.use(async (store) => {
      signal?.throwIfAborted()
      await access.authorize()
      this.requireWorkspace(access.workspaceId)
      const parsed = planningCommandSchema.safeParse(command)
      if (!parsed.success) throw new PlanningError('invalid-reference', 'invalid planning command')
      const replay = store.replay(access.workspaceId, parsed.data)
      if (replay !== undefined) return replay
      await this.authorizeCommand(access, parsed.data)
      const sourceInputs = this.sourceInputsFor(access, parsed.data)
      const sources =
        sourceInputs === undefined
          ? []
          : await capturePlanningSources(
            this.ctx.sessionQuery,
            this.ctx.get('content'),
            access.workspaceId,
            this.requireWorkspace(access.workspaceId).sessionIds,
            sourceInputs,
            signal,
            this.ctx.get('attachments'),
          )
      await access.authorize()
      this.requireWorkspace(access.workspaceId)
      signal?.throwIfAborted()
      return store.execute(
        access.workspaceId,
        {
          kind: access.kind,
          id: access.actorId,
          ...(access.userMessage === undefined ? {} : { userMessage: access.userMessage }),
        },
        parsed.data,
        sources,
        () => access.authorize(),
        signal,
      )
    })
  }
  async prepareDeliveryHandoff(
    access: PlanningAccess,
    input: PrepareDeliveryHandoffInput,
    signal?: AbortSignal,
  ): Promise<PlanningHandoff> {
    return this.use(async (store) => {
      signal?.throwIfAborted()
      await access.authorize()
      this.requireWorkspace(access.workspaceId)
      const parsed = planningPrepareHandoffSchema.safeParse(input)
      if (!parsed.success) throw new PlanningError('invalid-reference', 'invalid handoff input')
      await this.authorizeDirectMutation(access)
      return store.prepareHandoff(
        access.workspaceId,
        {
          kind: access.kind,
          id: access.actorId,
          ...(access.userMessage === undefined ? {} : { userMessage: access.userMessage }),
        },
        parsed.data,
        () => access.authorize(),
        signal,
      )
    })
  }
  async linkDeliveryHandoff(
    access: PlanningAccess,
    input: LinkDeliveryHandoffInput,
    signal?: AbortSignal,
  ): Promise<PlanningHandoff> {
    return this.use(async (store) => {
      signal?.throwIfAborted()
      await access.authorize()
      this.requireWorkspace(access.workspaceId)
      if (access.kind !== 'bridge') throw new PlanningError('unauthorized', 'only bridge may link handoffs')
      const parsed = planningLinkHandoffSchema.safeParse(input)
      if (!parsed.success) throw new PlanningError('invalid-reference', 'invalid handoff link')
      return store.linkHandoff(
        access.workspaceId,
        { kind: access.kind, id: access.actorId },
        parsed.data,
        () => access.authorize(),
        signal,
      )
    })
  }
  /** Enforce trusted caller kind and the exact persisted direct user message required for agent mutations. */
  private async authorizeCommand(access: PlanningAccess, command: PlanningCommand): Promise<void> {
    if (command.kind !== 'propose') await this.authorizeDirectMutation(access)
  }
  private async authorizeDirectMutation(access: PlanningAccess): Promise<void> {
    if (access.kind === 'bridge')
      throw new PlanningError('unauthorized', 'bridge access may not initiate direct planning mutations')
    if (access.kind === 'agent') {
      const userMessage = access.userMessage
      if (
        userMessage === undefined ||
        !this.requireWorkspace(access.workspaceId).sessionIds.includes(SessionId(userMessage.sessionId))
      )
        throw new PlanningError('unauthorized', 'agent mutation needs a current project user message')
      const event = await this.ctx.sessionQuery.readEvent({
        sessionId: SessionId(userMessage.sessionId),
        seq: SessionSeq(userMessage.seq),
        before: 0,
        after: 0,
      })
      const data = event.target.data as { source?: { kind?: unknown } }
      if (event.target.type !== 'user/message' || data.source?.kind !== 'user')
        throw new PlanningError('unauthorized', 'agent mutation needs a direct user message')
    }
  }
  /** Agent-authored revisions retain the user message that authorized the mutation as verified provenance. */
  private sourceInputsFor(access: PlanningAccess, command: PlanningCommand): readonly PlanningSourceInput[] | undefined {
    const sourceInputs =
      command.kind === 'create' || command.kind === 'revise'
        ? command.sources
        : command.kind === 'propose'
          ? command.draft.sources
          : undefined
    if (sourceInputs === undefined || access.kind !== 'agent' || access.userMessage === undefined) return sourceInputs
    // Proposal provenance is intentionally supplied by its draft. Direct agent mutations must also retain the
    // exact user message that authorized them, without changing the command used for the receipt digest.
    if (command.kind !== 'create' && command.kind !== 'revise') return sourceInputs
    const current = { kind: 'session-event' as const, ...access.userMessage }
    if (
      sourceInputs.some(
        source =>
          source.kind === 'session-event' &&
          source.sessionId === current.sessionId &&
          source.seq === current.seq,
      )
    )
      return sourceInputs
    if (sourceInputs.length >= 20)
      throw new PlanningError('capacity-exceeded', 'planning source limit reached while adding the current user message')
    return [...sourceInputs, current]
  }
  private requireWorkspace(id: string) {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(id))
    if (workspace === undefined) throw new PlanningError('not-found', 'planning Workspace is unavailable')
    return workspace
  }
  private use<T>(operation: (store: PlanningStore) => Promise<T>): Promise<T> {
    const store = this.store
    if (store === undefined || this.closing)
      return Promise.reject(new PlanningError('closed', 'planning is unavailable'))
    const pending = Promise.resolve().then(() => operation(store))
    this.pending.add(pending)
    void pending.then(
      () => this.pending.delete(pending),
      () => this.pending.delete(pending),
    )
    return pending
  }
}
export default LocalPlanning

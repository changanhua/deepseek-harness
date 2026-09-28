import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { type CreateDeliveryCaseRequest } from '@changanhua/dsh-delivery'
import { RepositoryId, AcceptanceClauseId } from '@changanhua/dsh-delivery-protocol'
import { PlanningError, type PlanningAccess, type PlanningHandoff } from '@changanhua/dsh-planning'
import { WorkspaceId, realpathNormalize } from '@deepseek-ai/dsh-workspace'

export interface PlanningDeliveryRoute {
  /** Canonical Workspace path after startup normalization. */
  readonly workspacePath: string
  /** Delivery repository that receives handoffs from this exact Workspace path. */
  readonly repositoryId: string
}
export interface PlanningDeliveryConfig {
  /** Fixed Delivery origin actor; browser or model input cannot override it. */
  readonly operatorId?: string
  /** Exact Workspace-path to Delivery-repository routes; an unmatched Workspace rejects handoff. */
  readonly routes: readonly PlanningDeliveryRoute[]
}
export interface PlanningDeliveryHandoffInput {
  readonly itemId: string
  readonly expectedRevisionId: string
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    planningDelivery: PlanningDelivery
  }
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sourceDigest = (source: unknown) => digest(source)

/** Pure v1 mapper: preserve agreed product scope while leaving base and verification choices explicit. */
export function mapPlanningHandoff(
  handoff: Pick<PlanningHandoff, 'itemId' | 'revisionId' | 'repositoryId' | 'operatorId' | 'source'>,
): Omit<CreateDeliveryCaseRequest, 'idempotencyKey'> {
  const source = handoff.source
  return {
    repositoryId: RepositoryId(handoff.repositoryId),
    origin: { kind: 'human', actorId: handoff.operatorId },
    title: source.title,
    revision: {
      outcome: source.intent,
      context: JSON.stringify({
        planningItemId: handoff.itemId,
        planningRevisionId: handoff.revisionId,
        scope: source.scope,
        sources: source.sources,
      }),
      allowedScope: [...source.scope],
      forbiddenScope: [],
      acceptanceClauses: source.acceptance.map((text, index) => ({
        id: AcceptanceClauseId(`planning-${handoff.revisionId}-acceptance-${index}`),
        text,
      })),
      openDecisions: [],
      baseSelectionRule: null,
      verificationSource: null,
      referenceLinks: source.sources
        .filter((value): value is Extract<typeof value, { readonly kind: 'link' }> => value.kind === 'link')
        .map(value => ({ url: value.url, label: value.label })),
    },
  }
}

/**
 * Host-only Planning-to-Delivery bridge. It freezes a Planning revision before it creates or
 * links a recoverable shaping Case; it neither approves requirements nor accepts execution.
 */
export class PlanningDelivery extends Service {
  static inject = ['planning', 'delivery', 'workspaceRegistry']
  static Config = z.object({
    operatorId: z.string().default('local-operator'),
    routes: z
      .array(z.object({ workspacePath: z.string().required(), repositoryId: z.string().required() }))
      .default([]),
  })
  private readonly config: { operatorId: string; routes: PlanningDeliveryRoute[] }
  constructor(ctx: Context, config: PlanningDeliveryConfig) {
    super(ctx, 'planningDelivery')
    this.config = PlanningDelivery.Config({
      ...(config.operatorId === undefined ? {} : { operatorId: config.operatorId }),
      routes: [...config.routes],
    })
  }
  protected async [Service.init](): Promise<void> {
    this.config.routes = await Promise.all(
      this.config.routes.map(async route => ({
        ...route,
        workspacePath: await realpathNormalize(route.workspacePath),
      })),
    )
    if (new Set(this.config.routes.map(route => route.workspacePath)).size !== this.config.routes.length)
      throw new PlanningError('conflict', 'planning Delivery routes must be unique after realpath normalization')
  }
  /**
   * Prepare and recoverably link one adopted Planning revision to a Delivery shaping Case.
   * @param access - Trusted Host-derived direct-user authority; the bridge switches only its final link to bridge authority.
   * @param input - Exact Planning item and revision selected for handoff.
   * @param signal - Optional caller lifetime checked before bridge-side work.
   * @returns The prepared or linked durable Planning handoff, including Delivery identities once linked.
   * @throws {PlanningError} When authorization, route, revision, digest, or Delivery linkage is unavailable or conflicts.
   */
  async handoff(
    access: PlanningAccess,
    input: PlanningDeliveryHandoffInput,
    signal?: AbortSignal,
  ): Promise<PlanningHandoff> {
    signal?.throwIfAborted()
    await access.authorize()
    if (input.itemId.trim() === '' || input.expectedRevisionId.trim() === '')
      throw new PlanningError('invalid-reference', 'planning Delivery handoff needs an item and exact revision')
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(access.workspaceId))
    const route =
      workspace === undefined ? undefined : this.config.routes.find(value => value.workspacePath === workspace.path)
    if (route === undefined)
      throw new PlanningError(
        'not-found',
        `planning Delivery route is unavailable for Workspace '${access.workspaceId}'`,
      )
    const snapshot = await this.ctx.planning.snapshot(access, signal)
    let handoff = snapshot.handoffs.find(
      value =>
        value.itemId === input.itemId &&
        value.revisionId === input.expectedRevisionId &&
        value.repositoryId === route.repositoryId,
    )
    if (handoff === undefined) {
      const item = snapshot.items.find(value => value.id === input.itemId)
      const revision = item?.revisions.find(value => value.id === input.expectedRevisionId)
      if (revision === undefined)
        throw new PlanningError('not-found', `planning revision '${input.expectedRevisionId}' is unavailable`)
      const source: PlanningHandoff['source'] = {
        title: revision.title,
        intent: revision.intent,
        scope: revision.scope,
        acceptance: revision.acceptance,
        sources: revision.sources,
      }
      const provisional = mapPlanningHandoff({
        itemId: input.itemId,
        revisionId: input.expectedRevisionId,
        repositoryId: route.repositoryId,
        operatorId: this.config.operatorId,
        source,
      })
      const requestDigest = digest(provisional)
      const key = digest({
        workspaceId: access.workspaceId,
        itemId: input.itemId,
        revisionId: input.expectedRevisionId,
        repositoryId: route.repositoryId,
        mapperVersion: 1,
        requestDigest,
      }).slice(0, 32)
      handoff = await this.ctx.planning.prepareDeliveryHandoff(
        access,
        {
          itemId: input.itemId,
          expectedRevisionId: input.expectedRevisionId,
          repositoryId: route.repositoryId,
          key,
          mapperVersion: 1,
          operatorId: this.config.operatorId,
          deliveryRequestDigest: requestDigest,
        },
        signal,
      )
    } else {
      // Re-enter Planning's idempotent prepare gate even for recovery: it owns
      // direct-user authorization and returns the frozen record without a write.
      handoff = await this.ctx.planning.prepareDeliveryHandoff(
        access,
        {
          itemId: handoff.itemId,
          expectedRevisionId: handoff.revisionId,
          repositoryId: handoff.repositoryId,
          key: handoff.key,
          mapperVersion: handoff.mapperVersion,
          operatorId: handoff.operatorId,
          deliveryRequestDigest: handoff.deliveryRequestDigest,
        },
        signal,
      )
    }
    const mapped = mapPlanningHandoff(handoff)
    if (sourceDigest(handoff.source) !== handoff.sourceDigest || digest(mapped) !== handoff.deliveryRequestDigest)
      throw new PlanningError('conflict', 'planning Delivery handoff digest mismatch')
    if (handoff.phase === 'linked') return handoff
    signal?.throwIfAborted()
    await access.authorize()
    const created = await this.ctx.delivery.createCase({ ...mapped, idempotencyKey: handoff.key })
    return await this.ctx.planning.linkDeliveryHandoff(
      { ...access, kind: 'bridge' },
      { key: handoff.key, caseId: created.case.id, contractRevisionId: created.revision.id },
      signal,
    )
  }
}
export default PlanningDelivery

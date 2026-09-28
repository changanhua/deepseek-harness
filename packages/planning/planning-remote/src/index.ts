/** Project planning browser boundary. @module @changanhua/dsh-planning-remote */
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { PlanningAccess, PlanningHandoff, PlanningMutationResult } from '@changanhua/dsh-planning'
import { PlanningError, planningCommandSchema } from '@changanhua/dsh-planning'
import { planningRemoteFailure, requirePlanningActive } from './failures.ts'
import type {
  PlanningBoardView,
  PlanningEvidenceInput,
  PlanningExecuteInput,
  PlanningExecutionInput,
  PlanningExecutionView,
  PlanningHandoffInput,
  PlanningImageInput,
  PlanningImageView,
} from './types.ts'
import type { PlanningWorkspaceView } from './types.ts'
import type {} from '@changanhua/dsh-planning-delivery-bridge'
import type {
  DeliveryCaseCard,
  DeliveryEvidenceView,
  DeliveryRemoteService,
  DeliverySnapshotView,
} from '@changanhua/dsh-delivery-remote'

/** Host identity used for browser-originated planning edits. */
export interface Config {
  /** Local operator identity; browsers cannot override it. */
  operatorId?: string
}

/** Deployment-owned identity schema. */
export const Config: Schema<Config> = Schema.object({ operatorId: Schema.string().default('local-operator') })

const workspaceIdSchema = z.string().trim().min(1).max(256)
const executeInputSchema = z.strictObject({ workspaceId: workspaceIdSchema, command: planningCommandSchema })
const executionInputSchema = z.strictObject({ workspaceId: workspaceIdSchema, itemId: workspaceIdSchema })
const evidenceInputSchema = executionInputSchema.extend({ evidenceId: workspaceIdSchema })
const handoffInputSchema = executionInputSchema.extend({ expectedRevisionId: workspaceIdSchema })
const imageInputSchema = z.strictObject({ workspaceId: workspaceIdSchema, attachmentId: workspaceIdSchema })

function caseForHandoff(view: DeliverySnapshotView, handoff: PlanningHandoff): DeliveryCaseCard | null {
  if (handoff.caseId === undefined) return null
  const current = view.cases.find(value => String(value.case.id) === handoff.caseId)
  if (current === undefined) return null
  const revisions = new Map([
    ...view.cards.map(card => [String(card.contractRevision.id), card.contractRevision] as const),

    ...view.contractsWithoutPacket.map(revision => [String(revision.id), revision] as const),

    ...view.cases.map(card => [String(card.headRevision.id), card.headRevision] as const),
  ])
  const belongsToHandoff = (revisionId: string): boolean => {
    const seen = new Set<string>()
    let current = revisions.get(revisionId)
    while (current !== undefined && !seen.has(String(current.id))) {
      if (String(current.id) === handoff.contractRevisionId) return true
      seen.add(String(current.id))
      current = current.previousRevisionId === null ? undefined : revisions.get(String(current.previousRevisionId))
    }
    return false
  }
  const packets =
    handoff.contractRevisionId === undefined
      ? []
      : view.cards.filter(card => belongsToHandoff(String(card.contractRevision.id)))
  return { ...current, packets }
}

/** Host contribution for the planning Remote namespace. */
export class PlanningRemoteService extends TypertRemoteService {
  static inject = ['planning', 'workspaceRegistry']
  static Config = Config
  private readonly operatorId: string

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'planningRemote', { namespace: 'planning' })
    this.operatorId = workspaceIdSchema.parse(config.operatorId ?? 'local-operator')
  }

  /**
   * List projects visible to the authenticated local Host user.
   * @param signal - Caller lifetime checked before reading.
   * @returns Stable project ids and labels, without filesystem paths.
   */
  @Remote('workspaces')
  async workspaces(signal: AbortSignal): Promise<PlanningWorkspaceView[]> {
    await Promise.resolve()
    requirePlanningActive(signal)
    try { return this.ctx.workspaceRegistry.list().map(({ id, title }) => ({ id, title })) }
    catch (error) { throw planningRemoteFailure(error, signal) }
  }

  /**
   * Read a detached project Board through the configured provider.
   * @param workspaceId - Project selected by the authenticated local user.
   * @param signal - Caller lifetime, rechecked before returning.
   * @returns Current plan data; private retry receipts are excluded by the domain.
   */
  @Remote('snapshot')
  async snapshot(workspaceId: string, signal: AbortSignal): Promise<PlanningBoardView> {
    requirePlanningActive(signal)
    try {
      const access = this.access(workspaceId, signal)
      const board = await this.ctx.planning.snapshot(access, signal)
      const delivery = this.ctx.get('deliveryRemote') as DeliveryRemoteService | undefined
      if (delivery === undefined) return { ...board, executions: [] }
      let view: DeliverySnapshotView
      try {
        view = delivery.snapshot(signal)
      } catch {
        requirePlanningActive(signal)
        await access.authorize()
        return {
          ...board,
          executions: board.handoffs.flatMap(handoff =>
            handoff.phase !== 'linked' || handoff.caseId === undefined
              ? []
              : [
                {
                  itemId: handoff.itemId,
                  revisionId: handoff.revisionId,
                  caseId: handoff.caseId,
                  stage: 'unavailable',
                  reviewSuggested: false,
                },
              ],
          ),
        }
      }
      await access.authorize()
      return {
        ...board,
        executions: board.handoffs.flatMap((handoff) => {
          if (handoff.phase !== 'linked' || handoff.caseId === undefined) return []
          const deliveryCase = caseForHandoff(view, handoff)
          return [
            {
              itemId: handoff.itemId,
              revisionId: handoff.revisionId,
              caseId: handoff.caseId,
              stage: deliveryCase?.lane ?? 'unavailable',
              reviewSuggested:
                deliveryCase?.packets.some(
                  packet =>
                    packet.completionClaim !== null ||
                    packet.verificationVerdict !== null ||
                    packet.acceptanceDecision !== null,
                ) ?? false,
            },
          ]
        }),
      }
    } catch (error) {
      throw planningRemoteFailure(error, signal)
    }
  }

  /** Resolve the owning project's Board for a conversation image capture. */
  @Remote('sessionBoard')
  async sessionBoard(sessionId: string, signal: AbortSignal): Promise<PlanningBoardView> {
    requirePlanningActive(signal)
    try {
      const id = workspaceIdSchema.parse(sessionId)
      const workspace = this.ctx.workspaceRegistry.list().find(value => value.sessionIds.some(session => String(session) === id))
      if (workspace === undefined) throw new PlanningError('source-unavailable', 'conversation is not in a registered project')
      return await this.snapshot(workspace.id, signal)
    } catch (error) { throw planningRemoteFailure(error, signal) }
  }

  /** Read immutable image bytes only after proving the selected Board retained this image. */
  @Remote('image')
  async image(input: PlanningImageInput, signal: AbortSignal): Promise<PlanningImageView> {
    requirePlanningActive(signal)
    try {
      const parsed = imageInputSchema.parse(input)
      const access = this.access(parsed.workspaceId, signal)
      const board = await this.ctx.planning.snapshot(access, signal)
      const sources = [
        ...board.items.flatMap(item => item.revisions.flatMap(revision => revision.sources)),
        ...board.proposals.flatMap(proposal => proposal.generations.flatMap(generation => generation.draft.sources)),
      ]
      const image = sources.flatMap(source => source.kind === 'session-event' ? source.images ?? [] : [])
        .find(value => value.attachmentId === parsed.attachmentId)
      const attachments = this.ctx.get('attachments')
      if (image === undefined || attachments === undefined)
        throw new PlanningError('source-unavailable', 'image is unavailable in this project')
      const stored = await attachments.readImage({
        attachmentId: AttachmentId(image.attachmentId), mediaType: image.mediaType,
        bytes: image.bytes, width: image.width, height: image.height,
        ...(image.name === undefined ? {} : { name: image.name }),
        ...(image.originalDimensions === undefined ? {} : { originalDimensions: image.originalDimensions }),
      }, signal)
      await access.authorize()
      requirePlanningActive(signal)
      return { mediaType: stored.ref.mediaType, data: Buffer.from(stored.data).toString('base64') }
    } catch (error) { throw planningRemoteFailure(error, signal) }
  }

  /**
   * Apply a human operation with provider-owned CAS and durable retry receipts.
   * @param input - Project and bounded command; no Host authority fields are accepted.
   * @param signal - Cancellation before commit stops admission; committed retries retain the same request id.
   * @returns Committed mutation identity, including the new Board version.
   */
  @Remote('execute')
  async execute(input: PlanningExecuteInput, signal: AbortSignal): Promise<PlanningMutationResult> {
    requirePlanningActive(signal)
    try {
      const parsed = executeInputSchema.safeParse(input)
      if (!parsed.success) throw new PlanningError('invalid-reference', 'invalid planning input')
      return await this.ctx.planning.execute(this.access(parsed.data.workspaceId, signal), parsed.data.command, signal)
    } catch (error) {
      throw planningRemoteFailure(error, signal)
    }
  }

  /** Prepare execution from the selected revision. This does not approve or dispatch work. */
  @Remote('handoff')
  async handoff(input: PlanningHandoffInput, signal: AbortSignal): Promise<PlanningHandoff> {
    requirePlanningActive(signal)
    try {
      const parsed = handoffInputSchema.safeParse(input)
      if (!parsed.success) throw new PlanningError('invalid-reference', 'invalid planning handoff')
      const access = this.access(parsed.data.workspaceId, signal)
      const bridge = this.ctx.get('planningDelivery')
      if (bridge === undefined) throw new PlanningError('not-found', 'planning execution is unavailable')
      return await bridge.handoff(
        access,
        { itemId: parsed.data.itemId, expectedRevisionId: parsed.data.expectedRevisionId },
        signal,
      )
    } catch (error) {
      throw planningRemoteFailure(error, signal)
    }
  }

  /** Join only this plan's durable references to the existing Delivery workbench projection. */
  @Remote('execution')
  async execution(input: PlanningExecutionInput, signal: AbortSignal): Promise<PlanningExecutionView> {
    requirePlanningActive(signal)
    try {
      const parsed = executionInputSchema.safeParse(input)
      if (!parsed.success) throw new PlanningError('invalid-reference', 'invalid planning execution query')
      const access = this.access(parsed.data.workspaceId, signal)
      const board = await this.ctx.planning.snapshot(access, signal)
      if (!board.items.some(item => item.id === parsed.data.itemId))
        throw new PlanningError('not-found', 'plan unavailable')
      const delivery = this.ctx.get('deliveryRemote') as DeliveryRemoteService | undefined
      const view = delivery?.snapshot(signal)
      await access.authorize()
      return {
        available: this.ctx.get('planningDelivery') !== undefined && delivery !== undefined,

        handoffs: board.handoffs
          .filter(handoff => handoff.itemId === parsed.data.itemId)
          .map(handoff => ({
            handoff,
            case: view === undefined ? null : caseForHandoff(view, handoff),
          })),
      }
    } catch (error) {
      throw planningRemoteFailure(error, signal)
    }
  }

  /** Read only evidence that a linked Case packet already declares for this selected Plan. */
  @Remote('evidence')
  async evidence(input: PlanningEvidenceInput, signal: AbortSignal): Promise<DeliveryEvidenceView> {
    requirePlanningActive(signal)
    try {
      const parsed = evidenceInputSchema.safeParse(input)
      if (!parsed.success) throw new PlanningError('invalid-reference', 'invalid planning evidence query')
      const access = this.access(parsed.data.workspaceId, signal)
      const view = await this.execution({ workspaceId: parsed.data.workspaceId, itemId: parsed.data.itemId }, signal)
      const allowed = view.handoffs.some(({ case: deliveryCase }) =>
        deliveryCase?.packets.some(
          packet =>
            packet.completionClaim?.evidenceIds.some(id => String(id) === parsed.data.evidenceId) ||
            packet.verificationVerdict?.evidenceIds.some(id => String(id) === parsed.data.evidenceId),
        ),
      )
      if (!allowed) throw new PlanningError('not-found', 'evidence is not linked to this planning item')
      const delivery = this.ctx.get('deliveryRemote') as DeliveryRemoteService | undefined
      if (delivery === undefined) throw new PlanningError('not-found', 'planning execution is unavailable')
      await access.authorize()
      const evidence = await delivery.readEvidence(
        { evidenceId: parsed.data.evidenceId } as Parameters<DeliveryRemoteService['readEvidence']>[0],

        signal,
      )
      await access.authorize()
      requirePlanningActive(signal)
      return evidence
    } catch (error) {
      throw planningRemoteFailure(error, signal)
    }
  }

  private access(workspaceId: string, signal: AbortSignal): PlanningAccess {
    const parsed = workspaceIdSchema.safeParse(workspaceId)
    if (!parsed.success) throw new PlanningError('invalid-reference', 'invalid project identity')
    const authorize = () => {
      requirePlanningActive(signal)
      if (this.ctx.workspaceRegistry.get(WorkspaceId(parsed.data)) === undefined) {
        throw new PlanningError('not-found', 'project unavailable')
      }
    }
    authorize()
    return { workspaceId: parsed.data, actorId: this.operatorId, kind: 'human', authorize }
  }
}

export default PlanningRemoteService

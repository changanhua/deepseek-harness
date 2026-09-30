import { z } from 'zod'
import { createHash } from 'node:crypto'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { PlanningError, planningSubjectRefSchema, planningRevisionSchema, planningFocusSchema, planningSubjectPlan } from '@changanhua/dsh-planning'
import type { PlanningBoardSnapshot } from '@changanhua/dsh-planning'
import type { PlanningContextInput, SbcDesignCaseView, SbcExploreInput } from './types.ts'

const id = z.string().min(1).max(256)
const nodeId = z.string().min(1).max(262)
const coordinate = z.number().min(0).max(20000)
const exploration = z.strictObject({
  positions: z.record(nodeId, z.strictObject({ x: coordinate, y: coordinate })),
  selectedNodeId: nodeId.nullable(),
})
export const sbcCaseInputSchema = z.strictObject({ workspaceId: id, subject: planningSubjectRefSchema })
export const sbcExploreInputSchema = sbcCaseInputSchema.extend({
  expectedVersion: z.number().int().nonnegative(), requestId: id,
  operation: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('select'), nodeId: nodeId.nullable() }),
    z.strictObject({ kind: z.literal('move'), nodeId, x: coordinate, y: coordinate }),
    z.strictObject({ kind: z.literal('undo') }),
  ]),
})
const caseSchema = z.strictObject({
  workspaceId: id, subject: planningSubjectRefSchema, planId: id,
  baseRevision: planningRevisionSchema, baseFocus: planningFocusSchema.optional(),
  version: z.number().int().nonnegative(), local: exploration,
  history: z.array(z.strictObject({ nodeId, x: coordinate, y: coordinate })).max(30),
  lastOperation: z.strictObject({ requestId: id, digest: z.string() }).optional(),
})
const spec = defineDomain({ name: 'sbc_design_cases', version: 1, layout: 'per-record', tables: { cases: domainTable(caseSchema) } })
const caseKey = (input: PlanningContextInput) => createHash('sha256')
  .update(JSON.stringify([input.workspaceId, input.subject.kind, input.subject.id])).digest('hex')

export interface SbcLimits { maxCases: number; maxCaseBytes: number }

/** Serial writes preserve case CAS and creation; disposal drains admitted work before closing storage. */
export class SbcDesignCaseStore {
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  private constructor(private readonly domain: Domain<typeof spec>, private readonly limits: SbcLimits) {}
  static async open(facility: DomainFacility, limits: SbcLimits) { return new SbcDesignCaseStore(await facility.open(spec), limits) }
  /** List only retained cases. This never freezes a new baseline or writes a record. */
  async summaries(workspaceId: string, planId: string, readBoard: () => Promise<PlanningBoardSnapshot>, signal: AbortSignal): Promise<import('./types.ts').DesignCaseSummary[]> {
    return this.enqueue(async () => {
      signal.throwIfAborted()
      const board = await readBoard()
      signal.throwIfAborted()
      return [...this.domain.table('cases').entries()].flatMap(([key, value]) => {
        if (value.workspaceId !== workspaceId || value.planId !== planId) return []
        const view = this.view(value, board)
        return [{ resource: { kind: 'design-case', id: key, provider: 'sbc' }, title: 'SBC 首个纵切',
          subjectRef: structuredClone(value.subject), baseRevision: value.baseRevision.id,
          currentRevision: view.currentRevision, drift: view.drift, status: 'exploration' as const,
          preview: value.baseFocus?.title ?? value.baseRevision.title }]
      })
    })
  }
  async read(
    input: PlanningContextInput, readBoard: () => Promise<PlanningBoardSnapshot>, signal: AbortSignal,
  ): Promise<SbcDesignCaseView> {
    return this.enqueue(async () => {
      signal.throwIfAborted()
      const board = await readBoard()
      const table = this.domain.table('cases')
      const key = caseKey(input)
      let value = table.get(key)
      if (!value) {
        if (table.size >= this.limits.maxCases) throw new PlanningError('capacity-exceeded', 'SBC case limit reached')
        const { plan, focus } = planningSubjectPlan(board, input.subject)
        const revision = plan.revisions.find(value => value.id === plan.headRevisionId)
        if (!revision) throw new PlanningError('invalid-reference', 'current Planning revision is unavailable')
        const positions: Record<string, { x: number; y: number }> = { [`plan:${plan.id}`]: { x: 40, y: 40 } }
        if (focus) positions[`focus:${focus.id}`] = { x: 360, y: 40 }
        for (const [index, entry] of (revision.stateEntries ?? []).entries())
          positions[`entry:${entry.id}`] = { x: 40 + index % 3 * 320, y: 260 + Math.floor(index / 3) * 180 }
        value = caseSchema.parse({ workspaceId: input.workspaceId, subject: input.subject, planId: plan.id,
          baseRevision: revision, ...(focus ? { baseFocus: focus } : {}),
          version: 0, local: { positions, selectedNodeId: null }, history: [] })
        signal.throwIfAborted()
        this.checkSize(value)
        await table.put(key, value)
      }
      return this.view(value, board)
    })
  }
  async explore(input: SbcExploreInput, readBoard: () => Promise<PlanningBoardSnapshot>, signal: AbortSignal): Promise<SbcDesignCaseView> {
    return this.enqueue(async () => {
      signal.throwIfAborted()
      const board = await readBoard()
      const key = caseKey(input)
      const table = this.domain.table('cases')
      const current = table.get(key)
      if (!current) throw new PlanningError('not-found', 'open the SBC case first')
      const digest = JSON.stringify(input)
      if (current.lastOperation?.requestId === input.requestId) {
        if (current.lastOperation.digest !== digest) throw new PlanningError('idempotency-conflict', 'case request changed')
        return this.view(current, board)
      }
      if (current.version !== input.expectedVersion) throw new PlanningError('conflict', 'exploration version changed')
      const next = structuredClone(current)
      const op = input.operation
      if (op.kind !== 'undo' && op.nodeId !== null && !Object.hasOwn(current.local.positions, op.nodeId))
        throw new PlanningError('invalid-reference', 'node is outside this projection')
      if (op.kind === 'undo') {
        const previous = next.history.pop()
        if (previous) next.local.positions[previous.nodeId] = { x: previous.x, y: previous.y }
      } else if (op.kind === 'select') next.local.selectedNodeId = op.nodeId
      else {
        const previous = current.local.positions[op.nodeId]
        if (!previous) throw new PlanningError('invalid-reference', 'node is outside this projection')
        if (previous.x !== op.x || previous.y !== op.y) next.history.push({ nodeId: op.nodeId, ...previous })
        next.history = next.history.slice(-30)
        next.local.positions[op.nodeId] = { x: op.x, y: op.y }
      }
      next.version++
      next.lastOperation = { requestId: input.requestId, digest }
      signal.throwIfAborted()
      this.checkSize(next)
      await table.put(key, caseSchema.parse(next))
      return this.view(next, board)
    })
  }
  private checkSize(value: z.infer<typeof caseSchema>): void {
    if (Buffer.byteLength(JSON.stringify({ version: 1, record: value }, null, 2) + '\n', 'utf8') > this.limits.maxCaseBytes)
      throw new PlanningError('capacity-exceeded', 'SBC case byte limit reached')
  }
  private view(value: z.infer<typeof caseSchema>, board: PlanningBoardSnapshot): SbcDesignCaseView {
    const plan = board.items.find(item => item.id === value.planId)
    const focus = board.focuses?.find(item => item.id === value.baseFocus?.id && item.planId === value.planId)
    const { lastOperation: _receipt, ...saved } = structuredClone(value)
    const currentRevision = plan?.headRevisionId ?? null
    const currentFocusVersion = focus?.version ?? null
    return { case: saved, currentRevision, currentFocusVersion,
      drift: currentRevision !== value.baseRevision.id || currentFocusVersion !== (value.baseFocus?.version ?? null) }
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new PlanningError('closed', 'SBC exploration is closed'))
    const run = this.tail.then(operation)
    this.tail = run.then(() => {}, () => {})
    return run
  }
  async close(): Promise<void> { this.closing = true; await this.tail; await this.domain.close() }
}

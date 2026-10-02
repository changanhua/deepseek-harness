import { randomUUID } from 'node:crypto'
import type { Domain, DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { AssessmentError, assessmentCreateSchema, requirementAssessmentSchema } from '@changanhua/dsh-requirement-assessment'
import type { AssessmentAccess, AssessmentRequestIdentity, AssessmentReservation, AssessmentCreateInput, AssessmentSnapshot, RequirementAssessment } from '@changanhua/dsh-requirement-assessment'
import { assessmentLocalDomain, assessmentRecordSchema } from './spec.ts'

/** One Workspace record atomically owns complete assessments and their request identities. */
export class AssessmentStore {
  private readonly records: KvTable<string, AssessmentSnapshot & { reservations: AssessmentRequestIdentity[] }>
  private tail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>
  private constructor(private readonly domain: Domain<typeof assessmentLocalDomain>, private readonly maxBytes: number) {
    this.records = domain.table('workspaces')
  }
  static async open(facility: DomainFacility, maxBytes = 4 * 1024 * 1024): Promise<AssessmentStore> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new AssessmentError('capacity-exceeded', 'assessment capacity must be a positive integer')
    return new AssessmentStore(await facility.open(assessmentLocalDomain), maxBytes)
  }
  snapshot(workspaceId: string): AssessmentSnapshot {
    const record = this.record(workspaceId)
    this.bound(record)
    return structuredClone({ workspaceId: record.workspaceId, assessments: record.assessments })
  }
  private record(workspaceId: string) {
    const value = this.records.get(workspaceId) ?? { workspaceId, assessments: [], reservations: [] }
    if (value.workspaceId !== workspaceId) throw new AssessmentError('conflict', 'stored workspace ownership mismatch')
    return value
  }
  reserve(access: AssessmentAccess, request: AssessmentRequestIdentity, signal?: AbortSignal): Promise<AssessmentReservation> {
    const { requestId, requestDigest } = request
    if (![requestId, requestDigest].every(value => typeof value === 'string' && value.length > 0 && value.length <= 256))
      return Promise.reject(new AssessmentError('invalid-input', 'invalid request identity'))
    const workspaceId = access.workspaceId
    return this.enqueue(async () => {
      await access.authorize()
      signal?.throwIfAborted()
      const completed = this.replay(workspaceId, requestId, requestDigest)
      if (completed) return { status: 'completed', assessment: completed }
      const current = this.record(workspaceId)
      const reserved = current.reservations.find(value => value.requestId === requestId)
      if (reserved) {
        if (reserved.requestDigest !== requestDigest) throw new AssessmentError('idempotency-conflict', 'request id already identifies different input')
        return { status: 'pending' }
      }
      if (current.assessments.length >= 200) throw new AssessmentError('capacity-exceeded', 'assessment history capacity reached')
      const next = { ...current, reservations: [...current.reservations, { requestId, requestDigest }] }
      this.bound(next)
      const checked = assessmentRecordSchema.safeParse(next)
      if (!checked.success) throw new AssessmentError('capacity-exceeded', 'assessment reservation capacity reached')
      await access.authorize()
      signal?.throwIfAborted()
      await this.records.put(workspaceId, checked.data)
      return { status: 'acquired' }
    })
  }
  get(workspaceId: string, id: string): RequirementAssessment {
    const value = this.snapshot(workspaceId).assessments.find(assessment => assessment.id === id)
    if (!value) throw new AssessmentError('not-found', 'assessment is unavailable in this workspace')
    return value
  }
  replay(workspaceId: string, requestId: string, requestDigest: string): RequirementAssessment | undefined {
    const value = this.snapshot(workspaceId).assessments.find(assessment => assessment.requestId === requestId)
    if (value && value.requestDigest !== requestDigest) throw new AssessmentError('idempotency-conflict', 'request id already identifies different input')
    return value
  }
  create(access: AssessmentAccess, input: AssessmentCreateInput, signal?: AbortSignal): Promise<RequirementAssessment> {
    // Capture before enqueue: callers cannot change the snapshot while another review commits.
    const parsed = assessmentCreateSchema.safeParse(input)
    if (!parsed.success) return Promise.reject(new AssessmentError('invalid-input', 'invalid complete assessment'))
    const captured = parsed.data
    const actor = { kind: access.kind, id: access.actorId }
    const workspaceId = access.workspaceId
    return this.enqueue(async () => {
      await access.authorize()
      signal?.throwIfAborted()
      const replay = this.replay(workspaceId, captured.requestId, captured.requestDigest)
      if (replay) {
        const { id: _id, workspaceId: _workspaceId, mode: _mode, createdAt: _createdAt, createdBy: _createdBy, ...previous } = replay
        if (JSON.stringify(previous) !== JSON.stringify(captured))
          throw new AssessmentError('idempotency-conflict', 'request id already identifies a different completed assessment')
        return replay
      }
      const current = this.record(workspaceId)
      const reserved = current.reservations.find(value => value.requestId === captured.requestId)
      if (reserved && reserved.requestDigest !== captured.requestDigest) throw new AssessmentError('idempotency-conflict', 'reservation input mismatch')
      if (captured.supersedes) {
        const previous = current.assessments.find(value => value.id === captured.supersedes)
        if (!previous || previous.subject.kind !== captured.subject.kind || previous.subject.id !== captured.subject.id ||
          (previous.subject.kind === 'focus' && captured.subject.kind === 'focus' && previous.subject.planId !== captured.subject.planId))
          throw new AssessmentError('conflict', 'supersedes must retain the same workspace and subject')
      }
      const assessment = requirementAssessmentSchema.parse({ ...captured, id: `assessment-${randomUUID()}`, workspaceId, mode: 'quick', createdAt: new Date().toISOString(), createdBy: actor })
      const next = {
        workspaceId, assessments: [...current.assessments, assessment],
        reservations: current.reservations.filter(value => value.requestId !== captured.requestId),
      }
      this.bound(next)
      const checked = assessmentRecordSchema.safeParse(next)
      if (!checked.success) throw new AssessmentError('capacity-exceeded', 'assessment history capacity reached')
      await access.authorize()
      signal?.throwIfAborted()
      await this.records.put(workspaceId, checked.data)
      return structuredClone(assessment)
    })
  }
  private bound(value: unknown): void {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > this.maxBytes)
      throw new AssessmentError('capacity-exceeded', 'complete assessment history exceeds byte capacity')
  }
  close(): Promise<void> { return this.closing ??= this.tail.then(() => this.domain.close()) }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new AssessmentError('closed', 'assessment storage is closing'))
    const pending = this.tail.then(operation)
    this.tail = pending.then(() => undefined, () => undefined)
    return pending
  }
}

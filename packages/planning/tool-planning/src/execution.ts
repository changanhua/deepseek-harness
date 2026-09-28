import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { PlanningExecutionView } from '@changanhua/dsh-planning-remote/types'
import type { DeliveryEvidenceView } from '@changanhua/dsh-delivery-remote'
import { renderPlanningResult } from './presentation.ts'

export const executionParameters = {
  item_id: {
    type: 'string',
    required: true,
    description: 'Current-project plan whose execution evidence should be read.',
  },

  packet_id: {
    type: 'string',
    description: 'Optional packet id from the summary to inspect results and evidence references.',
  },

  evidence_id: {
    type: 'string',
    description: 'Optional evidence id from a packet to read its immutable text; use instead of packet_id.',
  },

  cursor: { type: 'integer', description: 'Summary or evidence-reference page cursor, initially 0.' },

  limit: { type: 'integer', description: 'Summary or evidence-reference page size, from 1 to 50.' },

  offset: {
    type: 'integer',
    description: 'Evidence text character offset, initially 0. Each page contains at most 2000 Unicode characters.',
  },
} as const

export function parseExecution(value: unknown): {
  itemId: string
  packetId?: string
  evidenceId?: string
  cursor: number
  limit: number
  offset: number
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new HarnessError('Provide a planning item.', 'PLANNING_INVALID_INPUT')
  const input = value as Record<string, unknown>
  if (
    Object.keys(input).some(key => !Object.hasOwn(executionParameters, key)) ||
    typeof input.item_id !== 'string' ||
    input.item_id.trim() === '' ||
    input.item_id.length > 256 ||
    ['packet_id', 'evidence_id'].some(
      key =>
        input[key] !== undefined &&
        (typeof input[key] !== 'string' || input[key].trim() === '' || input[key].length > 256),
    ) ||
    (input.packet_id !== undefined && input.evidence_id !== undefined) ||
    ['cursor', 'offset'].some(
      key => input[key] !== undefined && (!Number.isSafeInteger(input[key]) || (input[key] as number) < 0),
    ) ||
    (input.limit !== undefined &&
      (!Number.isSafeInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > 50))
  ) {
    throw new HarnessError('Planning execution selectors or pagination are invalid.', 'PLANNING_INVALID_INPUT')
  }
  return {
    itemId: input.item_id,
    ...(input.packet_id === undefined ? {} : { packetId: input.packet_id as string }),
    ...(input.evidence_id === undefined ? {} : { evidenceId: input.evidence_id as string }),
    cursor: typeof input.cursor === 'number' ? input.cursor : 0,
    limit: typeof input.limit === 'number' ? input.limit : 20,
    offset: typeof input.offset === 'number' ? input.offset : 0,
  }
}

const clip = (text: string | undefined) => (text === undefined ? null : Array.from(text).slice(0, 1000).join(''))

/** Read current Delivery facts; no Planning lane implies an execution result. */
export function renderExecution(
  view: PlanningExecutionView,
  input: ReturnType<typeof parseExecution>,
  maxBytes: number,
): string {
  if (input.packetId !== undefined) {
    for (const entry of view.handoffs) {
      const packet =
        entry.case === null ? undefined : entry.case.packets.find(value => value.packet.id === input.packetId)
      if (packet === undefined) continue
      const evidence = [
        ...new Set([
          ...(packet.completionClaim?.evidenceIds ?? []),
          ...(packet.verificationVerdict?.evidenceIds ?? []),
        ]),
      ]
      const page = evidence.slice(input.cursor, input.cursor + input.limit)
      return renderPlanningResult(
        {
          item_id: input.itemId,
          revision_id: entry.handoff.revisionId,
          case_id: entry.handoff.caseId,
          packet_id: packet.packet.id,
          execution: packet.completionClaim?.disposition ?? null,
          summary: clip(packet.completionClaim?.summary),

          summary_truncated: Array.from(packet.completionClaim?.summary ?? '').length > 1000,

          verification: packet.verificationVerdict?.status ?? null,
          verification_reasons: clip(packet.verificationVerdict?.reviewReasons.join('\n')),

          verification_reasons_truncated:
            Array.from(packet.verificationVerdict?.reviewReasons.join('\n') ?? '').length > 1000,

          human_acceptance: packet.acceptanceDecision?.decision ?? null,
          acceptance_reason: clip(packet.acceptanceDecision?.reason),

          acceptance_reason_truncated: Array.from(packet.acceptanceDecision?.reason ?? '').length > 1000,

          evidence_count: evidence.length,
          evidence_ids: page,
          ...(input.cursor + page.length < evidence.length ? { next_cursor: input.cursor + page.length } : {}),
        },
        maxBytes,
      )
    }
    throw new HarnessError('This packet is not linked to the selected plan.', 'PLANNING_NOT_FOUND')
  }
  const rows = view.handoffs.flatMap<Record<string, unknown>>((entry) => {
    const common = {
      revision_id: entry.handoff.revisionId,
      case_id: entry.handoff.caseId ?? null,
      handoff_phase: entry.handoff.phase,
      stage: entry.case?.lane ?? 'unavailable',
      readiness: entry.case?.readiness ?? null,
    }
    return entry.case === null || entry.case.packets.length === 0
      ? [{ ...common, packet_id: null }]
      : entry.case.packets.map(packet => ({
        ...common,
        packet_id: packet.packet.id,
        execution: packet.completionClaim?.disposition ?? null,
        verification: packet.verificationVerdict?.status ?? null,
        human_acceptance: packet.acceptanceDecision?.decision ?? null,
      }))
  })
  const candidates = rows.slice(input.cursor, input.cursor + input.limit)
  for (let count = candidates.length; count >= (candidates.length === 0 ? 0 : 1); count--) {
    try {
      return renderPlanningResult(
        {
          item_id: input.itemId,
          available: view.available,
          row_count: rows.length,
          rows: candidates.slice(0, count),
          ...(input.cursor + count < rows.length ? { next_cursor: input.cursor + count } : {}),
        },
        maxBytes,
      )
    } catch (error) {
      if (!(error instanceof HarnessError) || count === 0) throw error
    }
  }
  throw new HarnessError('Planning execution identity cannot fit the output limit.', 'PLANNING_OUTPUT_LIMIT')
}

/** Return bounded, inert evidence text and its integrity metadata. */
export function renderExecutionEvidence(value: DeliveryEvidenceView, offset: number, maxBytes: number): string {
  const textual =
    value.mediaType.startsWith('text/') || value.mediaType === 'application/json' || value.mediaType.endsWith('+json')
  const characters = textual
    ? Array.from(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value.contentBase64, 'base64')))
    : []
  return renderPlanningResult(
    {
      evidence_id: value.id,
      kind: value.kind,
      media_type: value.mediaType,
      digest: value.digest,
      byte_length: value.byteLength,
      provenance: value.provenance,
      ...(textual
        ? {
          offset,
          text: characters.slice(offset, offset + 2000).join(''),
          total_characters: characters.length,
          ...(offset + 2000 < characters.length ? { next_offset: offset + 2000 } : {}),
        }
        : { text_available: false }),
    },
    maxBytes,
  )
}

import type { AssistantChatData, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PlanningBoardView } from '@changanhua/dsh-planning-remote/types'
import type { PlanningCommand, PlanningSource, PlanningSourceInput } from '@changanhua/dsh-planning/types'

export interface PlanningImageTarget { readonly seq: number; readonly count: number; readonly name?: string | undefined }

/** Only committed assistant image blocks are eligible for this message action. */
export function findPlanningImageTarget(snapshot: ChatSnapshot, messageId: string): PlanningImageTarget | undefined {
  for (const node of snapshot.nodes.values()) {
    if (node.kind !== 'assistant-step') continue
    const final = (node.data as AssistantChatData).finalNode
    if (final?.messageId !== messageId || final.interrupted === true) continue
    const images = final.blocks.filter(block => block.kind === 'image')
    if (images.length > 0) return { seq: final.seq, count: images.length, name: images[0]?.attachment.name }
  }
  return undefined
}

export const planningSourceInputs = (sources: readonly PlanningSource[]): PlanningSourceInput[] => sources.map((source) => {
  if (source.kind === 'manual') return { kind: 'manual', text: source.text }
  if (source.kind === 'link') return { kind: 'link', url: source.url, label: source.label }
  if (source.kind === 'session-event') return { kind: 'session-event', sessionId: source.sessionId, seq: source.seq }
  return { kind: 'content', entryId: source.entryId, version: source.version }
})

/** Preserve the current item and its fields while adding one exact conversation source. */
export function imageCaptureCommand(
  board: PlanningBoardView, itemId: string, sessionId: string, seq: number, title: string, requestId: string,
): PlanningCommand | undefined {
  const source = { kind: 'session-event' as const, sessionId, seq }
  if (itemId === '') return {
    kind: 'create', requestId, expectedBoardVersion: board.version, lane: 'inbox', title, intent: title,
    scope: [], acceptance: [], sources: [source], reviewAt: null,
    estimate: { value: null, urgency: null, reuse: null, compounding: null, timeCost: null, tokenCost: null, risk: null, cognitiveCost: null, rationale: '' },
  }
  const item = board.items.find(value => value.id === itemId && value.disposition === 'active')
  const revision = item?.revisions.find(value => value.id === item.headRevisionId)
  if (item === undefined || revision === undefined) throw new Error('Selected plan is unavailable')
  const existing = revision.sources.find(value => value.kind === 'session-event' && value.sessionId === sessionId && value.seq === seq)
  if (existing?.kind === 'session-event' && (existing.images?.length ?? 0) > 0) return undefined
  return {
    kind: 'revise', requestId, expectedBoardVersion: board.version, itemId,
    expectedRevisionId: revision.id, title: revision.title, intent: revision.intent,
    scope: revision.scope, acceptance: revision.acceptance, estimate: revision.estimate, reviewAt: revision.reviewAt,
    sources: [...planningSourceInputs(revision.sources), ...(existing === undefined ? [source] : [])],
  }
}

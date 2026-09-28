import { createHash } from 'node:crypto'
import { PlanningError } from '@changanhua/dsh-planning'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { Content } from '@changanhua/dsh-content'
import type { PlanningSource, PlanningSourceInput } from '@changanhua/dsh-planning/types'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { sessionEventImages } from './session-images.ts'
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
/** Capture provider-owned facts; manual and link sources deliberately remain unverified. */
export async function capturePlanningSources(
  query: SessionQueryEngine,
  content: Content | undefined,
  workspaceId: string,
  workspaceSessionIds: readonly string[],
  inputs: readonly PlanningSourceInput[],
  signal?: AbortSignal,
  attachments?: AttachmentStore,
): Promise<PlanningSource[]> {
  const captured: PlanningSource[] = []
  for (const input of inputs) {
    signal?.throwIfAborted()
    if (input.kind === 'manual') captured.push({ ...input, verification: 'unverified' })
    else if (input.kind === 'link') captured.push({ ...input, verification: 'unverified' })
    else if (input.kind === 'session-event') {
      if (!workspaceSessionIds.includes(input.sessionId))
        throw new PlanningError('source-unavailable', 'session source is outside this Workspace')
      const found = await query.readEvent({
        sessionId: SessionId(input.sessionId),
        seq: SessionSeq(input.seq),
        before: 0,
        after: 0,
      })
      const text = extractSessionEventText(found.target)
      const images = sessionEventImages(found.target)
      if (images.length > 20) throw new PlanningError('capacity-exceeded', 'a planning source can retain at most 20 images')
      if (images.length > 0 && attachments === undefined)
        throw new PlanningError('source-unavailable', 'image storage is unavailable')
      const attachmentStore = attachments
      const capturedImages = []
      for (const image of images) {
        const stored = await attachmentStore?.readImage(image, signal)
        if (stored === undefined) throw new PlanningError('source-unavailable', 'image storage is unavailable')
        capturedImages.push(stored.ref)
      }
      captured.push({
        ...input,
        eventType: found.target.type,
        sha256: digest(text),
        excerpt: Array.from(text).slice(0, 512).join(''),
        ...(capturedImages.length === 0 ? {} : { images: capturedImages }),
        verification: 'verified',
      })
    } else {
      if (content === undefined)
        throw new PlanningError('source-unavailable', 'content source verification is not composed on this Host')
      const entry = content.get(input.entryId, () => {})
      const version = entry?.versions.find(value => value.id === input.version)
      if (entry === undefined || version === undefined || !entry.projectRefs.includes(workspaceId))
        throw new PlanningError('source-unavailable', 'content source is unavailable in this Workspace')
      captured.push({ ...input, sha256: version.bodySha256, verification: 'captured' })
    }
  }
  return captured
}

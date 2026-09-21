const clone = value => value === undefined ? undefined : structuredClone(value)
const textFrom = content => (Array.isArray(content) ? content : [])
  .filter(part => part?.type === 'text' && typeof part.text === 'string')
  .map(part => part.text).join('\n')
const imagesFrom = content => (Array.isArray(content) ? content : [])
  .filter(part => part?.type === 'image' && part.attachment)
  .map(part => clone(part.attachment))

const transcript = (records, live) => {
  const items = []
  const active = live?.active ?? null
  for (const record of records ?? []) {
    const event = record?.event
    if (!event || event.surfaceOp !== 'append') continue
    if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
      items.push({ key: `user:${event.seq}`, role: 'user', text: textFrom(event.data.content), images: imagesFrom(event.data.content) })
    } else if (event.type === 'assistant/message') {
      if (active && event.data?.turn === active.turn && event.data?.step === active.step) continue
      const content = event.data?.message?.content
      items.push({ key: `assistant:${event.seq}`, role: 'assistant', text: textFrom(content), images: imagesFrom(content) })
    }
  }
  if (active) {
    const text = (active.chunks ?? []).filter(item => item?.chunk?.type === 'text-delta')
      .map(item => item.chunk.text ?? '').join('')
    items.push({ key: `assistant-live:${active.attemptId}`, role: 'assistant', text, images: [], live: true })
  }
  return items
}

/** Pure adapter from authoritative runtime projections to the V2 extension view. */
export const projectAssistantView = ({ surfaceId, state }) => ({
  surface: { id: surfaceId },
  connection: clone(state?.connection ?? null),
  session: {
    binding: clone(state?.session?.binding ?? null),
    phase: state?.session?.phase ?? 'idle',
    error: clone(state?.session?.error ?? null),
    pending: clone(state?.session?.pending ?? null),
    pendingCreate: clone(state?.session?.pendingCreate ?? null),
    modelSelection: clone(state?.session?.modelSelection ?? null),
    transcript: transcript(state?.session?.records, state?.session?.assistantLive),
  },
  target: clone(state?.target ?? { availability: 'unavailable', revision: null, selected: null, candidates: [] }),
  cognition: clone(state?.cognition ?? { status: 'unread', items: [], refreshPolicy: 'manual-or-agent-request' }),
  functions: clone(state?.functionSnapshot ?? { availability: 'unavailable', items: [] }),
})

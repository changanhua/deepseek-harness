const clone = value => structuredClone(value)
const nonnegative = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
const attempt = value => typeof value === 'string' && value.length > 0 && value.length <= 256

const expand = stream => {
  if (!Array.isArray(stream)) throw new TypeError('invalid_assistant_stream')
  const chunks = []
  for (const record of stream) {
    if (!record || typeof record !== 'object') throw new TypeError('invalid_assistant_stream')
    if (record.type === 'chunk') {
      if (!Number.isSafeInteger(record.time) || !record.chunk || typeof record.chunk !== 'object') throw new TypeError('invalid_assistant_stream')
      chunks.push({ time: record.time, chunk: clone(record.chunk) }); continue
    }
    const members = record.type === 'tool-call-chunks' ? record.args : record.texts
    if (!['text-chunks', 'reasoning-chunks', 'tool-call-chunks'].includes(record.type)
      || !Number.isSafeInteger(record.time0) || !nonnegative(record.index) || !Array.isArray(record.dt)
      || !Array.isArray(members) || members.length === 0 || record.dt.length !== members.length - 1
      || record.dt.some(gap => !Number.isSafeInteger(gap)) || members.some(member => typeof member !== 'string')) {
      throw new TypeError('invalid_assistant_stream')
    }
    let time = record.time0
    for (let index = 0; index < members.length; index += 1) {
      if (index > 0) time += record.dt[index - 1]
      const chunk = record.type === 'text-chunks'
        ? { type: 'text-delta', index: record.index, text: members[index] }
        : record.type === 'reasoning-chunks'
          ? { type: 'reasoning-delta', index: record.index, text: members[index] }
          : { type: 'tool-call-delta', index: record.index, id: record.id,
              ...(Object.hasOwn(record, 'name') ? { name: record.name } : {}), argumentsDelta: members[index] }
      chunks.push({ time, chunk })
    }
  }
  return chunks
}

/** Validates and folds the process-local Assistant stream used by the extension view. */
export const createAssistantLive = () => {
  let revision = 0
  let active = null
  const read = () => clone({ revision, active })
  const replace = baseline => {
    if (!baseline || !nonnegative(baseline.revision)) throw new TypeError('invalid_assistant_baseline')
    let next = null
    if (baseline.activeAttempt !== undefined) {
      const opening = baseline.activeAttempt
      const chunks = expand(opening.stream)
      if (!attempt(opening.attemptId) || !Number.isSafeInteger(opening.startedAfterSeq) || opening.startedAfterSeq < -1
        || !nonnegative(opening.turn) || !nonnegative(opening.step) || !nonnegative(opening.nextIndex)
        || opening.nextIndex > chunks.length) throw new TypeError('invalid_assistant_baseline')
      next = { attemptId: opening.attemptId, startedAfterSeq: opening.startedAfterSeq,
        turn: opening.turn, step: opening.step, nextIndex: opening.nextIndex, chunks: chunks.slice(0, opening.nextIndex) }
    }
    revision = baseline.revision; active = next
  }
  const accept = frame => {
    if (!frame || typeof frame !== 'object' || !attempt(frame.attemptId) || !Number.isSafeInteger(frame.revision) || frame.revision <= 0) return 'rebaseline'
    const restarts = frame.type === 'start' && frame.revision === 1 && revision !== 0
    if (!restarts && frame.revision !== revision + 1) return 'rebaseline'
    if (frame.type === 'start') {
      if (!restarts && active !== null || !Number.isSafeInteger(frame.startedAfterSeq) || frame.startedAfterSeq < -1
        || !nonnegative(frame.turn) || !nonnegative(frame.step)) return 'rebaseline'
      revision = frame.revision
      active = { attemptId: frame.attemptId, startedAfterSeq: frame.startedAfterSeq,
        turn: frame.turn, step: frame.step, nextIndex: 0, chunks: [] }
      return 'accepted'
    }
    if (frame.type === 'chunk') {
      if (active === null || frame.attemptId !== active.attemptId) { revision = frame.revision; return 'ignored' }
      if (!nonnegative(frame.index) || frame.index !== active.nextIndex || !Number.isSafeInteger(frame.time)
        || !frame.chunk || typeof frame.chunk !== 'object') return 'rebaseline'
      revision = frame.revision
      active = { ...active, nextIndex: active.nextIndex + 1,
        chunks: [...active.chunks, { time: frame.time, chunk: clone(frame.chunk) }] }
      return 'accepted'
    }
    if (frame.type === 'end') {
      if (active === null || frame.attemptId !== active.attemptId) { revision = frame.revision; return 'ignored' }
      if (!nonnegative(frame.index) || frame.index !== active.nextIndex) return 'rebaseline'
      revision = frame.revision; active = null; return 'accepted'
    }
    return 'rebaseline'
  }
  return { read, replace, accept }
}

const KEY = 'dsh.assistant.semantic-feedback.v1'
const MAX_BYTES = 1024 * 1024
const MAX_ENTRIES = 256
const MAX_NAVIGATIONS = 100
const FLAG_VALUES = new Set(['meaning', 'source', 'other'])

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
const clone = value => structuredClone(value)
const validString = (value, maximum, { empty = false } = {}) => typeof value === 'string' && value.length <= maximum && (empty || value.length > 0)
const validInteger = value => Number.isSafeInteger(value) && value >= 0
const validDuration = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const identity = value => object(value) && validString(value.scope, 4096) && validString(value.pageId, 16384) && validString(value.mapId, 512)
  && validString(value.snapshotId, 512) && validString(value.nodeId, 512)
  && Array.isArray(value.sourceRefs) && value.sourceRefs.length > 0 && value.sourceRefs.length <= 16
  && value.sourceRefs.every(ref => validString(ref, 128)) && new Set(value.sourceRefs).size === value.sourceRefs.length
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength
const keyOf = value => `${value.scope}\u0000${value.pageId}\u0000${value.mapId}\u0000${value.nodeId}`

const entryFrom = value => {
  if (!identity(value) || !validInteger(value.revision) || value.revision === 0 || !validInteger(value.updatedAt)
    || value.label !== null && !validString(value.label, 96) || value.summary !== null && !validString(value.summary, 500, { empty: true })
    || value.flag !== null && !FLAG_VALUES.has(value.flag) || !validString(value.note, 500, { empty: true })) return null
  return { scope: value.scope, pageId: value.pageId, mapId: value.mapId, snapshotId: value.snapshotId, nodeId: value.nodeId,
    sourceRefs: [...value.sourceRefs], revision: value.revision, label: value.label, summary: value.summary, flag: value.flag,
    note: value.note, updatedAt: value.updatedAt }
}

const navigationFrom = value => {
  if (!object(value) || !validString(value.id, 128) || !validString(value.scope, 4096) || !validString(value.pageId, 16384)
    || !validString(value.snapshotId, 512) || !validString(value.blockId, 128) || !['located', 'failed'].includes(value.outcome)
    || value.reason !== undefined && !validString(value.reason, 128, { empty: true }) || !validDuration(value.durationMs) || !validInteger(value.time)) return null
  return { id: value.id, scope: value.scope, pageId: value.pageId, snapshotId: value.snapshotId, blockId: value.blockId,
    outcome: value.outcome, ...(value.reason === undefined ? {} : { reason: value.reason }), durationMs: value.durationMs, time: value.time }
}

const stateFrom = value => {
  if (value === undefined) return { revision: 0, entries: [], navigations: [] }
  if (!object(value) || value.version !== 1 || !Array.isArray(value.entries) || !Array.isArray(value.navigations)
    || value.entries.length > MAX_ENTRIES || value.navigations.length > MAX_NAVIGATIONS) return null
  const entries = value.entries.map(entryFrom), navigations = value.navigations.map(navigationFrom)
  if (entries.some(entry => !entry) || navigations.some(item => !item)) return null
  if (new Set(entries.map(keyOf)).size !== entries.length || new Set(navigations.map(item => item.id)).size !== navigations.length) return null
  const restoredRevision = value.revision
  if (restoredRevision !== undefined && (!validInteger(restoredRevision) || entries.some(entry => entry.revision > restoredRevision))) return null
  // Earlier local records had only per-node revisions. Keep their content, but
  // advance every active node past all older revisions before accepting writes.
  const legacyRevision = restoredRevision === undefined ? Math.max(0, ...entries.map(entry => entry.revision)) : restoredRevision
  const active = entries.filter(entry => entry.label !== null || entry.flag !== null || entry.note !== '')
  const normalized = restoredRevision === undefined
    ? active.map((entry, index) => ({ ...entry, revision: legacyRevision + index + 1 })) : entries
  const revision = restoredRevision === undefined ? legacyRevision + active.length : restoredRevision
  if (!validInteger(revision)) return null
  const next = { revision, entries: normalized, navigations }
  return bytes({ version: 1, ...next }) <= MAX_BYTES ? next : null
}

/** Local, user-authored reading feedback. It never contains source text or changes Host facts. */
export const createSemanticFeedback = ({ storage, changed = () => {} }) => {
  let entries = [], navigations = [], revision = 0, error = null, blocked = false, serial = Promise.resolve()
  const read = (scope, pageId) => {
    if (!validString(scope, 4096) || !validString(pageId, 16384)) throw new Error('semantic_feedback_invalid_input')
    return clone({ revision, entries: entries.filter(entry => entry.scope === scope && entry.pageId === pageId),
      navigations: navigations.filter(item => item.scope === scope && item.pageId === pageId), error })
  }
  const enqueue = work => {
    const task = serial.then(work)
    serial = task.catch(() => {})
    return task
  }
  const persist = async (nextEntries, nextNavigations, nextRevision = revision) => {
    const next = { version: 1, revision: nextRevision, entries: nextEntries, navigations: nextNavigations }
    if (bytes(next) > MAX_BYTES) throw new Error('semantic_feedback_capacity_exceeded')
    try { await storage.set({ [KEY]: next }) } catch { throw new Error('semantic_feedback_storage_failed') }
    entries = nextEntries; navigations = nextNavigations; revision = nextRevision
    try { changed() } catch {}
  }
  const restore = () => enqueue(async () => {
    try {
      const saved = (await storage.get(KEY))[KEY], restored = stateFrom(saved)
      if (!restored) { error = 'semantic_feedback_restore_invalid'; blocked = true; return }
      entries = restored.entries; navigations = restored.navigations; revision = restored.revision; error = null; blocked = false
    } catch { error = 'semantic_feedback_restore_failed'; blocked = true }
  })
  const update = input => enqueue(async () => {
    if (blocked) throw new Error('semantic_feedback_restore_blocked')
    if (!identity(input) || !validInteger(input.expectedRevision) || !['edit', 'flag', 'reset'].includes(input.action)) throw new Error('semantic_feedback_invalid_input')
    if (input.label !== undefined && (input.label !== null && !validString(input.label, 96))) throw new Error('semantic_feedback_invalid_input')
    if (input.summary !== undefined && (input.summary !== null && !validString(input.summary, 500, { empty: true }))) throw new Error('semantic_feedback_invalid_input')
    if (input.flag !== undefined && !FLAG_VALUES.has(input.flag)) throw new Error('semantic_feedback_invalid_input')
    if (input.note !== undefined && !validString(input.note, 500, { empty: true })) throw new Error('semantic_feedback_invalid_input')
    if (input.action === 'edit' && !validString(input.label, 96)) throw new Error('semantic_feedback_invalid_input')
    if (input.action === 'flag' && !FLAG_VALUES.has(input.flag)) throw new Error('semantic_feedback_invalid_input')
    const index = entries.findIndex(entry => keyOf(entry) === keyOf(input)), current = index < 0 ? null : entries[index]
    const expected = current?.revision ?? revision
    if (expected !== input.expectedRevision) throw new Error('semantic_feedback_conflict')
    if (input.action === 'reset' && !current) throw new Error('semantic_feedback_invalid_input')
    if (!validInteger(revision + 1)) throw new Error('semantic_feedback_capacity_exceeded')
    if (!current && entries.length >= MAX_ENTRIES) throw new Error('semantic_feedback_capacity_exceeded')
    const base = { scope: input.scope, pageId: input.pageId, mapId: input.mapId, snapshotId: input.snapshotId, nodeId: input.nodeId,
      sourceRefs: [...input.sourceRefs], revision: revision + 1, updatedAt: Date.now() }
    const next = input.action === 'edit'
      ? { ...base, label: input.label, summary: input.summary ?? null, flag: current?.flag ?? null, note: current?.note ?? '' }
      : input.action === 'flag'
        ? { ...base, label: current?.label ?? null, summary: current?.summary ?? null, flag: input.flag, note: input.note ?? '' }
        : { ...base, label: null, summary: null, flag: null, note: '' }
    const nextEntries = input.action === 'reset' ? entries.filter(entry => keyOf(entry) !== keyOf(input)) : [...entries]
    if (input.action !== 'reset') {
      if (index < 0) nextEntries.push(next); else nextEntries[index] = next
    }
    await persist(nextEntries, navigations, revision + 1)
    return clone(next)
  })
  const recordNavigation = input => enqueue(async () => {
    if (blocked) throw new Error('semantic_feedback_restore_blocked')
    if (!object(input) || !validString(input.scope, 4096) || !validString(input.pageId, 16384) || !validString(input.snapshotId, 512)
      || !validString(input.blockId, 128) || !['located', 'failed'].includes(input.outcome)
      || input.reason !== undefined && !validString(input.reason, 128, { empty: true }) || !validDuration(input.durationMs)) throw new Error('semantic_feedback_invalid_input')
    const next = { id: crypto.randomUUID(), scope: input.scope, pageId: input.pageId, snapshotId: input.snapshotId, blockId: input.blockId,
      outcome: input.outcome, ...(input.reason === undefined ? {} : { reason: input.reason }), durationMs: input.durationMs, time: Date.now() }
    await persist(entries, [next, ...navigations].slice(0, MAX_NAVIGATIONS))
  })
  return { restore, read, update, recordNavigation }
}

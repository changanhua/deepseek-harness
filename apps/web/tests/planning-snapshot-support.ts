/** Snapshot-only normalization for generated Planning Board identities. */

const ITEM_ID = /^plan-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu
const REVISION_ID = /^plan-revision-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu
const IDENTITY_KEYS = new Set([
  'item_id', 'itemId', 'target_item_id', 'targetItemId', 'before_item_id', 'beforeItemId',
  'revision_id', 'revisionId', 'head_revision_id', 'headRevisionId',
  'previous_revision_id', 'previousRevisionId', 'base_revision_id', 'baseRevisionId',
])
const CLOCK_KEYS = new Set(['created_at', 'createdAt'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function collectPlanningVolatiles(
  value: unknown,
  replacements: Map<string, string>,
  clockReplacements: Map<string, string>,
  counters: { item: number; revision: number; clock: number },
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPlanningVolatiles(item, replacements, clockReplacements, counters)
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && IDENTITY_KEYS.has(key)) {
      if (ITEM_ID.test(child) && !replacements.has(child)) replacements.set(child, `PLANNING_ITEM_${++counters.item}`)
      if (REVISION_ID.test(child) && !replacements.has(child)) replacements.set(child, `PLANNING_REVISION_${++counters.revision}`)
    }
    if (typeof child === 'string' && CLOCK_KEYS.has(key) && !clockReplacements.has(child)) {
      clockReplacements.set(child, `PLANNING_CREATED_AT_${++counters.clock}`)
    }
    collectPlanningVolatiles(child, replacements, clockReplacements, counters)
  }
}

function parsedJson(value: unknown): unknown {
  if (typeof value !== 'string') return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function textValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(textValues)
  if (!isRecord(value)) return []
  const own = typeof value.text === 'string' ? [value.text] : []
  return [...own, ...Object.values(value).flatMap(textValues)]
}

/**
 * Replaces only generated identifiers and creation clocks discovered in Planning
 * tool arguments/results. Their replacements are then applied to the complete
 * log so echoed Assistant reasoning and calls retain the same relationships.
 */
export function normalizePlanningSessionLog(raw: string): string {
  const planningCallIds = new Set<string>()
  const planningResults: unknown[] = []
  const planningResultIndexes = new Set<number>()
  const skillResultTexts: string[] = []
  const records = raw.split(/\r?\n/u).flatMap((line) => {
    const record = parsedJson(line)
    return isRecord(record) ? [record] : []
  })

  for (const record of records) {
    if (record.type !== 'tool/call' || !isRecord(record.data)) continue
    if (typeof record.data.name === 'string' && record.data.name.startsWith('planning_')) {
      if (typeof record.data.callId === 'string') planningCallIds.add(record.data.callId)
    }
    if (record.data.name === 'skill' && typeof record.data.callId === 'string') planningCallIds.add(`skill:${record.data.callId}`)
  }

  for (const [index, record] of records.entries()) {
    if (record.type !== 'tool/result' || !isRecord(record.data) || !isRecord(record.data.message)) continue
    const source = record.data.message.source
    const callId = isRecord(source) && typeof source.callId === 'string' ? source.callId : undefined
    const texts = textValues(record.data.message.content)
    if (callId !== undefined && planningCallIds.has(callId)) {
      planningResultIndexes.add(index)
      for (const text of texts) {
        const result = parsedJson(text)
        if (result !== undefined) planningResults.push(result)
      }
    }
    if (callId !== undefined && planningCallIds.has(`skill:${callId}`)) skillResultTexts.push(...texts)
  }

  const replacements = new Map<string, string>()
  const clockReplacements = new Map<string, string>()
  const counters = { item: 0, revision: 0, clock: 0 }
  for (const value of planningResults) collectPlanningVolatiles(value, replacements, clockReplacements, counters)
  for (const text of skillResultTexts) {
    const line = /^Base directory for this skill: ([^\r\n]+)$/mu.exec(text)
    const base = line?.[1]
    const relative = base?.match(/[\\/]packages[\\/]bundle[\\/]personal-planning([\\/]skills[\\/].+)$/u)?.[1]
    if (base !== undefined && relative !== undefined) {
      replacements.set(base.replaceAll('\\', '\\\\'), `PLANNING_PERSONAL_PACKAGE_ROOT${relative.replaceAll('\\', '/')}`)
    }
  }

  let normalized = raw
  for (const [source, target] of [...replacements.entries()].sort(([left], [right]) => right.length - left.length)) {
    normalized = normalized.replaceAll(source, target)
  }
  const lines = normalized.split(/(\r?\n)/u)
  const planningLines = raw.split(/\r?\n/u)
  let recordIndex = 0
  for (let index = 0; index < lines.length; index += 2) {
    if (planningResultIndexes.has(recordIndex)) {
      for (const key of CLOCK_KEYS) {
        const escaped = new RegExp(`(\\\\"${key}\\\\":\\\\")([^"\\\\]+)(\\\\")`, 'gu')
        lines[index] = (lines[index] ?? '').replace(escaped, (whole, prefix: string, value: string, suffix: string) => {
          const replacement = clockReplacements.get(value)
          return replacement === undefined ? whole : `${prefix}${replacement}${suffix}`
        })
      }
    }
    if (planningLines[recordIndex] !== undefined) recordIndex += 1
  }
  normalized = lines.join('')
  return normalized
}

/** Durable, selector-free browser evidence for UI projections independent of model-output spilling. */
import type { BrowserActionResult } from '@changanhua/dsh-browser'
import type { JsonValue } from '@deepseek-ai/dsh-session'

const MAX_META_BYTES = 256 * 1024
const encoder = new TextEncoder()
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown, limit: number): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, limit) : undefined
const integer = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined
const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10_000_000 ? value : undefined

interface Limits {
  readonly text: number
  readonly elements: number
  readonly regions: number
  readonly collections: number
  readonly items: number
  readonly controls: number
  readonly tree: number
}

const FULL: Limits = { text: 2000, elements: 64, regions: 32, collections: 16, items: 16, controls: 8, tree: 128 }
const COMPACT: Limits = { text: 512, elements: 16, regions: 16, collections: 8, items: 8, controls: 4, tree: 32 }

function pageFrom(value: unknown): Record<string, JsonValue> | undefined {
  const page = object(value)
  const tabId = integer(page?.tabId), frameId = integer(page?.frameId)
  const documentId = text(page?.documentId, 256), url = text(page?.url, 4096)
  return tabId === undefined || frameId === undefined || documentId === undefined || url === undefined
    ? undefined : { tabId, frameId, documentId, url }
}

function boundsFrom(value: unknown): Record<string, JsonValue> | undefined {
  const bounds = object(value)
  const x = finite(bounds?.x), y = finite(bounds?.y), width = finite(bounds?.width), height = finite(bounds?.height)
  return x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0
    ? undefined : { x, y, width, height }
}

function stateFrom(value: unknown): Record<string, JsonValue> {
  const state = object(value) ?? {}
  const result: Record<string, JsonValue> = {}
  for (const [key, entry] of Object.entries(state).slice(0, 16)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.test(key)) continue
    if (entry === null || typeof entry === 'boolean' || typeof entry === 'number' && Number.isFinite(entry)) {
      result[key] = entry
      continue
    }
    const entryText = text(entry, 128)
    if (entryText !== undefined) result[key] = entryText
  }
  return result
}

function elementFrom(value: unknown): Record<string, JsonValue> | undefined {
  const item = object(value), elementId = text(item?.elementId, 256)
  if (item === undefined || elementId === undefined) return undefined
  const result: Record<string, JsonValue> = { elementId }
  for (const [key, limit] of [['role', 64], ['label', 256], ['text', 256], ['context', 256]] as const) {
    const value = text(item[key], limit)
    if (value !== undefined) result[key] = value
  }
  const state = stateFrom(item.state)
  if (Object.keys(state).length > 0) result.state = state
  return result
}

function regionFrom(value: unknown): Record<string, JsonValue> | undefined {
  const item = object(value)
  if (item === undefined) return undefined
  const result: Record<string, JsonValue> = {}
  for (const [key, limit] of [['role', 64], ['kind', 64], ['label', 256], ['text', 512],
    ['importance', 32], ['stability', 32]] as const) {
    const value = text(item[key], limit)
    if (value !== undefined) result[key] = value
  }
  for (const key of ['disposable', 'protected'] as const) if (typeof item[key] === 'boolean') result[key] = item[key]
  const bounds = boundsFrom(item.bounds)
  if (bounds !== undefined) result.bounds = bounds
  return Object.keys(result).length > 0 ? result : undefined
}

function itemFrom(value: unknown, limits: Limits): Record<string, JsonValue> | undefined {
  const item = object(value), index = integer(item?.index)
  if (item === undefined || index === undefined) return undefined
  const result: Record<string, JsonValue> = { index }
  const itemText = text(item.text, 512)
  if (itemText !== undefined) result.text = itemText
  const controls = array(item.controls).slice(0, limits.controls).flatMap((control) => {
    const projected = elementFrom(control)
    return projected === undefined ? [] : [projected]
  })
  if (controls.length > 0) result.controls = controls
  return result
}

function collectionFrom(value: unknown, limits: Limits): Record<string, JsonValue> | undefined {
  const collection = object(value), kind = text(collection?.kind, 64)
  if (collection === undefined || kind === undefined) return undefined
  const sourceItems = array(collection.items)
  const items = sourceItems.slice(0, limits.items).flatMap((item) => {
    const projected = itemFrom(item, limits)
    return projected === undefined ? [] : [projected]
  })
  const result: Record<string, JsonValue> = { kind, items }
  for (const [key, limit] of [['label', 160], ['contextRole', 64]] as const) {
    const value = text(collection[key], limit)
    if (value !== undefined) result[key] = value
  }
  for (const key of ['itemCount', 'totalCount'] as const) {
    const value = integer(collection[key])
    if (value !== undefined) result[key] = value
  }
  if (collection.itemsTruncated === true || sourceItems.length > limits.items) result.itemsTruncated = true
  return result
}

function treeNodeFrom(value: unknown): Record<string, JsonValue> | undefined {
  const node = object(value), index = integer(node?.index), kind = text(node?.kind, 32)
  if (node === undefined || index === undefined || kind === undefined) return undefined
  const result: Record<string, JsonValue> = { index, kind }
  if (node.parentIndex === null) result.parentIndex = null
  else {
    const parentIndex = integer(node.parentIndex)
    if (parentIndex !== undefined) result.parentIndex = parentIndex
  }
  for (const [key, limit] of [['tag', 64], ['role', 64], ['label', 256], ['text', 256], ['elementId', 256]] as const) {
    const value = text(node[key], limit)
    if (value !== undefined) result[key] = value
  }
  return result
}

function sourceFrom(value: unknown): Record<string, JsonValue> | undefined {
  const source = object(value)
  const extractorVersion = source?.extractorVersion
  if (source?.version !== 1 || extractorVersion !== 'browser-source-v1' && extractorVersion !== 'browser-source-v2') return undefined
  const blocks: JsonValue[] = [], seen = new Set<string>()
  let characters = 0
  for (const input of array(source.contentBlocks).slice(0, 64)) {
    const block = object(input), blockId = text(block?.blockId, 128), ordinal = integer(block?.ordinal)
    const kind = text(block?.kind, 32), content = text(block?.text, Math.min(1200, 16000 - characters))
    if (block === undefined || blockId === undefined || ordinal === undefined || kind === undefined || content === undefined
      || characters >= 16000 || seen.has(blockId)) continue
    blocks.push({ blockId, ordinal, kind, text: content, truncated: block.truncated === true || content !== block.text })
    seen.add(blockId); characters += content.length
  }
  const omissions = array(source.omissions).flatMap(item => typeof item === 'string' ? [item.slice(0, 256)] : []).slice(0, 16)
  if (blocks.length < array(source.contentBlocks).length) omissions.push('部分来源块未保留')
  return { version: 1, extractorVersion, blocks, omissions }
}

function observationFrom(value: unknown, limits: Limits, allowFeedback = true): Record<string, JsonValue> | undefined {
  const source = object(value)
  if (source === undefined) return undefined
  const result: Record<string, JsonValue> = {}
  const page = pageFrom(source.page)
  if (page !== undefined) result.page = page
  const capturedSource = sourceFrom(source.source)
  if (capturedSource !== undefined) result.source = capturedSource
  for (const [key, limit] of [['snapshotId', 256], ['title', 512], ['treeCursor', 256]] as const) {
    const value = text(source[key], limit)
    if (value !== undefined) result[key] = value
  }
  const body = text(source.text, limits.text)
  if (body !== undefined) result.text = body
  for (const key of ['nextOffset', 'itemCount', 'totalCount'] as const) {
    const value = integer(source[key])
    if (value !== undefined) result[key] = value
  }
  for (const key of ['textTruncated', 'scanTruncated', 'truncated', 'treeTruncated', 'treeComplete', 'itemsTruncated'] as const) {
    if (typeof source[key] === 'boolean') result[key] = source[key]
  }
  const sourceElements = array(source.elements)
  const elements = sourceElements.slice(0, limits.elements).flatMap((item) => {
    const projected = elementFrom(item)
    return projected === undefined ? [] : [projected]
  })
  if (elements.length > 0) result.elements = elements
  if (sourceElements.length > limits.elements) result.scanTruncated = true
  const sourceRegions = array(source.regions)
  const regions = sourceRegions.slice(0, limits.regions).flatMap((item) => {
    const projected = regionFrom(item)
    return projected === undefined ? [] : [projected]
  })
  if (regions.length > 0) result.regions = regions
  if (sourceRegions.length > limits.regions) result.truncated = true
  const sourceCollections = array(source.collections)
  const collections = sourceCollections.slice(0, limits.collections).flatMap((item) => {
    const projected = collectionFrom(item, limits)
    return projected === undefined ? [] : [projected]
  })
  if (collections.length > 0) result.collections = collections
  const sourceItems = array(source.items)
  const items = sourceItems.slice(0, limits.items).flatMap((item) => {
    const projected = itemFrom(item, limits)
    return projected === undefined ? [] : [projected]
  })
  if (items.length > 0) result.items = items
  if (sourceItems.length > limits.items) result.itemsTruncated = true
  const sourceTree = array(source.tree)
  const tree = sourceTree.slice(0, limits.tree).flatMap((item) => {
    const projected = treeNodeFrom(item)
    return projected === undefined ? [] : [projected]
  })
  if (tree.length > 0) result.tree = tree
  if (sourceTree.length > limits.tree) result.treeTruncated = true
  const structure = object(source.structure)
  if (structure !== undefined) {
    const structureRegions = array(structure.regions).slice(0, limits.regions).flatMap((item) => {
      const projected = regionFrom(item)
      return projected === undefined ? [] : [projected]
    })
    const structureCollections = array(structure.collections).slice(0, limits.collections).flatMap((item) => {
      const projected = collectionFrom(item, limits)
      return projected === undefined ? [] : [projected]
    })
    result.structure = { ...(structureRegions.length > 0 ? { regions: structureRegions } : {}),
      ...(structureCollections.length > 0 ? { collections: structureCollections } : {}) }
    if (array(structure.regions).length > limits.regions || array(structure.collections).length > limits.collections) {
      result.truncated = true
    }
  }
  if (allowFeedback) {
    const feedback = object(source.feedback), status = text(feedback?.status, 32)
    if (feedback !== undefined && status !== undefined) {
      const snapshot = observationFrom(feedback.snapshot, limits, false)
      result.feedback = { status, ...(snapshot === undefined ? {} : { snapshot }) }
    }
  }
  if (typeof source.text === 'string' && source.text.length > limits.text) result.textTruncated = true
  return Object.keys(result).length > 0 ? result : undefined
}

function envelope(result: BrowserActionResult, limits: Limits): JsonValue {
  const projected: Record<string, JsonValue> = { requestId: result.requestId, sessionId: result.sessionId,
    installationId: result.installationId, outcome: result.outcome, delivery: result.delivery }
  if (result.reason !== undefined) projected.reason = result.reason.slice(0, 256)
  const value = observationFrom(result.value, limits)
  if (value !== undefined) projected.value = value
  return { browserObservation: { version: 1, result: projected } }
}

/** Project only page-atlas evidence and enforce a complete serialized metadata bound. */
export function browserObservationMeta(result: BrowserActionResult): JsonValue {
  const full = envelope(result, FULL)
  if (encoder.encode(JSON.stringify(full)).byteLength <= MAX_META_BYTES) return full
  const compact = envelope(result, COMPACT)
  if (encoder.encode(JSON.stringify(compact)).byteLength <= MAX_META_BYTES) return compact
  const source = object(result.value)
  const core: Record<string, JsonValue> = { requestId: result.requestId, sessionId: result.sessionId,
    installationId: result.installationId, outcome: result.outcome, delivery: result.delivery }
  const page = pageFrom(source?.page)
  const snapshotId = text(source?.snapshotId, 256), title = text(source?.title, 512)
  if (page !== undefined || snapshotId !== undefined || title !== undefined) {
    core.value = { ...(page === undefined ? {} : { page }), ...(snapshotId === undefined ? {} : { snapshotId }),
      ...(title === undefined ? {} : { title }), textTruncated: true, scanTruncated: true, treeTruncated: true }
  }
  return { browserObservation: { version: 1, result: core } }
}

function taskEnvelope(value: unknown, limits: Limits): JsonValue {
  const source = object(value), result: Record<string, JsonValue> = {}
  const taskId = text(source?.taskId, 256)
  if (taskId !== undefined) result.taskId = taskId
  const observation = observationFrom(source?.observation, limits)
  if (observation !== undefined) result.observation = observation
  return { browserObservation: { version: 1, result } }
}

/** Project a Browser Task's returned observation through the same bounded durable metadata path. */
export function browserTaskObservationMeta(value: unknown): JsonValue {
  const full = taskEnvelope(value, FULL)
  if (encoder.encode(JSON.stringify(full)).byteLength <= MAX_META_BYTES) return full
  return taskEnvelope(value, COMPACT)
}

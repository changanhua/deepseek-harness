import { projectContentMap } from './assistant-content-map.js'
import { sourceSnapshotFrom, projectSemanticState } from './assistant-semantic-state.js'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
const array = value => Array.isArray(value) ? value : []
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null
const text = (value, limit = 2000) => typeof value === 'string' ? value.slice(0, limit) : ''
const clone = value => structuredClone(value)

const pageFrom = value => {
  const page = object(value)
  return page && integer(page.tabId) !== null && integer(page.frameId) !== null && text(page.documentId, 256) && text(page.url, 4096)
    ? { tabId: page.tabId, frameId: page.frameId, documentId: page.documentId, url: page.url } : null
}
const pageKey = (sessionId, installationId, page) => JSON.stringify([sessionId, installationId, page.tabId, page.frameId, page.documentId, page.url])
const documentKey = (installationId, page) => `${installationId}\u0000${page.tabId}\u0000${page.frameId}`
const jsonObjectFromText = value => {
  if (typeof value !== 'string') return null
  for (const line of value.split('\n').reverse()) try { const parsed = JSON.parse(line); if (object(parsed)) return parsed } catch { /* untrusted prose */ }
  return null
}
const deliveredResult = (event, callId) => {
  if (event?.type !== 'tool/result' || event.surfaceOp !== 'append' || String(event.data?.message?.source?.callId ?? '') !== callId) return null
  const result = array(event.data?.message?.content).find(block => block?.type === 'tool-result' && String(block.toolCallId ?? '') === callId && block.isError === false)
  if (!result) return null
  const structured = object(object(event.data?.meta)?.browserObservation)
  const structuredResult = structured?.version === 1 ? object(structured.result) : null
  return structuredResult ?? array(result.content).flatMap(block => block?.type === 'text' ? [jsonObjectFromText(block.text)] : []).find(Boolean) ?? null
}
const argsFrom = event => { try { return object(JSON.parse(event?.data?.arguments ?? '{}')) ?? {} } catch { return {} } }
const regionsFrom = value => array(value.regions).length ? array(value.regions) : array(object(value.structure)?.regions)
const collectionsFrom = value => array(value.collections).length ? array(value.collections) : array(object(value.structure)?.collections)
const samePage = (left, right) => left?.tabId === right?.tabId && left?.frameId === right?.frameId && left?.documentId === right?.documentId && left?.url === right?.url
const safeState = value => Object.fromEntries(Object.entries(object(value) ?? {}).flatMap(([key, entry]) =>
  /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.test(key) && (typeof entry === 'boolean' || typeof entry === 'number' && Number.isFinite(entry) || typeof entry === 'string' || entry === null)
    ? [[key, typeof entry === 'string' ? text(entry, 256) : entry]] : []))
const sanitizedElements = value => array(value).slice(0, 128).flatMap(item => {
  const element = object(item); const elementId = text(element?.elementId, 256)
  if (!element || !elementId) return []
  return [{ elementId, role: text(element.role, 64), label: text(element.label, 256), text: text(element.text, 512), context: text(element.context, 512), state: safeState(element.state) }]
})
const sanitizedRegions = value => array(value).slice(0, 32).map(item => {
  const region = object(item) ?? {}; return { role: text(region.role || region.kind, 64) || 'region', label: text(region.label, 256), text: text(region.text, 2000),
    bounds: object(region.bounds), importance: ['high', 'medium', 'normal', 'low'].includes(region.importance) ? region.importance : 'normal', stability: text(region.stability, 32) }
})
const normalizedRegionBounds = regions => {
  const valid = regions.map(region => object(region.bounds)).filter(bounds => ['x', 'y', 'width', 'height'].every(key => typeof bounds?.[key] === 'number' && Number.isFinite(bounds[key])) && bounds.width > 0 && bounds.height > 0 && Math.abs(bounds.x) <= 1e7 && Math.abs(bounds.y) <= 1e7 && bounds.width <= 1e7 && bounds.height <= 1e7)
  if (valid.length !== regions.length || !valid.length) return regions.map(() => null)
  const left = Math.min(...valid.map(bounds => bounds.x)), top = Math.min(...valid.map(bounds => bounds.y)), right = Math.max(...valid.map(bounds => bounds.x + bounds.width)), bottom = Math.max(...valid.map(bounds => bounds.y + bounds.height))
  if (!(right > left && bottom > top)) return regions.map(() => null)
  return valid.map(bounds => ({ x: (bounds.x - left) / (right - left), y: (bounds.y - top) / (bottom - top), width: bounds.width / (right - left), height: bounds.height / (bottom - top) }))
}
const sanitizedCollections = value => collectionsFrom(value).flatMap(item => {
  const collection = object(item); const kind = text(collection?.kind, 64); if (!collection || !kind) return []
  const items = array(collection.items).slice(0, 128).flatMap(entry => {
      const row = object(entry); const index = integer(row?.index); return row && index !== null ? [{ index, text: text(row.text, 512), controls: sanitizedElements(row.controls) }] : []
  })
    return [{ kind, label: text(collection.label, 160), contextRole: text(collection.contextRole, 64), items, totalCount: integer(collection.totalCount), partial: collection.partial === true || collection.itemsTruncated === true || integer(collection.itemCount) === 128 }]
})
const extractedCollection = (value, args) => {
  const items = array(value.items).slice(0, 64).flatMap(entry => { const item = object(entry); const index = integer(item?.index); return item && index !== null ? [{ index, text: text(item.text, 512), controls: sanitizedElements(item.controls) }] : [] })
  return { kind: text(args.collectionKind, 64) || 'extract', items, totalCount: null, partial: value.itemsTruncated === true || integer(value.itemCount) === 128 }
}
const treeFrom = value => {
  const snapshotId = text(value.snapshotId, 256) || null
  const nodes = array(value.tree).slice(0, 128).flatMap(item => {
    const node = object(item)
    if (!node || integer(node.index) === null || !['document', 'openShadowRoot', 'element', 'text'].includes(node.kind)) return []
    return [{ index: node.index, parentIndex: node.parentIndex === null ? null : integer(node.parentIndex), kind: node.kind,
      ...(text(node.tag, 64) ? { tag: text(node.tag, 64) } : {}), ...(text(node.role, 64) ? { role: text(node.role, 64) } : {}),
      ...(text(node.label, 256) ? { label: text(node.label, 256) } : {}), ...(text(node.text, 256) ? { text: text(node.text, 256) } : {}),
      ...(text(node.elementId, 256) && snapshotId ? { elementId: text(node.elementId, 256), snapshotId } : {}) }]
  })
  return nodes.length ? { snapshotId, complete: value.treeComplete === true, cursor: text(value.treeCursor, 256) || null, nodes } : null
}
const itemFrom = ({ sessionId, callEvent, resultEvent, receipts }) => {
  const callId = text(callEvent.data?.callId, 256)
  const toolName = callEvent.data?.name
  const taskObservation = toolName === 'browser_task_start' || toolName === 'browser_task_verify'
  const observedTools = ['browser_snapshot', 'browser_page_map', 'browser_action', 'browser_extract', 'browser_task_start', 'browser_task_verify']
  if (!callId || !observedTools.includes(toolName) || !array(resultEvent.sourceEventSeqs).includes(callEvent.seq)) return null
  const result = deliveredResult(resultEvent, callId)
  if (!result) return null
  let value
  let installationId
  let requestId
  let receiptSeq
  if (taskObservation) {
    if (typeof result.taskId !== 'string') return null
    const receipt = [...receipts].reverse().find(event => event.seq > callEvent.seq && event.seq < resultEvent.seq
      && event.data?.taskId === result.taskId && event.data?.actionKind === 'snapshot')
    const observation = object(result.observation)
    const receiptPage = pageFrom(receipt?.data?.target?.page)
    const observationPage = pageFrom(observation?.page)
    if (!receipt || receipt.data?.outcome !== 'observed' || receipt.data?.delivery !== 'sent' || receipt.data?.quiescent !== true
      || typeof receipt.data?.requestId !== 'string' || typeof receipt.data?.target?.installationId !== 'string'
      || !receiptPage || !observationPage || !samePage(receiptPage, observationPage)) return null
    value = observation
    installationId = receipt.data.target.installationId
    requestId = receipt.data.requestId
    receiptSeq = receipt.seq
  } else {
    if (result.sessionId !== sessionId || result.outcome !== 'observed' || result.delivery !== 'sent'
      || typeof result.requestId !== 'string' || typeof result.installationId !== 'string') return null
    const actionValue = object(result.value)
    const feedback = toolName === 'browser_action' ? object(actionValue?.feedback) : null
    value = toolName === 'browser_action' ? feedback?.status === 'observed' ? object(feedback.snapshot) : null : actionValue
    installationId = result.installationId
    requestId = result.requestId
  }
  const page = pageFrom(value?.page)
  if (!value || !page) return null
  const args = argsFrom(callEvent)
  const extracted = toolName === 'browser_extract' ? extractedCollection(value, args) : null
  const elements = [...sanitizedElements(value.elements), ...(extracted?.items.flatMap(item => item.controls) ?? [])]
  const regions = sanitizedRegions(regionsFrom(value))
  const collections = extracted
    ? [{ kind: extracted.kind, items: extracted.items.map(({ controls, ...item }) => item), partial: extracted.partial, totalCount: extracted.totalCount }]
    : sanitizedCollections(value)
  const tree = array(value.tree)
  const treeCursor = text(value.treeCursor, 256) || null
  const readMode = toolName === 'browser_page_map' ? 'page-map'
    : toolName === 'browser_action' ? 'feedback-snapshot'
      : toolName === 'browser_extract' ? 'extract'
        : taskObservation ? `${toolName === 'browser_task_start' ? 'task-start' : 'task-verify'}-observation`
          : args.tree === true || tree.length ? 'tree' : 'snapshot'
  const source = { toolCallSeq: callEvent.seq, toolResultSeq: resultEvent.seq, callId, toolName, requestId,
    ...(receiptSeq === undefined ? {} : { receiptSeq }) }
  const scope = { textChars: text(value.text).length, elementCount: array(value.elements).length,
    treeNodeCount: tree.length, regionCount: regions.length, offset: integer(args.offset) ?? 0,
    limit: integer(args.limit), treeLimit: integer(args.treeLimit) }
  const omissions = { textTruncated: value.textTruncated === true,
    scanTruncated: value.scanTruncated === true || value.truncated === true,
    treeTruncated: value.treeTruncated === true || treeCursor !== null, nextOffset: integer(value.nextOffset), treeCursor }
  const previewRegions = regionsFrom(value).slice(0, 32).map(region => ({
    ...(text(region?.role || region?.kind, 64) ? { role: text(region.role || region.kind, 64) } : {}),
    ...(text(region?.label, 256) ? { label: text(region.label, 256) } : {}),
    ...(typeof region?.disposable === 'boolean' ? { disposable: region.disposable } : {}),
    ...(typeof region?.protected === 'boolean' ? { protected: region.protected } : {}),
  }))
  return { id: `${sessionId}:${resultEvent.seq}`, sessionId, target: { installationId, page }, source,
    observedAt: resultEvent.time, readMode, documentState: 'current', locatorsValid: true,
    title: text(value.title, 512), snapshotId: text(value.snapshotId, 256) || null, elements, regions, collections,
    sourceSnapshot: sourceSnapshotFrom(value.source),
    scope, omissions, preview: { text: text(value.text), labels: elements.flatMap(element => element.label ? [element.label] : []).slice(0, 32), regions: previewRegions },
    ...(treeFrom(value) ? { tree: treeFrom(value) } : {}) }
}
const pageTypeFrom = observations => {
  const nodes = observations.flatMap(observation => observation.tree?.nodes ?? [])
  if (nodes.some(node => node.tag === 'article' || node.role === 'article')) return 'article'
  if (nodes.some(node => node.role === 'feed')) return 'feed'
  if (nodes.some(node => ['ul', 'ol', 'menu'].includes(node.tag) || node.role === 'list')) return 'list'
  if (nodes.some(node => node.tag === 'form' || node.role === 'form')) return 'form'
  return 'unknown'
}
const omissionStrings = observation => [observation.omissions.textTruncated && '正文超出本次读取范围', observation.omissions.scanTruncated && '其余可操作控件未读取', observation.omissions.treeTruncated && '其余 DOM 节点未读取', observation.omissions.nextOffset !== null && '控件分页仍有后续结果'].filter(Boolean)
const regionKey = region => region.label ? `${region.role}\u0000${region.label}` : region.text ? `${region.role}\u0000${region.text}` : null
const actionFrom = (observation, element, index, valid) => ({ id: `${observation.id}:${element.elementId}${index ? `:${index}` : ''}`, observationId: observation.id, snapshotId: observation.snapshotId, elementId: element.elementId, role: element.role, label: element.label, state: clone(element.state), locatorsValid: valid })

/** Projects only delivered Browser observations; it never reads a page or starts a timer. */
export const projectAssistantCognition = ({ sessionId, records, now = Date.now(), historyIncomplete = false }) => {
  if (typeof sessionId !== 'string' || !sessionId) return { status: 'unread', pages: [], refreshPolicy: 'manual-or-agent-request' }
  const calls = new Map(), receipts = [], items = [], seen = new Set()
  for (const record of array(records)) {
    const event = record?.event; if (!event || !Number.isSafeInteger(event.seq)) continue
    if (event.type === 'tool/call' && typeof event.data?.callId === 'string') { calls.set(event.data.callId, event); continue }
    if (event.type === 'browser-task/receipt') { receipts.push(event); continue }
    if (event.type !== 'tool/result' || seen.has(event.seq)) continue
    const callEvent = calls.get(String(event.data?.message?.source?.callId ?? '')); if (!callEvent) continue
    const item = itemFrom({ sessionId, callEvent, resultEvent: event, receipts }); if (!item) continue
    seen.add(event.seq); items.push(item)
  }
  items.sort((left, right) => left.source.toolResultSeq - right.source.toolResultSeq)
  const currentDocuments = new Map(); for (const item of items) currentDocuments.set(documentKey(item.target.installationId, item.target.page), item.target.page)
  const groups = new Map()
  for (const item of items) { const key = pageKey(sessionId, item.target.installationId, item.target.page); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item) }
  const pages = [...groups.entries()].map(([id, observations]) => {
    const first = observations[0], current = samePage(currentDocuments.get(documentKey(first.target.installationId, first.target.page)), first.target.page)
    const latestSnapshot = [...observations].reverse().find(observation => observation.snapshotId)
    const fresh = current && typeof now === 'number' && Number.isFinite(now) && latestSnapshot && now >= latestSnapshot.observedAt && now - latestSnapshot.observedAt <= 60000
    for (const observation of observations) observation.locatorsValid = Boolean(fresh && observation.id === latestSnapshot.id)
    const mapObservations = observations.filter(observation => observation.readMode === 'page-map' && observation.regions.length)
    const regionObservations = mapObservations.length ? mapObservations : observations.filter(observation => observation.regions.length)
    for (const observation of regionObservations) {
      const bounds = normalizedRegionBounds(observation.regions)
      observation.regions = observation.regions.map((region, index) => ({ ...region, bounds: bounds[index] }))
    }
    const latestRegionObservation = regionObservations.at(-1), stableIds = new Map()
    for (const observation of regionObservations) { const counts = new Map(); for (const region of observation.regions) { const key = regionKey(region); if (key) counts.set(key, (counts.get(key) ?? 0) + 1) }; observation.regions.forEach((region, index) => { const key = regionKey(region); if (key && counts.get(key) === 1 && !stableIds.has(key)) stableIds.set(key, `${observation.id}:region:${index}`) }) }
    const latestCounts = new Map(); for (const region of latestRegionObservation?.regions ?? []) { const key = regionKey(region); if (key) latestCounts.set(key, (latestCounts.get(key) ?? 0) + 1) }
    const latestBounds = normalizedRegionBounds(latestRegionObservation?.regions ?? [])
    const regions = (latestRegionObservation?.regions ?? []).map((region, index) => {
      const key = regionKey(region), stable = key && latestCounts.get(key) === 1 ? stableIds.get(key) : null
      const evidenceOmissions = omissionStrings(latestRegionObservation); const omissions = [...evidenceOmissions, ...(region.bounds ? [] : ['区域边界不可用'])]
      return { id: stable ?? `${latestRegionObservation.id}:region:${index}`, role: region.role, label: region.label, text: region.text, bounds: latestBounds[index], importance: region.importance, coverage: evidenceOmissions.length ? 'partial' : region.text || region.label ? 'observed' : 'unread', actions: [], collections: [], omissions: [...evidenceOmissions, ...(latestBounds[index] ? [] : ['区域边界不可用'])], evidenceIds: [latestRegionObservation.id], anchorActionId: null }
    })
    const collections = observations.flatMap(observation => observation.collections.map(collection => ({ kind: collection.kind, items: clone(collection.items), observedCount: collection.items.length, totalCount: collection.totalCount ?? null, partial: collection.partial, evidenceIds: [observation.id] })))
    const unplacedActions = []
    for (const observation of observations.filter(observation => observation.id === latestSnapshot?.id)) observation.elements.forEach((element, index) => {
      const action = actionFrom(observation, element, index, Boolean(fresh && observation.id === latestSnapshot?.id))
      const candidates = regions.filter(region => region.evidenceIds[0] === observation.id && element.context && [region.label, region.text].includes(element.context))
      if (candidates.length === 1) { candidates[0].actions.push(action); if (!candidates[0].anchorActionId) candidates[0].anchorActionId = action.id } else unplacedActions.push(action)
    })
    const omissions = [...new Set([...observations.flatMap(omissionStrings), ...(latestRegionObservation?.readMode === 'page-map' && latestRegionObservation.regions.length === 32 ? ['页面地图可能截断'] : []), ...(latestRegionObservation?.readMode !== 'page-map' && latestRegionObservation?.regions.length === 24 ? ['结构区域可能截断'] : []), ...(collections.some(collection => collection.observedCount >= 24 || collection.partial) ? ['结构摘要可能截断'] : []), ...(historyIncomplete ? ['早期证据不完整'] : []), ...(!current ? ['该页面后续状态未读取'] : [])])]
    return { id, sessionId, target: clone(first.target), title: [...observations].reverse().map(observation => observation.title).find(Boolean) || first.target.page.url, pageType: pageTypeFrom(observations), documentState: current ? 'current' : 'previous-document', observations: observations.map(clone), regions, unplacedActions, collections,
      coverage: { observationCount: observations.length, textChars: latestSnapshot?.scope.textChars ?? 0, elementCount: latestSnapshot?.scope.elementCount ?? 0, treeNodeCount: latestSnapshot?.scope.treeNodeCount ?? 0, regionCount: regions.length, totalKnown: false }, omissions, locatorsValid: Boolean(fresh) }
  })
  return { status: pages.length ? 'ready' : 'unread',
    pages: pages.map(page => ({ ...page, content: projectContentMap(page), ...projectSemanticState(page, array(records)) })),
    refreshPolicy: 'manual-or-agent-request' }
}

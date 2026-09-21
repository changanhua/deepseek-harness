const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
const array = value => Array.isArray(value) ? value : []
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null
const clone = value => structuredClone(value)

const pageFrom = value => {
  const page = object(value)
  return page && integer(page.tabId) !== null && integer(page.frameId) !== null
    && typeof page.documentId === 'string' && page.documentId
    && typeof page.url === 'string' && page.url
    ? { tabId: page.tabId, frameId: page.frameId, documentId: page.documentId, url: page.url }
    : null
}

const jsonObjectFromText = text => {
  if (typeof text !== 'string') return null
  for (const line of text.split('\n').reverse()) {
    try {
      const parsed = JSON.parse(line)
      if (object(parsed)) return parsed
    } catch { /* Human-readable Tool prefixes are not JSON. */ }
  }
  return null
}

const deliveredResult = (event, callId) => {
  if (event?.type !== 'tool/result' || event.surfaceOp !== 'append') return null
  if (String(event.data?.message?.source?.callId ?? '') !== callId) return null
  const result = array(event.data?.message?.content).find(block => block?.type === 'tool-result'
    && String(block.toolCallId ?? '') === callId && block.isError === false)
  if (!result) return null
  for (const block of array(result.content)) {
    if (block?.type !== 'text') continue
    const parsed = jsonObjectFromText(block.text)
    if (parsed) return parsed
  }
  return null
}

const argsFrom = event => {
  try {
    const parsed = JSON.parse(event?.data?.arguments ?? '{}')
    return object(parsed) ?? {}
  } catch { return {} }
}

const regionsFrom = value => {
  const direct = array(value.regions)
  if (direct.length) return direct
  return array(object(value.structure)?.regions)
}

const samePage = (left, right) => left?.tabId === right?.tabId && left?.frameId === right?.frameId
  && left?.documentId === right?.documentId && left?.url === right?.url

const regionPreview = value => regionsFrom(value).slice(0, 32).map(item => {
  const region = object(item) ?? {}
  return {
    ...(typeof region.role === 'string' ? { role: region.role } : {}),
    ...(typeof region.label === 'string' ? { label: region.label } : {}),
    ...(typeof region.disposable === 'boolean' ? { disposable: region.disposable } : {}),
    ...(typeof region.protected === 'boolean' ? { protected: region.protected } : {}),
  }
})
const treeFrom = value => {
  const snapshotId = typeof value.snapshotId === 'string' ? value.snapshotId : null
  const nodes = array(value.tree).slice(0, 128).flatMap(item => {
    const node = object(item)
    if (!node || integer(node.index) === null || !['document', 'openShadowRoot', 'element', 'text'].includes(node.kind)) return []
    return [{ index: node.index, parentIndex: node.parentIndex === null ? null : integer(node.parentIndex), kind: node.kind,
      ...(typeof node.tag === 'string' ? { tag: node.tag.slice(0, 64) } : {}),
      ...(typeof node.role === 'string' ? { role: node.role.slice(0, 64) } : {}),
      ...(typeof node.label === 'string' ? { label: node.label.slice(0, 256) } : {}),
      ...(typeof node.text === 'string' ? { text: node.text.slice(0, 256) } : {}),
      ...(typeof node.elementId === 'string' && snapshotId ? { elementId: node.elementId, snapshotId } : {}) }]
  })
  return nodes.length ? { snapshotId, complete: value.treeComplete === true, cursor: typeof value.treeCursor === 'string' ? value.treeCursor : null, nodes } : null
}

const itemFrom = ({ sessionId, callEvent, resultEvent, receipts }) => {
  const callId = String(callEvent.data?.callId ?? '')
  const toolName = callEvent.data?.name
  const taskObservation = toolName === 'browser_task_start' || toolName === 'browser_task_verify'
  if (!callId || !['browser_snapshot', 'browser_page_map', 'browser_action',
    'browser_task_start', 'browser_task_verify'].includes(toolName)) return null
  if (!array(resultEvent.sourceEventSeqs).includes(callEvent.seq)) return null
  const result = deliveredResult(resultEvent, callId)
  if (!result) return null
  let value
  let installationId
  let requestId
  let receiptSeq
  if (taskObservation) {
    if (typeof result.taskId !== 'string') return null
    const receipt = [...receipts].reverse().find(event => event.seq > callEvent.seq
      && event.seq < resultEvent.seq && event.data?.taskId === result.taskId
      && event.data?.actionKind === 'snapshot')
    const receiptPage = pageFrom(receipt?.data?.target?.page)
    const observation = object(result.observation)
    const observationPage = pageFrom(observation?.page)
    if (!receipt || receipt.data?.outcome !== 'observed' || receipt.data?.delivery !== 'sent'
      || receipt.data?.quiescent !== true || typeof receipt.data?.requestId !== 'string'
      || typeof receipt.data?.target?.installationId !== 'string' || !receiptPage || !observationPage
      || !samePage(receiptPage, observationPage)) return null
    value = observation
    installationId = receipt.data.target.installationId
    requestId = receipt.data.requestId
    receiptSeq = receipt.seq
  } else {
    if (result.sessionId !== sessionId || result.outcome !== 'observed' || result.delivery !== 'sent'
      || typeof result.requestId !== 'string' || typeof result.installationId !== 'string') return null
    const actionValue = object(result.value)
    const feedback = toolName === 'browser_action' ? object(actionValue?.feedback) : null
    value = toolName === 'browser_action'
      ? feedback?.status === 'observed' ? object(feedback.snapshot) : null
      : actionValue
    installationId = result.installationId
    requestId = result.requestId
  }
  const page = pageFrom(value?.page)
  if (!value || !page) return null
  const args = argsFrom(callEvent)
  const elements = array(value.elements)
  const tree = array(value.tree)
  const regions = regionsFrom(value)
  const nextOffset = integer(value.nextOffset)
  const treeCursor = typeof value.treeCursor === 'string' && value.treeCursor ? value.treeCursor : null
  const readMode = toolName === 'browser_page_map' ? 'page-map'
    : toolName === 'browser_action' ? 'feedback-snapshot'
      : toolName === 'browser_task_start' ? 'task-start-observation'
        : toolName === 'browser_task_verify' ? 'task-verify-observation'
      : args.tree === true || tree.length ? 'tree' : 'snapshot'
  return {
    id: `${sessionId}:${resultEvent.seq}`,
    sessionId,
    target: { installationId, page },
    source: { toolCallSeq: callEvent.seq, toolResultSeq: resultEvent.seq, callId, toolName,
      requestId, ...(receiptSeq === undefined ? {} : { receiptSeq }) },
    observedAt: resultEvent.time,
    readMode,
    documentState: 'current',
    locatorsValid: true,
    scope: {
      textChars: typeof value.text === 'string' ? value.text.length : 0,
      elementCount: elements.length,
      treeNodeCount: tree.length,
      regionCount: regions.length,
      offset: integer(args.offset) ?? 0,
      limit: integer(args.limit),
      treeLimit: integer(args.treeLimit),
    },
    omissions: {
      textTruncated: value.textTruncated === true,
      scanTruncated: value.scanTruncated === true || value.truncated === true,
      treeTruncated: value.treeTruncated === true || treeCursor !== null,
      nextOffset,
      treeCursor,
    },
    preview: {
      text: typeof value.text === 'string' ? value.text.slice(0, 2000) : '',
      labels: elements.flatMap(element => typeof element?.label === 'string' && element.label ? [element.label] : []).slice(0, 32),
      regions: regionPreview(value),
    },
    ...(treeFrom(value) ? { tree: treeFrom(value) } : {}),
  }
}

/**
 * Derive bounded page cognition only from committed Browser Tool results that
 * were actually delivered to the Agent. Browser receipts and live provider
 * settlements carry lifecycle proof, but never become page content here.
 */
export const projectAssistantCognition = ({ sessionId, records }) => {
  if (typeof sessionId !== 'string' || !sessionId) {
    return { status: 'unread', items: [], refreshPolicy: 'manual-or-agent-request' }
  }
  const calls = new Map()
  const receipts = []
  const items = []
  const seen = new Set()
  for (const record of array(records)) {
    const event = record?.event
    if (!event || !Number.isSafeInteger(event.seq)) continue
    if (event.type === 'tool/call' && typeof event.data?.callId === 'string') {
      calls.set(event.data.callId, event)
      continue
    }
    if (event.type === 'browser-task/receipt') {
      receipts.push(event)
      continue
    }
    if (event.type !== 'tool/result' || seen.has(event.seq)) continue
    const callId = String(event.data?.message?.source?.callId ?? '')
    const callEvent = calls.get(callId)
    if (!callEvent) continue
    const item = itemFrom({ sessionId, callEvent, resultEvent: event, receipts })
    if (!item) continue
    seen.add(event.seq)
    items.push(item)
  }
  const latest = new Map()
  for (const item of items) {
    const page = item.target.page
    latest.set(`${item.target.installationId}\u0000${page.tabId}\u0000${page.frameId}`, page)
  }
  const projected = items.map(item => {
    const page = item.target.page
    const current = latest.get(`${item.target.installationId}\u0000${page.tabId}\u0000${page.frameId}`)
    const sameDocument = current?.documentId === page.documentId && current?.url === page.url
    return sameDocument ? clone(item) : { ...clone(item), documentState: 'previous-document', locatorsValid: false }
  })
  return { status: projected.length ? 'ready' : 'unread', items: projected,
    refreshPolicy: 'manual-or-agent-request' }
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
const array = value => Array.isArray(value) ? value : []

export const sourceSnapshotFrom = value => {
  const source = object(value)
  if (source?.version !== 1 || !['browser-source-v1', 'browser-source-v2'].includes(source.extractorVersion)) return null
  const blocks = [], seen = new Set()
  let characters = 0
  for (const block of array(source.blocks).slice(0, 64)) {
    if (!object(block) || typeof block.blockId !== 'string' || !/^block-\d+$/u.test(block.blockId) || seen.has(block.blockId)
      || !Number.isSafeInteger(block.ordinal) || block.ordinal < 0 || typeof block.kind !== 'string' || typeof block.text !== 'string'
      || block.text.length > 1200 || characters + block.text.length > 16000) return null
    seen.add(block.blockId); characters += block.text.length
    blocks.push({ blockId: block.blockId, ordinal: block.ordinal, kind: block.kind.slice(0, 32), text: block.text, truncated: block.truncated === true })
  }
  return { version: 1, extractorVersion: source.extractorVersion, blocks,
    omissions: array(source.omissions).filter(value => typeof value === 'string').slice(0, 16).map(value => value.slice(0, 256)) }
}

export const projectSemanticState = (page, records) => {
  const observations = page.observations.filter(observation => observation.sourceSnapshot)
  const calls = new Map(), candidates = []
  for (const record of records) {
    const event = record.event
    if (event?.type === 'tool/call') { calls.set(event.data.callId, event); continue }
    if (event?.type !== 'tool/result' || event.surfaceOp !== 'append') continue
    const callId = event.data?.message?.source?.callId, call = calls.get(callId)
    if (call?.data?.name !== 'browser_publish_semantic_map' || !array(event.sourceEventSeqs).includes(call.seq)) continue
    if (!array(event.data?.message?.content).some(block => block.type === 'tool-result' && block.toolCallId === callId && block.isError === false)) continue
    const map = object(event.data?.meta?.semanticMap)
    if (!map || map.version !== 1 || typeof map.mapId !== 'string' || map.installationId !== page.target.installationId
      || !['tabId', 'frameId', 'documentId', 'url'].every(key => map.page?.[key] === page.target.page[key])) continue
    const source = observations.find(observation => observation.source.toolResultSeq === map.sourceResultSeq && observation.snapshotId === map.snapshotId)
    if (!source) continue
    const available = new Set(source.sourceSnapshot.blocks.map(block => block.blockId)), ids = new Set(), nodes = []
    let valid = array(map.nodes).length > 0 && array(map.nodes).length <= 64
    for (const node of array(map.nodes)) {
      if (!object(node) || typeof node.nodeId !== 'string' || ids.has(node.nodeId) || node.parentId !== null && !ids.has(node.parentId)
        || node.origin !== 'ai-summary' || typeof node.label !== 'string' || !node.label || node.label.length > 96
        || typeof node.summary !== 'string' || node.summary.length > 500 || !array(node.sourceRefs).length
        || array(node.sourceRefs).length > 16 || !node.sourceRefs.every(id => available.has(id))) { valid = false; break }
      ids.add(node.nodeId)
      nodes.push({ nodeId: node.nodeId, parentId: node.parentId, label: node.label, summary: node.summary, sourceRefs: [...new Set(node.sourceRefs)], origin: 'ai-summary' })
    }
    if (!valid) continue
    const organized = new Set(nodes.flatMap(node => node.sourceRefs))
    candidates.push({ source, semanticMap: { mapId: map.mapId, snapshotId: map.snapshotId, sourceResultSeq: map.sourceResultSeq, toolCallSeq: call.seq, nodes,
      unorganizedBlockIds: [...available].filter(id => !organized.has(id)) } })
  }
  const candidate = candidates[0], source = candidate?.source ?? observations.at(-1)
  const latest = page.observations.findLast(observation => observation.snapshotId)
  const sourceSnapshots = observations.map(item => ({ ...item.sourceSnapshot, snapshotId: item.snapshotId, observationId: item.id,
    sourceResultSeq: item.source.toolResultSeq, current: page.documentState === 'current' && latest?.snapshotId === item.snapshotId,
    readingBlockId: null }))
  const sourceSnapshot = sourceSnapshots.find(item => item.observationId === source?.id) ?? null
  return { sourceSnapshot, sourceSnapshots, semanticMap: candidate?.semanticMap ?? null, semanticMaps: candidates.map(item => item.semanticMap) }
}

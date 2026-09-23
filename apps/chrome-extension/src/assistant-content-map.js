const clean = value => typeof value === 'string' ? value.trim() : ''
const chromeRoles = new Set(['header', 'banner', 'nav', 'navigation', 'footer', 'contentinfo'])
const collectionNames = { feed: '动态内容', list: '列表内容', ul: '列表内容', ol: '有序列表', grid: '表格内容', table: '表格内容', results: '搜索结果', extract: '提取的条目' }
const headingLevel = node => /^h[1-6]$/u.test(node.tag ?? '') ? Number(node.tag[1]) : node.role === 'heading' ? 2 : 0
const groupBase = (id, observation) => ({ id, parentId: null, title: '', kind: 'section', excerpt: '', items: [], actionIds: [],
  evidenceIds: [observation.id], coverage: 'partial', totalCount: null })

// Relations come from delivered headings, collection membership, or exact control context.
// Page geometry does not establish a semantic relation; observations are never merged by text similarity.
export const projectContentMap = page => {
  const observations = page.observations ?? []
  const observation = observations.findLast(item => item.snapshotId) ?? observations.at(-1)
  const groups = [], gaps = [...(page.omissions ?? [])]
  const actions = [...(page.regions ?? []).flatMap(region => region.actions ?? []), ...(page.unplacedActions ?? [])]
  const actionFor = elementId => actions.find(action => action.observationId === observation?.id && action.elementId === elementId)
  const attach = (group, action) => { if (action && !group.actionIds.includes(action.id)) group.actionIds.push(action.id) }
  if (observation) {
    const treePages = observation.tree ? observations.filter(item => item.snapshotId === observation.snapshotId && item.tree) : []
    const treeNodes = new Map(), nodeSources = new Map()
    for (const treePage of treePages) for (const entry of treePage.tree.nodes) { treeNodes.set(entry.index, entry); nodeSources.set(entry.index, treePage) }
    const nodes = [...treeNodes.values()].sort((left, right) => left.index - right.index).slice(0, 1024)
    if (treeNodes.size > nodes.length) gaps.push('结构分组只包含前 1024 个已读节点')
    const byIndex = new Map(nodes.map(node => [node.index, node]))
    const scopeOf = node => {
      let ancestor = byIndex.get(node.parentIndex), steps = 0
      while (ancestor && steps++ <= nodes.length) {
        if (['main', 'article', 'section', 'aside'].includes(ancestor.tag) || ['main', 'article', 'region', 'complementary'].includes(ancestor.role)) return ancestor.index
        ancestor = byIndex.get(ancestor.parentIndex)
      }
      return null
    }
    const addSource = (group, node) => { const id = nodeSources.get(node.index)?.id; if (id && !group.evidenceIds.includes(id)) group.evidenceIds.push(id) }
    const outsideContent = node => {
      let ancestor = node, steps = 0
      while (ancestor && steps++ <= nodes.length) {
        if (chromeRoles.has(ancestor.role) || chromeRoles.has(ancestor.tag)) return true
        ancestor = byIndex.get(ancestor.parentIndex)
      }
      return false
    }
    const descendants = node => {
      const result = []
      for (const candidate of nodes) {
        let parent = candidate.parentIndex, steps = 0
        while (parent !== null && parent !== undefined && steps++ < nodes.length) {
          if (parent === node.index) { result.push(candidate); break }
          parent = byIndex.get(parent)?.parentIndex
        }
      }
      return result
    }
    const headingTextNodes = new Set(), stack = [], ungrouped = new Map()
    let current = null, currentScope = null
    for (const node of nodes) {
      if (outsideContent(node)) continue
      const level = headingLevel(node)
      if (level) {
        const children = descendants(node)
        children.forEach(child => headingTextNodes.add(child.index))
        const title = clean(node.label || node.text || children.filter(child => child.kind === 'text').map(child => child.text).filter(Boolean).join(' '))
        if (!title) continue
        const scope = scopeOf(node)
        if (scope !== currentScope) stack.splice(0)
        while (stack.length && stack.at(-1).level >= level) stack.pop()
        if (title === page.title && level === 1) { current = null; continue }
        currentScope = scope
        current = { ...groupBase(`${observation.id}:heading:${node.index}`, nodeSources.get(node.index) ?? observation), title, parentId: stack.at(-1)?.id ?? null }
        children.forEach(child => addSource(current, child))
        groups.push(current); stack.push({ level, id: current.id })
      } else if (!headingTextNodes.has(node.index)) {
        const scope = scopeOf(node)
        if (current && scope === currentScope) {
          if (node.kind === 'text' && clean(node.text)) { current.excerpt = `${current.excerpt}${current.excerpt ? '\n' : ''}${clean(node.text)}`.slice(0, 2000); addSource(current, node) }
        } else if (node.kind === 'text' && clean(node.text)) {
          if (!ungrouped.has(scope)) ungrouped.set(scope, { ...groupBase(`${observation.id}:unplaced:${scope ?? node.index}`, nodeSources.get(node.index) ?? observation), title: clean(byIndex.get(scope)?.label) || '其他已读片段', kind: 'excerpt' })
          const group = ungrouped.get(scope); group.excerpt = `${group.excerpt}${group.excerpt ? '\n' : ''}${clean(node.text)}`.slice(0, 2000); addSource(group, node)
        }
      }
    }
    groups.push(...ungrouped.values())
    if (!groups.length) {
      const candidates = observation.regions ?? []
      const hasSections = candidates.some(region => region.role === 'section' && region.label)
      for (let index = 0; index < candidates.length; index++) {
        const region = candidates[index], excerpt = clean(region.text), label = clean(region.label)
        if (hasSections && region.role !== 'section') continue
        if (chromeRoles.has(region.role) || (!excerpt && !label)) continue
        if (groups.some(group => group.excerpt === excerpt && group.title === (label || '主要内容'))) continue
        const projected = (page.regions ?? []).find(item => item.evidenceIds?.includes(observation.id) && item.role === region.role && item.label === region.label && item.text === region.text)
        const group = { ...groupBase(projected?.id ?? `${observation.id}:content:${index}`, observation), title: label || '主要内容', excerpt }
        for (const action of projected?.actions ?? []) attach(group, action)
        if (label && candidates.filter(item => item.label === label).length === 1) {
          for (const element of observation.elements ?? []) if (element.context === label) attach(group, actionFor(element.elementId))
        }
        groups.push(group)
      }
    }
    for (const [index, collection] of (observation.collections ?? []).entries()) {
      if (chromeRoles.has(collection.contextRole)) continue
      if (!collection.items?.some(item => clean(item.text))) continue
      const group = { ...groupBase(`${observation.id}:collection:${index}`, observation), kind: 'collection',
        title: clean(collection.label) || collectionNames[collection.kind] || '内容集合', items: collection.items.map(item => ({ index: item.index, text: item.text })),
        totalCount: collection.totalCount ?? null, coverage: collection.partial ? 'partial' : 'observed' }
      for (const item of collection.items) for (const control of item.controls ?? []) attach(group, actionFor(control.elementId))
      groups.push(group)
    }
    const excerpt = clean(observation.preview?.text)
    if (!groups.length && excerpt) groups.push({ ...groupBase(`${observation.id}:excerpt`, observation), title: '已读页面片段', kind: 'excerpt', excerpt })
    if (groups.length > 24) { groups.splice(24); gaps.push('内容分组只展示前 24 组，其余保留在读取证据中') }
  }
  if (!groups.length) gaps.push('还没有足够的正文或列表内容，无法组织页面主题')
  if (!gaps.length) gaps.push('未读取的内容范围尚不确定')
  const retained = new Set(groups.map(group => group.id))
  for (const group of groups) if (group.parentId && !retained.has(group.parentId)) group.parentId = null
  const visibleActions = new Set(groups.flatMap(group => group.actionIds))
  return { status: groups.length ? 'ready' : 'insufficient', groups, gaps: [...new Set(gaps)],
    unplacedActionIds: actions.filter(action => !visibleActions.has(action.id)).map(action => action.id),
    observationId: observation?.id ?? null }
}

const node = (tag, className, text) => {
  const element = document.createElement(tag)
  element.className = className
  if (text !== undefined) element.textContent = text
  return element
}
const button = (text, handler, className = '') => {
  const element = node('button', className, text)
  element.type = 'button'; element.addEventListener('click', handler)
  return element
}
const kindName = group => group.kind === 'collection' ? '集合' : group.kind === 'excerpt' ? '正文片段' : '内容分支'

/** Renders a delivered content graph. Selecting a branch never reads or operates the website. */
export const renderContentMap = (page, { canLocate, selectedId, onSelect, onReveal }) => {
  const content = page.content ?? { groups: [], gaps: ['还没有可组织的页面内容'], unplacedActionIds: [] }
  const groups = content.groups, actions = [...(page.regions ?? []).flatMap(region => region.actions ?? []), ...(page.unplacedActions ?? [])]
  const actionById = new Map(actions.map(action => [action.id, action]))
  const layout = node('div', 'atlas-layout'), map = node('section', 'atlas-map'), inspector = node('aside', 'atlas-inspector')
  map.setAttribute('aria-label', '页面内容与分组关系')
  const root = node('div', 'atlas-root')
  root.append(node('span', 'atlas-eyebrow', '已读内容'), node('strong', '', page.title), node('p', '', groups.length ? `${groups.length} 个内容分组 · 连线表示章节或集合的从属关系` : '内容不足，暂时无法形成语义地图'))
  map.append(root)
  const live = node('p', 'atlas-live'); live.id = 'atlas-selection-status'; live.setAttribute('aria-live', 'polite')
  const actionButton = (id, primary = false) => {
    const action = actionById.get(id)
    if (!action) return null
    const control = button(primary ? '定位到页面' : action.label || action.role || '定位元素', () => onReveal(id), 'atlas-locate')
    control.disabled = !canLocate || !action.locatorsValid
    control.title = !action.locatorsValid ? '引用已过期，刷新后才能定位。' : !canLocate ? '当前固定目标与这份内容不一致。' : `在原页面标出：${action.label || action.role}`
    return control
  }
  const renderInspector = group => {
    inspector.replaceChildren(live)
    live.textContent = group ? `已选择内容：${group.title}` : '选择一个内容分支，查看完整片段与来源。'
    if (!group) { inspector.append(node('h3', '', '从内容出发'), node('p', '', '地图直接展示已读到的正文与条目。选择分支只查看详情；定位按钮会在固定网页中标出原位置。')); return }
    inspector.append(node('h3', '', group.title))
    const known = node('section', 'atlas-known'); known.append(node('h4', '', '掌握内容'))
    if (group.excerpt) known.append(node('p', 'atlas-full-excerpt', group.excerpt))
    if (group.items?.length) { const list = node('ol', 'atlas-full-items'); for (const item of group.items) list.append(node('li', '', item.text)); known.append(list) }
    if (!group.excerpt && !group.items?.length) known.append(node('p', '', '目前只读到了这个标题，下方内容尚未取得。'))
    inspector.append(known)
    if (group.actionIds?.length) { const controls = node('section', 'atlas-group-actions'); controls.append(node('h4', '', '在原页面定位')); for (const id of group.actionIds) { const control = actionButton(id); if (control) controls.append(control) }; inspector.append(controls) }
    const source = node('section', 'atlas-source'); source.append(node('h4', '', '内容来源'))
    for (const id of group.evidenceIds ?? []) {
      const index = (page.observations ?? []).findIndex(observation => observation.id === id)
      const observation = page.observations?.[index]
      const text = observation ? `第 ${index + 1} 次读取 · ${new Date(observation.observedAt).toLocaleTimeString()} · 原文摘录` : '已送达的页面观察'
      const reference = node('p', '', text); reference.title = id; source.append(reference)
    }
    inspector.append(source)
  }
  const branchButtons = new Map()
  const select = group => {
    onSelect(group.id)
    for (const [id, control] of branchButtons) control.setAttribute('aria-pressed', String(id === group.id))
    renderInspector(group)
  }
  const children = new Map()
  for (const group of groups) { const parent = group.parentId ?? null; if (!children.has(parent)) children.set(parent, []); children.get(parent).push(group) }
  const renderBranches = (parent, ancestry = new Set()) => {
    const list = node('ol', 'atlas-branches')
    for (const group of children.get(parent) ?? []) {
      if (ancestry.has(group.id)) continue
      const item = node('li', 'atlas-branch'), card = node('article', 'atlas-content-card')
      const control = button('', () => select(group), 'atlas-region'); control.dataset.atlasRegionId = group.id; control.setAttribute('aria-pressed', String(selectedId === group.id))
      const meta = node('span', 'atlas-card-meta'); meta.append(node('span', '', kindName(group)), node('span', 'atlas-reading-state', group.kind === 'collection' ? `已读 ${group.items.length} 项${group.totalCount == null ? ' · 总数未知' : ` / ${group.totalCount} 项`}` : '内容片段'))
      control.append(meta, node('strong', 'atlas-card-title', group.title))
      if (group.excerpt) control.append(node('span', 'atlas-excerpt', group.excerpt))
      if (group.items?.length) { const preview = node('span', 'atlas-item-preview'); for (const entry of group.items.slice(0, 4)) preview.append(node('span', '', entry.text)); control.append(preview); if (group.items.length > 4) control.append(node('span', 'atlas-more', `另有 ${group.items.length - 4} 项，点击查看`)) }
      if (!group.excerpt && !group.items?.length) control.append(node('span', 'atlas-excerpt', '已读到标题，内容尚未展开'))
      branchButtons.set(group.id, control); card.append(control)
      if (group.actionIds?.length) { const footer = node('div', 'atlas-card-footer'); const anchor = actionButton(group.actionIds[0], true); if (anchor) footer.append(anchor); if (group.actionIds.length > 1) footer.append(node('span', '', `还有 ${group.actionIds.length - 1} 个定位入口`)); card.append(footer) }
      item.append(card)
      if (children.has(group.id)) item.append(renderBranches(group.id, new Set([...ancestry, group.id])))
      list.append(item)
    }
    return list
  }
  map.append(renderBranches(null))
  if (!groups.length) { const empty = node('div', 'atlas-insufficient'); empty.append(node('strong', '', '这次读取还没有获得可用正文'), node('p', '', '只知道页面标题或结构标签，不能据此声称已理解页面。可以刷新读取，或让助手读取你关心的部分。')); map.append(empty) }
  if (content.unplacedActionIds.length) {
    const controls = node('details', 'atlas-page-actions'); controls.append(node('summary', '', `其他页面控件 · ${content.unplacedActionIds.length}`), node('p', '', '这些控件尚未确定属于哪个内容分支。'))
    for (const id of content.unplacedActionIds) { const control = actionButton(id); if (control) controls.append(control) }
    map.append(controls)
  }
  const gaps = node('section', 'atlas-gaps'); gaps.setAttribute('aria-label', '尚未覆盖')
  gaps.append(node('h3', '', '尚未覆盖'))
  const gapList = node('ul', ''); for (const gap of content.gaps) gapList.append(node('li', '', gap)); gaps.append(gapList); map.append(gaps)
  renderInspector(groups.find(group => group.id === selectedId))
  layout.append(map, inspector)
  return layout
}

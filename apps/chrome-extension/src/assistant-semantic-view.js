const node = (tag, className, text) => { const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element }
const button = (text, action, className = '') => { const control = node('button', className, text); control.type = 'button'; control.addEventListener('click', action); return control }
const viewStates = new Map()

/** Semantic navigation changes local information granularity; only explicit generation invokes an Agent. */
export const renderSemanticNavigation = (page, { canLocate, onReveal, onGenerate, canGenerate = true, generating = false, onFeedback, canReview = true }) => {
  const versions = page.semanticMaps ?? (page.semanticMap ? [page.semanticMap] : [])
  let selectedVersion = null
  try { selectedVersion = sessionStorage.getItem(`dsh.semantic-version:${page.id}`) } catch { /* Session storage is optional. */ }
  const map = versions.find(item => item.mapId === selectedVersion) ?? page.semanticMap
  const source = page.sourceSnapshots?.find(item => item.snapshotId === map?.snapshotId) ?? page.sourceSnapshot
  const key = `${page.id}:${map?.mapId ?? source?.snapshotId ?? 'unread'}`
  if (!viewStates.has(key)) {
    let saved = null
    try { saved = JSON.parse(sessionStorage.getItem(`dsh.semantic-view:${key}`) ?? 'null') } catch { /* Session storage is optional. */ }
    viewStates.set(key, { focusId: typeof saved?.focusId === 'string' ? saved.focusId : null, sourceId: null, overviewScroll: 0 })
    if (viewStates.size > 64) viewStates.delete(viewStates.keys().next().value)
  }
  const state = viewStates.get(key), container = node('section', 'semantic-navigation')
  container.dataset.semanticView = key
  state.drafts ??= {}
  state.pendingReviews ??= new Set()
  const feedback = new Map((page.semanticFeedback?.entries ?? []).filter(item => item.mapId === map?.mapId).map(item => [item.nodeId, item]))
  const nodes = (map?.nodes ?? []).map(item => {
    const correction = feedback.get(item.nodeId)
    return correction?.label !== null && typeof correction?.label === 'string'
      ? { ...item, label: correction.label, summary: correction.summary, origin: 'human-edit' } : item
  }), blocks = source?.blocks ?? []
  const readingBlockId = source?.current ? source.readingBlockId : null
  const byId = new Map(nodes.map(item => [item.nodeId, item]))
  const repaint = () => {
    const live = [...document.querySelectorAll('[data-semantic-view]')].find(item => item.dataset.semanticView === key)
    if (live && live !== container) live.dispatchEvent(new Event('semantic-view-update'))
    else render()
  }
  const submitReview = async (nodeId, update) => {
    if (!onFeedback || state.pendingReviews.has(nodeId)) return
    state.reviewError = null
    state.pendingReviews.add(nodeId); repaint()
    try {
      const result = await onFeedback(map.mapId, nodeId, update)
      if (result?.ok) delete state.drafts[nodeId]
    } catch { state.reviewError = '修正尚未保存，请保留草稿后重试。'
    } finally { state.pendingReviews.delete(nodeId); repaint() }
  }
  const reviewControls = topic => {
    const controls = node('div', 'semantic-review'), current = feedback.get(topic.nodeId)
    if (topic.origin === 'human-edit') controls.append(node('span', 'semantic-human-label', '你的修正 · 原文引用保留'))
    if (current?.flag) controls.append(node('span', 'semantic-review-flag', `你已标记${current.flag === 'source' ? '来源问题' : current.flag === 'meaning' ? '概括问题' : '其他问题'}${current.note ? `：${current.note}` : ''}`))
    if (!onFeedback) return controls
    const draft = state.drafts[topic.nodeId]
    if (draft) {
      const form = node('form', 'semantic-edit-form')
      const titleLabel = node('label', '', '你的标题'), title = node('input', '')
      title.value = draft.label; title.maxLength = 96; title.required = true; title.dataset.editLabel = topic.nodeId
      title.addEventListener('input', () => { draft.label = title.value })
      titleLabel.append(title)
      const summaryLabel = node('label', '', '你的概括'), summary = node('textarea', '')
      summary.value = draft.summary; summary.maxLength = 500; summary.rows = 3; summary.dataset.editSummary = topic.nodeId
      summary.addEventListener('input', () => { draft.summary = summary.value })
      summaryLabel.append(summary)
      const save = node('button', '', state.pendingReviews.has(topic.nodeId) ? '正在保存…' : '保存修正')
      save.type = 'submit'; save.dataset.saveEdit = topic.nodeId
      save.dataset.reviewAction = 'save'
      form.addEventListener('submit', event => { event.preventDefault(); void submitReview(topic.nodeId, {
        action: 'edit', expectedRevision: draft.revision, label: draft.label.trim(), summary: draft.summary,
      }) })
      const cancel = button('取消', () => { delete state.drafts[topic.nodeId]; repaint() })
      cancel.dataset.reviewAction = 'cancel'
      form.append(titleLabel, summaryLabel, save, cancel); controls.append(form)
      const latestRevision = current?.revision ?? page.semanticFeedback?.revision ?? 0
      if (draft.revision !== latestRevision) {
        const retry = button('核对当前版本后继续', () => {
          draft.revision = latestRevision; render(); container.querySelector(`[data-edit-label="${topic.nodeId}"]`)?.focus()
        })
        retry.dataset.reviewAction = 'retry'; form.append(retry)
      }
    } else {
      const edit = button('修正概括', () => {
        state.drafts[topic.nodeId] = { label: topic.label, summary: topic.summary,
          revision: current?.revision ?? page.semanticFeedback?.revision ?? 0 }
        render(); container.querySelector('[data-edit-label]')?.focus()
      })
      edit.dataset.editNode = topic.nodeId
      edit.dataset.reviewAction = 'edit'
      const flag = button('标记概括有误', () => { void submitReview(topic.nodeId, { action: 'flag', flag: 'meaning',
        expectedRevision: current?.revision ?? page.semanticFeedback?.revision ?? 0 }) })
      flag.dataset.flagNode = topic.nodeId
      flag.dataset.reviewAction = 'flag'
      controls.append(edit, flag)
      const sourceFlag = button('标记来源有误', () => { void submitReview(topic.nodeId, { action: 'flag', flag: 'source',
        expectedRevision: current?.revision ?? page.semanticFeedback?.revision ?? 0 }) })
      sourceFlag.dataset.reviewAction = 'source-flag'; controls.append(sourceFlag)
      if (current?.label !== null && current?.label !== undefined || current?.flag) {
        const reset = button('恢复 AI 版本并清除标记', () => { void submitReview(topic.nodeId, { action: 'reset', expectedRevision: current.revision }) })
        reset.dataset.reviewAction = 'reset'; controls.append(reset)
      }
    }
    for (const control of controls.querySelectorAll('button,input,textarea')) {
      control.dataset.reviewNode = topic.nodeId
      control.disabled = !canReview || Boolean(page.semanticFeedback?.error) || state.pendingReviews.has(topic.nodeId)
    }
    return controls
  }
  const save = () => { try { sessionStorage.setItem(`dsh.semantic-view:${key}`, JSON.stringify({ focusId: state.focusId })) } catch { /* Navigation also works without storage. */ } }
  const change = (focusId, sourceId = null) => {
    const previousSource = state.sourceId
    state.focusId = focusId; state.sourceId = sourceId; save(); render()
    const returnedLink = previousSource && !sourceId
      ? [...container.querySelectorAll('[data-source-ref]')].find(element => element.dataset.sourceRef === previousSource) : null
    const destination = returnedLink ?? container.querySelector('.semantic-source h3, .semantic-focus h3')
    if (destination) { if (destination.tagName === 'H3') destination.tabIndex = -1; destination.focus({ preventScroll: true }) }
  }
  const sourceLink = id => {
    const block = blocks.find(item => item.blockId === id)
    if (!block) return null
    const control = button(`原文 ${blocks.indexOf(block) + 1} · ${block.kind === 'code' ? '代码' : block.kind === 'table-row' ? '表格行' : block.kind === 'record' ? '条目' : '片段'}`, () => change(state.focusId, id), 'semantic-source-link')
    control.dataset.sourceRef = id; return control
  }
  const render = () => {
    container.replaceChildren()
    const focus = byId.get(state.focusId), selectedSource = blocks.find(item => item.blockId === state.sourceId)
    const header = node('header', 'semantic-header')
    header.append(node('span', 'semantic-kicker', map ? '阅读地图' : '原文导航'), node('h2', '', page.title))
    const provenance = node('p', 'semantic-provenance', map ? nodes.some(item => item.origin === 'human-edit')
      ? 'AI 概括与个人修正 · 原文引用保留' : 'AI 概括 · 引用可回到已采集原文 · 含义尚未人工核对' : '尚未生成语义解读，以下仅为已采集原文。')
    header.append(provenance)
    if (versions.length > 1) {
      const label = node('label', 'semantic-version', '地图版本 '), select = node('select', '')
      select.setAttribute('aria-label', '地图版本')
      versions.forEach((version, index) => { const option = node('option', '', `版本 ${index + 1}${index === versions.length - 1 ? ' · 新候选' : ''}`); option.value = version.mapId; select.append(option) })
      select.value = map.mapId
      select.addEventListener('change', () => {
        try { sessionStorage.setItem(`dsh.semantic-version:${page.id}`, select.value) } catch { /* This selection still takes effect for the current view. */ }
        container.replaceWith(renderSemanticNavigation({ ...page, semanticMap: versions.find(item => item.mapId === select.value) }, { canLocate, onReveal, onGenerate, canGenerate, generating, onFeedback, canReview }))
      })
      label.append(select); header.append(label)
    }
    if (source && !source.current) header.append(node('p', 'semantic-stale', '这份解读属于旧快照。原文仍可阅读，当前网页定位已停用。'))
    if (page.semanticFeedback?.error) header.append(node('p', 'semantic-stale', '本地修正记录暂不可保存；原文和 AI 地图仍可阅读。'))
    if (state.reviewError) header.append(node('p', 'semantic-stale', state.reviewError))
    const generate = button(generating ? '正在生成…' : map ? '生成新版本' : '生成语义地图', onGenerate, 'semantic-generate')
    generate.disabled = generating || !canGenerate; header.append(generate); container.append(header)
    if (selectedSource) {
      const section = node('section', 'semantic-source')
      const back = button('返回重点', () => change(state.focusId), 'semantic-back'); back.dataset.semanticBack = ''
      section.append(back, node('h3', '', `原文 ${blocks.indexOf(selectedSource) + 1}`),
        node('p', 'semantic-provenance', selectedSource.kind === 'record'
          ? '网页记录 · 保留采集时可读内容' : '网页原文 · 保留采集时的内容'))
      if (readingBlockId === selectedSource.blockId) section.append(node('p', 'semantic-here', '当前阅读位置'))
      const passage = node(selectedSource.kind === 'code' ? 'pre' : 'blockquote', 'semantic-passage', selectedSource.text)
      section.append(passage)
      if (selectedSource.truncated) section.append(node('p', 'semantic-stale', '该块只采集了开头，后续内容未包含在此快照。'))
      const locate = button('在原网页中定位并高亮', () => onReveal(selectedSource.blockId, source.snapshotId), 'semantic-locate')
      locate.dataset.sourceLocate = selectedSource.blockId; locate.disabled = !canLocate || !source.current
      section.append(locate)
      const index = blocks.indexOf(selectedSource), context = node('details', 'semantic-source-context')
      context.append(node('summary', '', '相邻原文'))
      for (const adjacent of [blocks[index - 1], blocks[index + 1]].filter(Boolean)) context.append(node('p', '', adjacent.text))
      section.append(context); container.append(section)
      const recent = (page.semanticFeedback?.navigations ?? []).filter(item => item.snapshotId === source.snapshotId && item.blockId === selectedSource.blockId)
      if (recent.length) {
        const history = node('details', 'semantic-source-context')
        history.append(node('summary', '', `最近定位记录 · ${recent.length} 次`))
        for (const attempt of recent.slice(0, 5)) history.append(node('p', '', `${new Date(attempt.time).toLocaleTimeString()} · ${attempt.outcome === 'located' ? '已核对并定位原文' : '未能定位，保留原文快照'}`))
        section.append(history)
      }
    } else if (focus || state.focusId === 'unorganized') {
      const section = node('section', 'semantic-focus'), back = button('返回总览', () => {
        const previous = state.focusId; change(null)
        const control = [...container.querySelectorAll('[data-semantic-node]')].find(element => element.dataset.semanticNode === previous)
        control?.focus({ preventScroll: true })
        const scroll = container.closest('.pane'); if (scroll) scroll.scrollTop = state.overviewScroll
      }, 'semantic-back')
      back.dataset.semanticBack = ''; section.append(back, node('h3', '', focus?.label ?? '尚未组织的内容'))
      if (readingBlockId && (focus?.sourceRefs.includes(readingBlockId)
        || nodes.some(child => child.parentId === focus?.nodeId && child.sourceRefs.includes(readingBlockId)))) {
        section.append(node('p', 'semantic-here', '当前阅读区域'))
      }
      if (focus?.summary) section.append(node('p', 'semantic-summary', focus.summary))
      if (focus) section.append(reviewControls(focus))
      const children = focus ? nodes.filter(item => item.parentId === focus.nodeId) : []
      for (const child of children) {
        const card = node('article', 'semantic-detail-card'); card.append(node('h4', '', child.label), node('p', '', child.summary))
        if (readingBlockId && child.sourceRefs.includes(readingBlockId)) {
          card.setAttribute('aria-current', 'location'); card.append(node('span', 'semantic-here', '当前阅读'))
        }
        const refs = node('div', 'semantic-source-links'); for (const id of child.sourceRefs) { const control = sourceLink(id); if (control) refs.append(control) }; card.append(refs, reviewControls(child)); section.append(card)
      }
      const refs = node('div', 'semantic-source-links')
      for (const id of focus?.sourceRefs ?? map?.unorganizedBlockIds ?? blocks.map(item => item.blockId)) { const control = sourceLink(id); if (control) refs.append(control) }
      section.append(node('h4', '', '查阅来源'), refs); container.append(section)
    } else {
      const overview = node('div', 'semantic-overview')
      for (const [index, topic] of nodes.filter(item => item.parentId === null).entries()) {
        const card = button('', () => { state.overviewScroll = container.closest('.pane')?.scrollTop ?? 0; change(topic.nodeId) }, 'semantic-topic')
        card.dataset.semanticNode = topic.nodeId
        if (topic.origin === 'human-edit') card.append(node('span', 'semantic-human-label', '你的修正'))
        if (feedback.get(topic.nodeId)?.flag) card.append(node('span', 'semantic-review-flag', '已标记待核对'))
        if (readingBlockId && (topic.sourceRefs.includes(readingBlockId)
          || nodes.some(child => child.parentId === topic.nodeId && child.sourceRefs.includes(readingBlockId)))) {
          card.setAttribute('aria-current', 'location'); card.append(node('span', 'semantic-here', '当前阅读'))
        }
        card.append(node('span', 'semantic-number', String(index + 1).padStart(2, '0')), node('strong', '', topic.label))
        if (topic.summary) card.append(node('span', 'semantic-topic-summary', topic.summary))
        card.append(node('small', '', `${nodes.filter(item => item.parentId === topic.nodeId).length} 个重点 · ${topic.sourceRefs.length} 处来源`)); overview.append(card)
      }
      container.append(overview)
      if (!map || map.unorganizedBlockIds.length) {
        const count = map?.unorganizedBlockIds.length ?? blocks.length
        container.append(button(`尚未组织的原文 · ${count} 块`, () => change('unorganized'), 'semantic-unorganized'))
      }
    }
    if (source?.omissions.length) { const gaps = node('details', 'semantic-gaps'); gaps.append(node('summary', '', '读取范围与缺口')); for (const gap of source.omissions) gaps.append(node('p', '', gap)); container.append(gaps) }
    for (const element of container.querySelectorAll('button, input, textarea, select, summary, h3')) {
      element.dataset.semanticFocus = JSON.stringify([element.tagName, element.className,
        element.dataset.semanticNode ?? '', element.dataset.sourceRef ?? '', element.dataset.sourceLocate ?? '',
        element.dataset.reviewNode ?? '', element.dataset.editLabel ?? '', element.dataset.editSummary ?? '', element.dataset.reviewAction ?? ''])
    }
  }
  container.addEventListener('semantic-view-update', render)
  render()
  return container
}

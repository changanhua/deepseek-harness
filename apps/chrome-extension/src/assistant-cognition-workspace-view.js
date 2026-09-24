import { projectCognitionWorkspace, cognitionScopeIssue, compileCognitionContext } from './assistant-cognition-workspace.js'

const node = (tag, className = '', value) => {
  const element = document.createElement(tag); element.className = className
  if (value !== undefined) element.textContent = value
  return element
}
const button = (label, action, className = '') => {
  const control = node('button', className, label); control.type = 'button'; control.addEventListener('click', action); return control
}
const stylesheet = () => {
  if (document.getElementById('cognition-workspace-style')) return
  const link = document.createElement('link'); link.id = 'cognition-workspace-style'; link.rel = 'stylesheet'
  link.href = new URL('./assistant-cognition-workspace.css', import.meta.url).href; document.head.append(link)
}
const stateLabels = { disabled: '禁用', readOnly: '只读', required: '必填', checked: '已勾选', selected: '已选择', expanded: '已展开', busy: '忙碌', inViewport: '位于视口' }
const paragraph = (heading, value, className = '') => {
  const section = node('section', className); section.append(node('h4', '', heading), node('p', '', value)); return section
}

/** Local navigation only. Browser reads, generation, scope changes and reveal are explicit callbacks. */
export const renderCognitionWorkspace = (page, { navigation = {}, scope = null, canUse = false, canLocate = false,
  onUse, onCorrect, onRevealSource, onRevealAction } = {}) => {
  stylesheet()
  const model = projectCognitionWorkspace(page), byId = new Map(model.objects.map(item => [item.id, item]))
  const container = node('section', 'semantic-navigation cognition-workspace')
  container.dataset.semanticView = `${page.id}:${model.revision}:workspace`
  navigation.drafts ??= {}
  if (!byId.has(navigation.focusId)) { navigation.focusId = null; navigation.source = false }
  const scoped = scope?.pageId === page.id && scope.revision === model.revision ? scope : null
  const isSelected = item => scoped?.objectIds.includes(item.id) ?? false
  const focusKey = (element, key) => { element.dataset.semanticFocus = key; return element }
  const change = (focusId, source = false) => {
    navigation.focusId = focusId; navigation.source = source; render()
    const heading = container.querySelector('h3'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }) }
  }
  const sourceFor = item => (model.source?.blocks ?? []).filter(block => item.blockIds.includes(block.blockId))
  const locate = async action => {
    if (navigation.locating) return
    navigation.locating = true; navigation.locationMessage = '正在请求定位…'; repaint()
    try {
      const result = await action()
      navigation.locationMessage = result?.ok ? '定位请求已返回；请在原网页核对。定位不证明判断成立。' : '定位未完成；保留采集时的证据，请刷新或查看错误提示。'
    } catch { navigation.locationMessage = '定位未完成，未自动重试。' }
    finally { navigation.locating = false; repaint() }
  }
  const sourceButton = item => focusKey(button('核对来源 →', () => {
    change(item.id, true)
    const blocks = sourceFor(item)
    if (blocks.length === 1 && canLocate && model.source?.current && onRevealSource) void locate(() => onRevealSource(blocks[0].blockId, model.snapshotId))
  }), `source:${item.id}`)
  const useButton = item => {
    const control = focusKey(button(isSelected(item) ? '移出任务范围' : '用于下一条任务', () => onUse?.(item.id), 'cog-use'), `use:${item.id}`)
    control.dataset.cognitionUse = item.id; control.disabled = !canUse || !onUse; return control
  }
  const render = () => {
    container.replaceChildren()
    const focus = byId.get(navigation.focusId)
    const header = node('header', 'cog-header')
    header.append(node('span', 'cog-eyebrow', 'AGENT · 页面工作理解'), node('h3', '', navigation.source ? 'Source · 核对依据' : focus ? 'Focus · 检查这一部分' : 'Overview · 先对齐这页'))
    header.append(node('p', 'cog-muted', '规则整理已送达的观察，不冒充模型内部思考。显式发布的解读才标为 Agent 判断。'))
    const tabs = node('nav', 'cog-levels'); tabs.setAttribute('aria-label', '认知层级')
    for (const [label, level, action] of [['总览', 'overview', () => change(null)], ['聚焦', 'focus', () => change(navigation.focusId)], ['来源', 'source', () => change(navigation.focusId, true)]]) {
      const control = button(label, action); control.disabled = level !== 'overview' && !focus
      control.setAttribute('aria-current', String(level === (navigation.source ? 'source' : focus ? 'focus' : 'overview'))); tabs.append(control)
    }
    header.append(tabs); container.append(header)
    if (page.documentState !== 'current') container.append(node('p', 'cog-warning', '先前页面 · 只能查看历史证据，不能添加为当前任务范围。'))
    if (focus && navigation.source) {
      const section = node('section', 'cog-source'); section.dataset.cognitionSource = focus.id
      section.append(focusKey(button('← 返回聚焦', () => change(focus.id)), `back:${focus.id}`), node('h4', '', focus.label))
      section.append(node('p', 'cog-muted', `观察 ${model.observationId} · ${model.evidenceTime ? new Date(model.evidenceTime).toLocaleString() : '时间未知'}`))
      const blocks = sourceFor(focus)
      if (blocks.length) for (const block of blocks) {
        section.append(node(block.kind === 'code' ? 'pre' : 'blockquote', 'cog-passage', block.text))
        if (block.truncated) section.append(node('p', 'cog-warning', '原文块已截断，不能视为完整上下文。'))
        const reveal = button('在原网页定位这段原文', () => { void locate(() => onRevealSource(block.blockId, model.snapshotId)) })
        reveal.dataset.cognitionRevealSource = block.blockId
        reveal.disabled = !canLocate || !model.source?.current || !onRevealSource || Boolean(navigation.locating); section.append(reveal)
      }
      else {
        section.append(node('blockquote', 'cog-passage', focus.text || '这一对象只有结构或控件状态，没有采集到正文。'))
        section.append(node('p', 'cog-muted', '观察记录可核对，但尚无与这段文字唯一绑定的原文锚点；不会拿相似文字代替。'))
      }
      for (const action of focus.actions) {
        const reveal = button(`高亮控件：${action.label || action.role}`, () => { void locate(() => onRevealAction(action.id)) })
        reveal.dataset.cognitionRevealAction = action.id; reveal.disabled = !canLocate || !action.locatorsValid || !onRevealAction || Boolean(navigation.locating)
        section.append(reveal)
      }
      if (navigation.locationMessage) { const status = node('p', 'cog-muted', navigation.locationMessage); status.setAttribute('role', 'status'); section.append(status) }
      section.append(node('p', 'cog-muted', '高亮不是点击、填写或提交，不扩大浏览器授权。')); container.append(section)
    } else if (focus) {
      const section = node('section', 'cog-focus'); section.dataset.cognitionFocus = focus.id
      section.append(focusKey(button('← 返回总览', () => change(null)), `back:${focus.id}`), node('h4', 'cog-focus-title', focus.label), useButton(focus))
      const facts = [`对象类型：${focus.role || focus.kind}`, `来源：${focus.observationId}`]
      if (focus.observedCount !== undefined) facts.push(`本次返回 ${focus.observedCount} 项；${focus.totalCount == null ? '总量未知' : `来源报告总量 ${focus.totalCount}`}`)
      for (const [key, value] of Object.entries(focus.states)) facts.push(`${stateLabels[key]}：${value === 'mixed' ? '部分' : value ? '是' : '否'}`)
      section.append(paragraph('实际观察', facts.join(' · ')))
      if (focus.excerptTruncated) section.append(node('p', 'cog-warning', '这一对象的文字仅保留有界摘录；上下文会明确携带截断标记。'))
      if (focus.interpretation?.length) for (const interpretation of focus.interpretation) {
        section.append(paragraph('Agent 已发布的判断 · 不是已验证事实', `${interpretation.label}：${interpretation.summary}`))
        if (interpretation.correction?.label || interpretation.correction?.flag) section.append(paragraph('已有人工反馈 · 保留原判断', interpretation.correction.label || '原判断已被标记待核对'))
      } else section.append(paragraph('当前判断', '尚无与这个对象及当前快照明确绑定的 Agent 语义判断；不要把结构分组当作已理解。'))
      const children = model.objects.filter(item => item.parentId === focus.id)
      if (children.length) {
        const list = node('div', 'cog-children'); list.append(node('h4', '', `${focus.kind === 'control-group' ? '按类型整理的控件' : focus.kind === 'content' ? '同次读取的原文' : '包含的对象'} · ${children.length}`))
        for (const child of children) {
          const row = node('div', 'cog-child'), open = focusKey(button(child.label, () => change(child.id), 'cog-child-open'), `object:${child.id}`)
          open.dataset.cognitionObject = child.id; row.append(open, useButton(child)); list.append(row)
        }
        section.append(list)
      }
      section.append(paragraph('未知与限制', focus.unknowns.join('；') || '未采集的内容仍然未知。', 'cog-warning'))
      const label = node('label', 'cog-correction', '纠正这部分的理解（仅用于本次任务，不修改原文）')
      const input = focusKey(node('textarea'), `correction:${focus.id}`); input.rows = 2; input.maxLength = 500
      input.value = navigation.drafts[focus.id] ?? scoped?.corrections[focus.id] ?? ''; input.disabled = !canUse
      input.dataset.cognitionCorrection = focus.id
      input.addEventListener('input', () => { navigation.drafts[focus.id] = input.value }); label.append(input)
      const save = button('将修正加入任务上下文', () => { onCorrect?.(focus.id, input.value) }); save.disabled = !canUse || !onCorrect
      section.append(sourceButton(focus), label, save); container.append(section)
    } else {
      container.append(paragraph('这是什么页面 · 结构推定', model.kind, 'cog-kind'))
      container.append(node('p', 'cog-muted', '仅本次已送达的观察 · 总量未知 · 点开查看不等于纳入任务'))
      const roots = model.objects.filter(item => !item.parentId)
      const grid = node('div', 'cog-objects'); grid.setAttribute('aria-label', '主要页面对象')
      for (const [index, item] of roots.entries()) {
        const card = node('article', 'cog-object')
        const open = focusKey(button('', () => change(item.id), 'cog-object-open'), `object:${item.id}`); open.dataset.cognitionObject = item.id
        open.append(node('span', 'cog-object-index', String(index + 1).padStart(2, '0')), node('strong', '', item.label))
        const count = model.objects.filter(child => child.parentId === item.id).length
        open.append(node('small', '', count ? `${count} 个子对象 · 点击检查` : `${item.role || item.kind} · 点击检查`))
        card.append(open, useButton(item)); grid.append(card)
      }
      if (!roots.length) grid.append(node('p', '', '尚未获得可以组织的对象。请显式刷新读取，不会自动启动模型。'))
      container.append(grid)
      container.append(paragraph('对象之间的关系', model.relations.length
        ? '集合成员来自观察；控件分组仅是界面整理。尚未证明“筛选影响列表”“按钮控制表单”等行为关系。'
        : '尚未获得明确的对象关系；不凭位置或相似文字生成关系线。'))
      container.append(paragraph('尚未覆盖', model.gaps.join('；'), 'cog-warning'))
    }
    container.append(node('p', 'cog-footnote', '查看 ≠ 用于任务。总览、聚焦与上下文预览均在本地完成；刷新读取、语义生成与任务发送沿用现有 Agent 通道，可能产生模型消耗。'))
  }
  const repaint = () => {
    const live = [...document.querySelectorAll('[data-semantic-view]')].find(item => item.dataset.semanticView === container.dataset.semanticView)
    if (live && live !== container) live.dispatchEvent(new Event('cognition-workspace-update'))
    else render()
  }
  container.addEventListener('cognition-workspace-update', render)
  render(); return container
}

export const renderCognitionTaskScope = (scope, page, current, { onClear, disabled = false } = {}) => {
  stylesheet()
  const rail = node('section', 'cog-task-scope'); rail.dataset.cognitionScope = ''
  const issue = cognitionScopeIssue(scope, page, current)
  rail.append(node('strong', '', issue ? '任务范围待重新确认' : `下一条任务 · 已选 ${scope.objectIds.length} 个对象`))
  const clear = button('清除范围与修正', onClear); clear.disabled = disabled; rail.append(clear)
  if (issue) rail.append(node('p', 'cog-warning', issue))
  else {
    try {
      const context = compileCognitionContext(scope, page, current)
      rail.append(node('p', 'cog-muted', `${context.packet.objects.map(item => item.label).join(' / ')} · 上下文 ${context.characters} 字符（不是计费 Token）`))
      const details = node('details'); details.append(node('summary', '', '查看将随任务提交的完整上下文'), node('pre', 'cog-passage', context.json)); rail.append(details)
    } catch (error) { rail.append(node('p', 'cog-warning', error.message)) }
  }
  rail.append(node('p', 'cog-muted', '尚未发送。修正是用户陈述，不是原文事实；任务范围不增加操作授权。'))
  return rail
}

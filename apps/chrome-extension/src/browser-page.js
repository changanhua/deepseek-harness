(() => {
  if (globalThis.__dshBrowserAssistant) return

  const MAX_TEXT = 50_000
  const MAX_ELEMENTS = 128
  const MAX_SNAPSHOTS = 8
  const MAX_RECORDS = 128
  const RETENTION_MS = 60_000
  const MAX_PREPARATIONS = 32
  const MAX_PREPARATION_BYTES = 65_536
  const CONTROL_SELECTOR = 'a,button,input,textarea,select,summary,[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="option"],[role="combobox"],[role="tab"],[role="menuitem"],[tabindex]:not([tabindex="-1"])'
  const pageActions = ['navigate', 'scroll', 'wait', 'back', 'forward', 'reload', 'tab_open', 'tab_close', 'tab_focus', 'screenshot']
  const elementActions = ['click', 'fill', 'submit', 'double_click', 'right_click', 'hover', 'press', 'select', 'check', 'drag', 'upload']
  const snapshots = new Map()
  const records = new Map()
  const preparations = new Map()
  let serial = 0
  const documentToken = crypto.randomUUID()

  const copy = value => structuredClone(value)
  const id = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++serial}`}`
  const text = value => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, MAX_TEXT)
  const identityOf = value => ({ protocolVersion: value.protocolVersion, grantEpoch: value.grantEpoch,
    requestId: value.requestId, sessionId: value.sessionId, installationId: value.installationId,
    deadline: value.deadline, fingerprint: value.fingerprint })
  const validIdentity = value => value && value.protocolVersion === 1 && typeof value.installationId === 'string'
    && typeof value.sessionId === 'string' && typeof value.requestId === 'string' && typeof value.fingerprint === 'string'
    && Number.isSafeInteger(value.grantEpoch) && Number.isSafeInteger(value.deadline)
  const sameIdentity = (left, right) => JSON.stringify(identityOf(left)) === JSON.stringify(identityOf(right))
  const receipt = (identity, outcome, extra = {}) => ({ ...identityOf(identity), outcome, ...extra })
  const expiry = identity => identity.deadline + RETENTION_MS
  const prune = () => {
    const now = Date.now()
    for (const [key, record] of records) if (record.expiresAt <= now) records.delete(key)
    for (const [key, snapshot] of snapshots) if (snapshot.expiresAt <= now) snapshots.delete(key)
    for (const [key, prepared] of preparations) if (prepared.expiresAt <= now) preparations.delete(key)
  }
  const formOf = node => node instanceof HTMLFormElement ? node : node?.form ?? node?.closest('form')
  const disabledControl = node => Boolean(node && (node.disabled || node.matches(':disabled') || node.closest('[inert]') || node.getAttribute('aria-disabled') === 'true'))
  const readOnlyControl = node => Boolean(node && (node.readOnly || node.getAttribute('aria-readonly') === 'true'))
  const visible = node => {
    if (!node?.isConnected) return false
    let depth = 0
    for (let current = node; current; current = current.parentElement ?? current.getRootNode()?.host) {
      if (++depth > 512 || current.hidden || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true') return false
      if (current.tagName === 'DETAILS' && !current.open && !current.querySelector(':scope > summary')?.contains(node)) return false
      const style = window.getComputedStyle(current)
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false
    }
    return true
  }
  const customActionability = node => {
    if (node.hasAttribute('onclick')) return 'handler'
    if (window.getComputedStyle(node).cursor !== 'pointer') return null
    const parent = node.parentElement ?? node.getRootNode()?.host
    return !parent || window.getComputedStyle(parent).cursor !== 'pointer' ? 'pointer' : null
  }
  const actionabilityOf = node => node.matches(CONTROL_SELECTOR) ? 'semantic' : customActionability(node)
  const critical = node => {
    const form = formOf(node)
    const actionability = actionabilityOf(node)
    return { tag: node.tagName, id: node.getAttribute('id'), name: node.getAttribute('name'),
    type: node.getAttribute('type'), role: node.getAttribute('role'), label: node.getAttribute('aria-label'),
    href: node.getAttribute('href'), contenteditable: node.getAttribute('contenteditable'),
    text: ['BUTTON', 'A', 'SUMMARY'].includes(node.tagName) || actionability !== null && actionability !== 'semantic' ? elementText(node, 500) : undefined,
    disabled: disabledControl(node), readOnly: readOnlyControl(node), visible: visible(node),
    actionability,
    inert: node.inert || node.closest('[inert]') !== null,
    formAction: node.getAttribute('formaction'), formMethod: node.getAttribute('formmethod'), formTarget: node.getAttribute('formtarget'),
    form: form && { action: form.action, method: form.method, target: form.target } }
  }
  const sameCritical = (node, saved) => JSON.stringify(critical(node)) === JSON.stringify(saved)
  const actionPage = action => action?.page ?? action?.element?.page
  const containsInputValue = node => {
    for (let current = node; current; current = current.getRootNode()?.host) {
      if (current.isContentEditable || current.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return true
    }
    return false
  }
  // Open shadow roots share the same bounded traversal and host visibility rules.
  function* walkOpen(root, whatToShow = NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT) {
    const walkers = [document.createTreeWalker(root, whatToShow)]
    let visited = 0
    while (walkers.length && visited < 10000) {
      const node = walkers.at(-1).nextNode()
      if (!node) { walkers.pop(); continue }
      visited++
      yield node
      if (node.shadowRoot) walkers.push(document.createTreeWalker(node.shadowRoot, whatToShow))
    }
  }
  const elementText = (root, limit) => {
    const pieces = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let child, length = 0, visited = 0
    while ((child = walker.nextNode()) && ++visited <= 512 && length < limit) {
      const parent = child.parentElement
      if (!parent || containsInputValue(parent) || parent.closest('script,style') || !visible(parent)) continue
      const value = text((child.nodeValue ?? '').slice(0, limit - length))
      if (value) { pieces.push(value); length += value.length + 1 }
    }
    return pieces.join(' ').slice(0, limit)
  }
  const roleOf = node => {
    const explicit = node.getAttribute('role')
    if (explicit) return text(explicit.slice(0, 64))
    if (node.tagName === 'INPUT') {
      return ({ checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton', search: 'searchbox',
        button: 'button', submit: 'button', reset: 'button', hidden: 'none' })[node.type] ?? 'textbox'
    }
    return ({ A: 'link', BUTTON: 'button', SUMMARY: 'button', TEXTAREA: 'textbox', SELECT: 'combobox' })[node.tagName]
      ?? (containsInputValue(node) ? 'textbox' : 'generic')
  }
  const stateOf = node => node ? ({
    disabled: disabledControl(node),
    readOnly: readOnlyControl(node),
    required: Boolean(node.required || node.getAttribute('aria-required') === 'true'),
    pressed: ['true', 'false'].includes(node.getAttribute('aria-pressed')) ? node.getAttribute('aria-pressed') === 'true' : null,
    selected: ['true', 'false'].includes(node.getAttribute('aria-selected')) ? node.getAttribute('aria-selected') === 'true' : null,
    busy: node.getAttribute('aria-busy') === 'true',
    checked: ['checkbox', 'radio'].includes(node.type) ? Boolean(node.checked)
      : node.getAttribute('aria-checked') === 'mixed' ? 'mixed'
        : ['true', 'false'].includes(node.getAttribute('aria-checked')) ? node.getAttribute('aria-checked') === 'true' : null,
    expanded: node.tagName === 'SUMMARY' && node.parentElement?.tagName === 'DETAILS' ? node.parentElement.open
      : ['true', 'false'].includes(node.getAttribute('aria-expanded')) ? node.getAttribute('aria-expanded') === 'true' : null,
  }) : null
  const visibleBodyText = (limit = MAX_TEXT) => {
    const pieces = []
    let visited = 0, length = 0
    for (const node of walkOpen(document.body)) {
      if (++visited >= 10000 || length >= limit) break
      if (node.nodeType !== Node.TEXT_NODE) continue
      const parent = node.parentElement
      if (!parent || containsInputValue(parent) || parent.closest('script,style,noscript,template') || !visible(parent)) continue
      const value = text((node.nodeValue ?? '').slice(0, limit - length))
      if (value) { pieces.push(value); length += value.length + 1 }
    }
    return { text: pieces.join(' ').slice(0, limit), textTruncated: length >= limit || visited >= 10000 }
  }

  const contextOf = node => {
    let parent = node.parentElement ?? node.getRootNode()?.host
    for (let depth = 0; parent && parent !== document.body && depth < 8; depth++, parent = parent.parentElement ?? parent.getRootNode()?.host) {
      const headings = parent.querySelectorAll('h1,h2,h3,h4,[role="heading"],legend,caption')
      if (headings.length === 1 && visible(headings[0])) return elementText(headings[0], 240)
      if (parent.matches('article,li,tr,[role="listitem"],[role="row"]')) return elementText(parent, 240)
    }
    return ''
  }
  const optionsOf = node => node.tagName === 'SELECT' ? [...node.options].slice(0, 256).map(option => ({
    label: text(option.label).slice(0, 128), value: option.value.slice(0, 256), disabled: disabledControl(option),
  })) : undefined
  const bounded = (value, fallback, minimum, maximum) => Number.isSafeInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback
  const structuralSummary = (elements = [], nodes = new Map()) => {
    const regions = [], collections = []
    const regionNodes = [...document.querySelectorAll('main,nav,header,aside,footer,[role="main"],[role="navigation"],[role="region"]')]
    for (const node of regionNodes.slice(0, 24)) {
      if (!visible(node)) continue
      const heading = node.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > [role="heading"]')
      regions.push({ kind: roleOf(node) === 'generic' ? node.tagName.toLowerCase() : roleOf(node), label: text(heading?.textContent ?? '').slice(0, 160), text: elementText(node, 240) })
    }
    const collectionNodes = [...document.querySelectorAll('[role="feed"],[role="list"],[role="grid"],ul,ol')]
    for (const node of collectionNodes.slice(0, 16)) {
      if (!visible(node)) continue
      const kind = node.getAttribute('role') ?? node.tagName.toLowerCase()
      const itemNodes = [...node.querySelectorAll(':scope > [role="listitem"],:scope > [role="gridcell"],:scope > li,:scope > article,:scope > [role="row"]')]
      const items = itemNodes.slice(0, 16).filter(item => visible(item)).map((item, index) => {
        const controls = elements.filter(element => {
          const record = nodes.get(element.elementId)
          return record?.node && record.node !== item && item.contains(record.node)
        }).slice(0, 24).map(element => ({ elementId: element.elementId, role: element.role, label: element.label, state: element.state }))
        return { index, text: elementText(item, 180), controls, ...(controls.length >= 24 ? { controlsTruncated: true } : {}) }
      })
      collections.push({ kind, itemCount: Math.min(itemNodes.length, 128), items, itemsTruncated: itemNodes.length > items.length })
    }
    return { regions, collections }
  }
  const snapshot = options => {
    prune()
    if (options?.tree) {
      let tree
      try { tree = globalThis.__dshBrowserDomTree.snapshot(options) }
      catch (cause) { return { error: { code: cause?.code ?? 'dom_tree_cursor_invalid', message: cause?.message ?? 'DOM tree cursor is invalid' } } }
      const saved = snapshots.get(tree.snapshotId) ?? { url: location.href, nodes: new Map(), expiresAt: 0 }
      for (const item of tree.tree) {
        if (!item.elementId) continue
        const node = globalThis.__dshBrowserDomTree.getNode(tree.snapshotId, item.elementId)
        if (node) saved.nodes.set(item.elementId, { node, critical: critical(node) })
      }
      saved.expiresAt = Date.now() + RETENTION_MS
      snapshots.set(tree.snapshotId, saved)
      while (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value)
      return tree
    }
    const snapshotId = id('snapshot')
    const nodes = new Map()
    const elements = []
    const offset = bounded(options?.offset, 0, 0, 10000)
    const limit = bounded(options?.limit, MAX_ELEMENTS, 1, MAX_ELEMENTS)
    const query = text(options?.query).slice(0, 256).toLocaleLowerCase()
    const contextCache = new Map()
    let examined = 0, matched = 0, hasMore = false
    for (const node of options?.references === false ? [] : walkOpen(document.body, NodeFilter.SHOW_ELEMENT)) {
      if (++examined > 10000) break
      if (!actionabilityOf(node)) continue
      if (!visible(node)) continue
      const parent = node.parentElement ?? node.getRootNode()?.host
      if (!contextCache.has(parent)) contextCache.set(parent, contextOf(node))
      const context = contextCache.get(parent)
      const label = labelOf(node)
      const content = containsInputValue(node) ? '' : elementText(node, 500)
      if (query && ![label, content, context, roleOf(node), node.getAttribute('placeholder'), node.getAttribute('title')].join(' ').toLocaleLowerCase().includes(query)) continue
      if (matched++ < offset) continue
      if (elements.length >= limit) { hasMore = true; break }
      const elementId = id('element')
      nodes.set(elementId, { node, critical: critical(node) })
      const attributes = Object.fromEntries(['id', 'name', 'type', 'role', 'aria-label', 'href', 'contenteditable', 'placeholder', 'title']
        .flatMap(name => node.hasAttribute(name) ? [[name, node.getAttribute(name).slice(0, 1024)]] : []))
      const rect = node.getBoundingClientRect()
      elements.push({ snapshotId, elementId, tag: node.tagName.toLowerCase(),
        text: content, role: roleOf(node), label, context,
        ...(options?.includeOptions && node.tagName === 'SELECT' ? { options: optionsOf(node), optionsTruncated: node.options.length > 256 } : {}),
        state: { ...stateOf(node), inViewport: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth }, attributes })
    }
    if (options?.references !== false) {
      snapshots.set(snapshotId, { url: window.location.href, nodes, expiresAt: Date.now() + RETENTION_MS })
      while (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value)
    }
    const presentations = Array.isArray(options?.presentationQueries) ? options.presentationQueries.slice(0, 32).flatMap(query => {
      if (!query || typeof query.mountId !== 'string' || !query.mountId || typeof query.text !== 'string' || !query.text
        || new TextEncoder().encode(query.text).byteLength > 512) return []
      const expected = text(query.text)
      const mounted = regionMounts.get(query.mountId)
      const panels = mounted?.url === location.href && mounted.presentationOwner === presentationOwner(options?.presentationOwner)
        ? [...mounted.panels].filter(panel => panel.isConnected) : []
      return [{ mountId: query.mountId, text: expected, present: panels.some(panel => text(panel.textContent).includes(expected)) }]
    }) : []
    return { snapshotId, url: window.location.href, title: document.title,
      ...visibleBodyText(bounded(options?.textLimit, MAX_TEXT, 0, MAX_TEXT)), elements,
      presentations,
      ...(options?.structure === false ? {} : { structure: structuralSummary(elements, nodes) }),
      offset, nextOffset: hasMore ? offset + elements.length : null, elementsTruncated: hasMore,
      scanTruncated: examined >= 10000 }
  }

  const staleElement = action => {
    const reference = action?.element
    const saved = reference && snapshots.get(reference.snapshotId)
    const stored = saved?.nodes.get(reference.elementId)
    if (!saved || saved.url !== window.location.href || !stored || !stored.node.isConnected || !sameCritical(stored.node, stored.critical)) return null
    const page = actionPage(action)
    return page && page.url !== window.location.href ? null : stored.node
  }

  const addRecord = (identity, record) => {
    prune()
    if (records.size >= MAX_RECORDS) return false
    const stored = { identity: identityOf(identity), expiresAt: expiry(identity), ...record }
    records.set(identity.requestId, stored)
    return stored
  }
  const finish = (record, value) => {
    record.receipt = copy(value)
    record.cancel = undefined
    record.resolve?.(copy(value))
    record.resolve = undefined
  }
  const unknown = (identity, reason, quiescent = false) => receipt(identity, 'unknown', { reason, quiescent })

  const editable = node => (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement
    && ['text', 'search', 'email', 'url', 'tel', 'number'].includes(node.type || 'text') || node.isContentEditable)
    && !disabledControl(node) && !readOnlyControl(node)
  const disclosure = node => node?.tagName === 'SUMMARY' && node.parentElement?.tagName === 'DETAILS'
    && node.parentElement.querySelector('summary') === node && !formOf(node)
  const labelOf = node => {
    const labels = []
    for (const label of node?.labels ?? []) {
      if (labels.length === 8) break
      labels.push(elementText(label, 256))
    }
    const labelledBy = (node?.getAttribute('aria-labelledby') ?? '').slice(0, 2048).split(/\s+/u).slice(0, 8)
      .map(id => node.getRootNode().getElementById?.(id)).filter(Boolean).map(label => elementText(label, 256)).join(' ')
    const value = node?.getAttribute('aria-label') || labelledBy || labels.join(' ')
      || (!containsInputValue(node) ? elementText(node, 256) : '') || node?.getAttribute('placeholder') || node?.getAttribute('title') || node?.getAttribute('name')
    return text(String(value ?? '').slice(0, 256))
  }
  const describe = (action, node) => {
    const form = formOf(node)
    const effect = action.kind === 'fill' ? 'input-change' : action.kind === 'submit' ? 'form-submit'
      : action.kind === 'click' ? disclosure(node) ? 'local-disclosure'
        : form && (node.type === 'submit' || node.type === 'image') ? 'form-submit'
          : node?.tagName === 'A' && node.href ? 'navigation' : 'unknown'
        : ['navigate', 'tab_open', 'back', 'forward', 'reload'].includes(action.kind) ? 'navigation'
          : ['scroll', 'wait'].includes(action.kind) ? action.kind : 'unknown'
    const destination = ['navigate', 'tab_open'].includes(action.kind) ? action.url : effect === 'form-submit'
      ? node?.getAttribute('formaction') ? node.formAction : form?.action : effect === 'navigation' ? node?.href : undefined
    return { kind: action.kind, page: copy(actionPage(action)), title: document.title.slice(0, 256),
      ...(node ? { target: { tag: node.tagName.toLowerCase(), label: labelOf(node), type: node.type ?? '' } } : {}), effect,
      ...(destination ? { destination } : {}), ...(action.kind === 'fill' ? { valuePreview: action.value.length > 160 ? `${action.value.slice(0, 160)}… (${action.value.length})` : action.value } : {}) }
  }
  const fieldState = node => node ? ({ critical: critical(node), value: node.value ?? null, checked: node.checked ?? null,
    selected: node.selectedIndex ?? null, options: optionsOf(node), content: node.isContentEditable ? node.textContent : null }) : null
  const pageState = (action, node) => {
    const form = formOf(node)
    if (form?.elements.length > MAX_ELEMENTS) throw new Error('preparation_too_large')
    // Values stay only in this document's bounded memory. They never enter a receipt or storage.
    const value = JSON.stringify({ url: location.href, title: document.title, description: describe(action, node),
      node: node ? fieldState(node) : null,
      dropTarget: action.kind === 'drag' ? fieldState(staleElement({ element: action.target })) : null,
      form: form ? { text: form.textContent, fields: [...form.elements].map(fieldState) } : null,
      details: disclosure(node) ? node.parentElement.open : null })
    if (new TextEncoder().encode(value).byteLength > MAX_PREPARATION_BYTES) throw new Error('preparation_too_large')
    return value
  }
  const binding = request => JSON.stringify([request.installationId, request.sessionId, request.grantEpoch])
  const prepare = request => {
    prune()
    const reject = reason => receipt(request, 'failed', { reason, quiescent: true })
    if (!validIdentity(request) || request.payload?.kind !== 'prepare') return reject('invalid_request')
    const prior = records.get(request.requestId)
    if (prior) return sameIdentity(prior.identity, request) ? copy(prior.receipt) : reject('request_conflict')
    if (Date.now() >= request.deadline) return reject('deadline')
    const expiresAt = request.payload.expiresAt ?? request.deadline
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 300_000) return reject('invalid_preparation_expiry')
    if (preparations.size >= MAX_PREPARATIONS || records.size >= MAX_RECORDS) return reject('capacity')
    const action = request.payload.action
    if (![...pageActions, ...elementActions].includes(action?.kind) || actionPage(action)?.url !== location.href) return reject('invalid_action')
    const node = action.element ? staleElement(action) : null
    if (action.element && !node) return reject('stale_element')
    if (node && (disabledControl(node) || action.kind !== 'upload' && !visible(node))) return reject('target_unavailable')
    if (action.kind === 'fill' && !editable(node)) return reject('not_editable')
    if (action.kind === 'submit' && !formOf(node)) return reject('not_submittable')
    if (action.kind === 'select' && node?.tagName !== 'SELECT') return reject('not_selectable')
    if (action.kind === 'check' && !['checkbox', 'radio'].includes(node?.type)) return reject('not_checkable')
    if (action.kind === 'upload' && node?.type !== 'file') return reject('not_file_input')
    if (action.kind === 'drag' && (JSON.stringify(action.element.page) !== JSON.stringify(action.target?.page)
      || !staleElement({ element: action.target }))) return reject('stale_drop_target')
    try {
      const state = pageState(action, node)
      const preparationId = crypto.randomUUID()
      const description = describe(action, node)
      preparations.set(preparationId, { action: JSON.stringify(action), binding: binding(request), state, node, expiresAt, used: false })
      if (action.element) snapshots.get(action.element.snapshotId).expiresAt = Math.max(snapshots.get(action.element.snapshotId).expiresAt, expiresAt)
      const result = receipt(request, 'observed', { quiescent: true, value: { preparationId, expiresAt, description } })
      addRecord(request, { receipt: result })
      return copy(result)
    } catch { return reject('preparation_too_large') }
  }

  const effectState = node => JSON.stringify({ url: location.href, title: document.title, text: visibleBodyText().text, node: fieldState(node), controlState: stateOf(node) })
  const run = (node, action) => {
    if (node && (disabledControl(node) || !visible(node))) return { rejected: 'target_unavailable' }
    if (action.kind === 'click') {
      const before = effectState(node)
      node.click()
      return before === effectState(node) ? { unverified: 'effect_unverified' }
        : { elementId: action.element.elementId, effect: 'page-changed', businessOutcome: 'unverified' }
    }
    if (action.kind === 'fill') {
      if (!editable(node)) return { rejected: 'not_editable' }
      if (node.isContentEditable) node.textContent = action.value
      else node.value = action.value
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: action.value }))
      node.dispatchEvent(new Event('change', { bubbles: true }))
      return (node.isContentEditable ? node.textContent : node.value) === action.value
        ? { elementId: action.element.elementId, valueSet: true, businessOutcome: 'unverified' }
        : { unverified: 'field_value_unverified' }
    }
    if (action.kind === 'submit') {
      const form = formOf(node)
      if (!form) return { rejected: 'not_submittable' }
      const submitter = node instanceof HTMLButtonElement && node.type === 'submit'
        || node instanceof HTMLInputElement && ['submit', 'image'].includes(node.type) ? node : undefined
      if (!form.noValidate && !submitter?.formNoValidate && !form.checkValidity()) return { rejected: 'form_invalid' }
      const before = effectState(node)
      form.requestSubmit(submitter)
      return before === effectState(node) ? { unverified: 'effect_unverified' }
        : { elementId: action.element.elementId, effect: 'page-changed', businessOutcome: 'unverified' }
    }
    return { rejected: 'unsupported_action' }
  }

  const execute = request => {
    prune()
    if (!validIdentity(request)) return Promise.resolve({ outcome: 'failed', reason: 'invalid_request', quiescent: true })
    const prior = records.get(request.requestId)
    if (prior) return Promise.resolve(sameIdentity(prior.identity, request)
      ? copy(prior.receipt ?? unknown(request, 'in_flight'))
      : receipt(request, 'failed', { reason: 'request_conflict', quiescent: true }))
    if (Date.now() >= request.deadline) return Promise.resolve(receipt(request, 'failed', { reason: 'deadline', quiescent: true }))
    if (records.size >= MAX_RECORDS) return Promise.resolve(receipt(request, 'failed', { reason: 'capacity', quiescent: true }))
    const committed = request.payload?.kind === 'commit'
    const action = committed ? request.payload.action : request.payload
    if (!action || typeof action !== 'object' || typeof action.kind !== 'string') return Promise.resolve(receipt(request, 'failed', { reason: 'invalid_action', quiescent: true }))
    if (!['snapshot', 'navigate', 'click', 'fill', 'submit', 'scroll', 'wait'].includes(action.kind)) return Promise.resolve(receipt(request, 'failed', { reason: 'unsupported_action', quiescent: true }))
    const page = actionPage(action)
    if (page && page.url !== window.location.href) return Promise.resolve(receipt(request, 'failed', { reason: 'stale_element', quiescent: true }))
    if (committed) {
      const reject = reason => Promise.resolve(receipt(request, 'failed', { reason, quiescent: true }))
      const prepared = preparations.get(request.payload.preparationId)
      if (!prepared) return reject('preparation_unavailable')
      if (prepared.used) return reject('preparation_used')
      if (prepared.binding !== binding(request) || prepared.action !== JSON.stringify(action)) return reject('preparation_mismatch')
      const node = action.element ? staleElement(action) : null
      if (action.element && (!node || node !== prepared.node)) return reject('stale_preparation')
      try { if (pageState(action, node) !== prepared.state) return reject('stale_preparation') }
      catch { return reject('stale_preparation') }
      prepared.used = true
      // No await separates this comparison from the one synchronous DOM operation below.
    }
    if (action.kind === 'wait') {
      if (!Number.isSafeInteger(action.milliseconds) || action.milliseconds < 0 || action.milliseconds > 15_000) return Promise.resolve(receipt(request, 'failed', { reason: 'invalid_wait', quiescent: true }))
      let resolve
      const promise = new Promise(done => { resolve = done })
      const record = addRecord(request, { receipt: undefined, resolve, cancel: undefined })
      const remaining = request.deadline - Date.now()
      const completed = action.milliseconds <= remaining
      const timer = setTimeout(() => finish(record, completed
        ? receipt(request, 'observed', { quiescent: true, value: { milliseconds: action.milliseconds } })
        : receipt(request, 'cancelled', { reason: 'deadline', quiescent: true })), Math.min(action.milliseconds, remaining))
      record.cancel = () => { clearTimeout(timer); finish(record, receipt(request, 'cancelled', { quiescent: true })) }
      return promise
    }
    const record = addRecord(request, { receipt: undefined })
    const conclude = value => {
      record.receipt = copy(value)
      return Promise.resolve(copy(value))
    }
    if (action.kind === 'snapshot') return conclude(receipt(request, 'observed', { quiescent: true, value: snapshot() }))
    if (action.kind === 'scroll') {
      try { scrollTo(action.x, action.y) } catch { return conclude(unknown(request, 'scroll_unknown')) }
      return conclude(receipt(request, 'observed', { quiescent: true, value: { x: window.scrollX, y: window.scrollY } }))
    }
    if (action.kind === 'navigate') {
      try { window.location.assign(action.url) } catch { return conclude(unknown(request, 'navigate_unknown')) }
      return conclude(unknown(request, 'navigation_in_progress'))
    }
    const node = staleElement(action)
    if (!node) return conclude(receipt(request, 'failed', { reason: 'stale_element', quiescent: true }))
    try {
      if (committed && action.kind === 'click' && disclosure(node)) {
        node.parentElement.open = !node.parentElement.open
        return conclude(receipt(request, 'observed', { quiescent: true, value: { elementId: action.element.elementId, expanded: node.parentElement.open } }))
      }
      const value = run(node, action)
      if (value?.rejected) return conclude(receipt(request, 'failed', { reason: value.rejected, quiescent: true }))
      if (value?.unverified) return conclude(unknown(request, value.unverified, true))
      return conclude(receipt(request, 'observed', { quiescent: true, value }))
    } catch { return conclude(unknown(request, 'action_unknown')) }
  }

  // Persistent entry mounts: idempotent by mountId. Each button hands the
  // clicked item's title+link back to the assistant through chrome.runtime.
  const MAX_ENTRY_ITEMS = 2000
  const entryMounts = new Map()
  const entryInspections = new Map()
  const entryCollections = new Map()
  const routeDiscards = new Map()
  // Protocol retention bounds for one injected document, including owner keys.
  const MAX_ENTRY_RECORDS = 128
  const MAX_COLLECTION_BYTES = 65_536
  const MAX_ROUTE_DISCARDS = 128
  const entryOwner = request => JSON.stringify([request.sessionId, request.installationId, request.grantEpoch,
    request.payload.page?.tabId, request.payload.page?.frameId, request.payload.page?.documentId])
  const routeDiscardKey = (resource, mountId) => `${resource}\u0000${mountId}`
  const pruneRouteDiscards = () => {
    while (routeDiscards.size > MAX_ROUTE_DISCARDS) routeDiscards.delete(routeDiscards.keys().next().value)
  }
  const rememberRouteDiscard = (resource, mountId, request, page, owner) => {
    if (!page || location.href === page.url) return
    routeDiscards.set(routeDiscardKey(resource, mountId), { owner, page: { ...page } })
    pruneRouteDiscards()
  }
  const routeDiscarded = (resource, mountId, request, page, owner) => {
    pruneRouteDiscards()
    const tombstone = routeDiscards.get(routeDiscardKey(resource, mountId))
    return tombstone !== undefined && tombstone.owner === owner && tombstone.page.tabId === page?.tabId
      && tombstone.page.frameId === page?.frameId && tombstone.page.documentId === page?.documentId
      && tombstone.page.url === page?.url && location.href !== page?.url
  }
  // A renewed grant may release its own earlier page decoration, but it can
  // never render/update it. This prevents orphaned controls after a grant
  // rollover without turning a cleanup request into ownership takeover.
  const renewedOwnerCanRelease = (existingOwner, request) => {
    try {
      const [sessionId, installationId, epoch, tabId, frameId, documentId] = JSON.parse(existingOwner)
      const page = request.payload.page
      return sessionId === request.sessionId && installationId === request.installationId
        && Number.isSafeInteger(epoch) && request.grantEpoch > epoch
        && tabId === page?.tabId && frameId === page?.frameId && documentId === page?.documentId
    } catch { return false }
  }
  const bindingKey = request => JSON.stringify([entryOwner(request), request.payload.regionSelector, request.payload.selector,
    request.payload.titleSelector ?? null, request.payload.linkSelector ?? null])
  const buttonsFor = mountId => [...document.querySelectorAll('[data-dsh-entry-mount-id]')]
    .filter(button => button.dataset.dshEntryMountId === mountId)
  const entryText = node => {
    if (!node) return ''
    const clone = node.cloneNode(true)
    for (const button of clone.querySelectorAll?.('[data-dsh-entry-mount]') ?? []) button.remove()
    return text(clone.textContent).slice(0, 200)
  }
  const fieldsOf = (item, action) => {
    const titleNode = action.titleSelector ? item.querySelector(action.titleSelector) : item.querySelector('a')
    const linkNode = action.linkSelector ? item.querySelector(action.linkSelector) : item.querySelector('a[href]')
    return { item, titleNode, linkNode, title: entryText(titleNode ?? item), link: linkNode?.href ?? '' }
  }
  const sameFields = (left, right) => left.item === right.item && left.titleNode === right.titleNode
    && left.linkNode === right.linkNode && left.title === right.title && left.link === right.link
  const bindingFacts = action => {
    const regions = [...document.querySelectorAll(action.regionSelector)]
    if (regions.length !== 1) return { error: 'ambiguous_region' }
    if (!action.selector.startsWith(':scope')) return { error: 'binding_outside_region' }
    const root = regions[0]
    const matches = [...root.querySelectorAll(action.selector)]
    return { root, rows: matches.slice(0, MAX_ENTRY_ITEMS).map(item => fieldsOf(item, action)), count: matches.length }
  }
  const entryStyle = collected => `display:inline-block;padding:2px 10px;margin:0 0 0 8px;font-size:12px;line-height:1.4;border:1px solid ${collected ? 'transparent' : '#99a'};border-radius:10px;background:${collected ? '#eee' : '#f0f4ff'};color:${collected ? '#888' : '#2255aa'};cursor:${collected ? 'default' : 'pointer'};font-family:system-ui,sans-serif;${collected ? 'opacity:0.65;' : ''}`
  const entryOf = (item, action) => {
    const { title, link } = fieldsOf(item, action)
    return { title, link }
  }
  const entryUnmountById = mountId => {
    const existing = entryMounts.get(mountId)
    existing?.observer.disconnect()
    entryMounts.delete(mountId)
    for (const button of buttonsFor(mountId)) button.remove()
  }
  const releaseEntryState = (owner, mountId, forgetCollected) => {
    for (const [key, inspection] of entryInspections) if (inspection.owner === owner) entryInspections.delete(key)
    entryUnmountById(mountId)
    if (forgetCollected) entryCollections.delete(JSON.stringify([owner, mountId]))
  }
  const validEntryBinding = action => typeof action.regionSelector === 'string' && action.regionSelector.length > 0
    && typeof action.selector === 'string' && action.selector.length > 0 && action.selector.length <= 256
    && (action.titleSelector === undefined || typeof action.titleSelector === 'string' && action.titleSelector.length <= 256)
    && (action.linkSelector === undefined || typeof action.linkSelector === 'string' && action.linkSelector.length <= 256)
    && (action.sampleLimit === undefined || Number.isSafeInteger(action.sampleLimit) && action.sampleLimit >= 1 && action.sampleLimit <= 12)
  const entryInspect = request => {
    prune()
    if (!validIdentity(request) || request.payload?.kind !== 'entry_inspect' || !validEntryBinding(request.payload)) {
      return receipt(request, 'failed', { reason: 'invalid_action', quiescent: true })
    }
    const action = request.payload
    const page = actionPage(action)
    if (page && page.url !== location.href) return receipt(request, 'failed', { reason: 'target_url_stale', quiescent: true })
    const key = bindingKey(request)
    entryInspections.delete(key)
    let facts
    try { facts = bindingFacts(action) } catch {
      return receipt(request, 'failed', { reason: 'invalid_action', quiescent: true })
    }
    if (facts.error) return receipt(request, 'failed', { reason: facts.error, quiescent: true })
    const limit = action.sampleLimit ?? 6
    const links = new Map()
    let valid = 0, missingTitle = 0, missingLink = 0
    const records = facts.rows.map(({ titleNode, title, link }, index) => {
      const hasTitle = action.titleSelector ? titleNode !== null && title !== '' : title !== ''
      const hasLink = link !== ''
      if (!hasTitle) missingTitle++
      if (!hasLink) missingLink++
      if (hasTitle && hasLink) valid++
      if (hasLink) links.set(link, (links.get(link) ?? 0) + 1)
      return { index, title, link, valid: hasTitle && hasLink }
    })
    const sampleIndexes = new Set()
    for (const index of [0, Math.floor((records.length - 1) / 2), records.length - 1]) {
      if (index >= 0 && sampleIndexes.size < limit) sampleIndexes.add(index)
    }
    for (const record of records) {
      if (!record.valid && sampleIndexes.size < limit) sampleIndexes.add(record.index)
    }
    for (const record of records) {
      if (sampleIndexes.size >= limit) break
      sampleIndexes.add(record.index)
    }
    if (entryInspections.size >= MAX_ENTRY_RECORDS) return receipt(request, 'failed', { reason: 'inspect_capacity', quiescent: true })
    entryInspections.set(key, { owner: entryOwner(request), ...facts })
    return receipt(request, 'observed', { quiescent: true, value: {
      matched: facts.rows.length, valid, missingTitle, missingLink,
      duplicateLinks: [...links.values()].filter(count => count > 1).reduce((sum, count) => sum + count - 1, 0),
      truncated: facts.count > MAX_ENTRY_ITEMS,
      samples: [...sampleIndexes].sort((left, right) => left - right).map(index => records[index]),
    } })
  }
  const entryMount = request => {
    prune()
    if (!validIdentity(request) || request.payload?.kind !== 'entry_mount'
      || typeof request.payload.mountId !== 'string' || !request.payload.mountId
      || typeof request.payload.selector !== 'string' || !request.payload.selector
      || request.payload.regionSelector !== undefined && (typeof request.payload.regionSelector !== 'string' || !request.payload.regionSelector)
      || typeof request.payload.label !== 'string' || !request.payload.label
      || request.payload.titleSelector !== undefined && typeof request.payload.titleSelector !== 'string'
      || request.payload.linkSelector !== undefined && typeof request.payload.linkSelector !== 'string'
      || request.payload.collected !== undefined && (!Array.isArray(request.payload.collected)
        || request.payload.collected.length > 512 || request.payload.collected.some(v => typeof v !== 'string')))
      return receipt(request, 'failed', { reason: 'invalid_action', quiescent: true })
    const action = request.payload
    const page = actionPage(action)
    if (page && page.url !== location.href) return receipt(request, 'failed', { reason: 'target_url_stale', quiescent: true })
    const fail = reason => receipt(request, 'failed', { reason, quiescent: true })
    const owner = entryOwner(request)
    const existing = entryMounts.get(action.mountId)
    if (existing && existing.owner !== owner) return fail('mount_owner_mismatch')
    const key = bindingKey(request)
    const inspected = entryInspections.get(key)
    if (!inspected) return fail('inspect_required')
    let facts
    try { facts = bindingFacts(action) } catch { return fail('invalid_action') }
    if (facts.error) return fail(facts.error)
    if (facts.root !== inspected.root || facts.count !== inspected.count || facts.rows.length !== inspected.rows.length
      || !facts.rows.every((row, index) => sameFields(row, inspected.rows[index]))) return fail('stale_binding')
    if (!existing && entryMounts.size >= MAX_ENTRY_RECORDS) return fail('mount_capacity')
    const collectionKey = JSON.stringify([owner, action.mountId])
    const collected = new Set(action.collected ?? entryCollections.get(collectionKey) ?? [])
    const nextCollections = new Map(entryCollections)
    nextCollections.set(collectionKey, [...collected])
    if (nextCollections.size > MAX_ENTRY_RECORDS || new TextEncoder().encode(JSON.stringify([...nextCollections])).byteLength > MAX_COLLECTION_BYTES) return fail('collection_capacity')
    entryUnmountById(action.mountId)
    entryCollections.set(collectionKey, [...collected])
    const documentId = request.target?.documentId ?? page?.documentId ?? ''
    let mounted = 0
    const attached = new Map()
    const invalidated = new WeakSet()
    const attach = item => {
      if (mounted >= MAX_ENTRY_ITEMS || !item?.isConnected || !item.appendChild) return
      if (attached.has(item) || invalidated.has(item)) return
      const entry = entryOf(item, action)
      if (!entry.link) return
      const fields = fieldsOf(item, action)
      const isCollected = entry.link !== '' && collected.has(entry.link)
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.dshEntryMount = 'true'
      button.dataset.dshEntryMountId = action.mountId
      button.setAttribute('style', entryStyle(isCollected))
      button.setAttribute('aria-label', isCollected ? `${action.label}（已加入）` : action.label)
      button.textContent = isCollected ? `${action.label} · 已加入` : action.label
      if (isCollected) button.disabled = true
      button.addEventListener('click', () => {
        if (!item.isConnected || !facts.root.isConnected || location.href !== page?.url
          || !sameFields(fields, fieldsOf(item, action)) || entryMounts.get(action.mountId)?.owner !== owner) {
          button.remove(); invalidated.add(item); attached.delete(item); return
        }
        void chrome.runtime.sendMessage({ type: 'dsh-entry-click', mountId: action.mountId, documentId,
          url: location.href, entry: { title: entry.title, link: entry.link } })
      })
      item.appendChild(button)
      attached.set(item, { button, fields })
      mounted++
    }
    const root = facts.root
    for (const row of facts.rows) attach(row.item)
    const observer = new MutationObserver(() => {
      if (!entryMounts.has(action.mountId)) return
      // pushState keeps the document alive. Do not let an old binding decorate
      // a newly routed page merely because its root element was reused.
      if (location.href !== page?.url) {
        entryUnmountById(action.mountId)
        rememberRouteDiscard('entry', action.mountId, request, page, owner)
        reportRouteDiscard('entry', action.mountId, request, page)
        return
      }
      for (const [item, record] of attached) {
        if (!root.isConnected || !item.isConnected || !root.contains(item) || !sameFields(record.fields, fieldsOf(item, action))) {
          record.button.remove(); invalidated.add(item); attached.delete(item); mounted--
        }
      }
      if (root.isConnected) for (const match of root.querySelectorAll(action.selector)) attach(match)
    })
    observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true })
    entryMounts.set(action.mountId, { observer, owner, key, attached })
    return receipt(request, 'observed', { quiescent: true, value: { mounted, collected: [...collected] } })
  }
  const entryUnmount = request => {
    prune()
    if (!validIdentity(request) || request.payload?.kind !== 'entry_unmount'
      || typeof request.payload.mountId !== 'string' || !request.payload.mountId
      || request.payload.forgetCollected !== undefined && typeof request.payload.forgetCollected !== 'boolean')
      return receipt(request, 'failed', { reason: 'invalid_action', quiescent: true })
    const page = actionPage(request.payload)
    const owner = entryOwner(request)
    const existing = entryMounts.get(request.payload.mountId)
    if (page && page.url !== location.href) {
      const heldByExactOwner = existing?.owner === owner
      if (heldByExactOwner) {
        entryUnmountById(request.payload.mountId)
        rememberRouteDiscard('entry', request.payload.mountId, request, page, owner)
        reportRouteDiscard('entry', request.payload.mountId, request, page)
      }
      if (heldByExactOwner || routeDiscarded('entry', request.payload.mountId, request, page, owner)) {
        releaseEntryState(owner, request.payload.mountId, request.payload.forgetCollected === true)
        return receipt(request, 'observed', { quiescent: true, value: { unmounted: true, remaining: 0, disposition: 'route_discarded' } })
      }
      return receipt(request, 'failed', { reason: 'target_url_stale', quiescent: true })
    }
    if (existing && existing.owner !== owner && !renewedOwnerCanRelease(existing.owner, request)) return receipt(request, 'failed', { reason: 'mount_owner_mismatch', quiescent: true })
    const releasedOwner = existing?.owner ?? owner
    releaseEntryState(releasedOwner, request.payload.mountId, request.payload.forgetCollected || releasedOwner !== owner)
    return receipt(request, 'observed', { quiescent: true, value: { unmounted: true, remaining: buttonsFor(request.payload.mountId).length } })
  }
  const releaseEntries = (installationId, sessionId) => {
    const matches = owner => {
      const parts = JSON.parse(owner)
      return (installationId === undefined || parts[1] === installationId) && (sessionId === undefined || parts[0] === sessionId)
    }
    for (const [mountId, mount] of entryMounts) if (matches(mount.owner)) entryUnmountById(mountId)
    for (const [key, inspection] of entryInspections) if (matches(inspection.owner)) entryInspections.delete(key)
    for (const key of entryCollections.keys()) if (matches(JSON.parse(key)[0])) entryCollections.delete(key)
  }
  const releaseInstallation = (installationId, grantEpoch) => {
    const matches = owner => {
      const parts = JSON.parse(owner)
      return parts[1] === installationId && parts[2] === grantEpoch
    }
    for (const [mountId, mount] of entryMounts) if (matches(mount.owner)) entryUnmountById(mountId)
    for (const [mountId, mount] of regionMounts) if (matches(mount.owner)) regionClearById(mountId)
    for (const [key, inspection] of entryInspections) if (matches(inspection.owner)) entryInspections.delete(key)
    for (const key of entryCollections.keys()) if (matches(JSON.parse(key)[0])) entryCollections.delete(key)
  }

  // Persistent region mounts: render a bounded, Host-supplied content panel inside
  // one page region. Idempotent by mountId. Every field becomes a DOM text node, so
  // a page is never handed markup to interpret. Append mode adds nodes; replace mode
  // moves original child nodes aside and restores them when the mount is cleared.
  const MAX_REGION_BLOCKS = 200
  const MAX_REGION_CONTAINERS = 2
  const MAX_REGION_REATTACH = 200
  const regionMounts = new Map()
  // This message is emitted only after this isolated page runtime removed its
  // own registry and DOM mount on a same-document route change. It is not a
  // generic URL-stale hint and therefore carries the exact signed mount owner.
  const reportRouteDiscard = (resource, mountId, request, page) => {
    if (!page || location.href === page.url) return
    const sendMessage = globalThis.chrome?.runtime?.sendMessage
    if (typeof sendMessage !== 'function') return
    void sendMessage({ type: 'dsh-route-discarded', resource, mountId,
      sessionId: request.sessionId, installationId: request.installationId, grantEpoch: request.grantEpoch,
      page: { tabId: page.tabId, frameId: page.frameId, documentId: page.documentId, url: page.url }, currentUrl: location.href })
  }
  const regionOwner = request => JSON.stringify([request.sessionId, request.installationId, request.grantEpoch,
    request.payload.page?.tabId, request.payload.page?.frameId, request.payload.page?.documentId])
  const presentationOwner = value => {
    const page = value?.page
    if (!value || typeof value.sessionId !== 'string' || typeof value.installationId !== 'string'
      || !Number.isSafeInteger(value.grantEpoch) || !page || !Number.isSafeInteger(page.tabId)
      || !Number.isSafeInteger(page.frameId) || typeof page.documentId !== 'string' || typeof page.url !== 'string') return null
    return JSON.stringify([value.sessionId, value.installationId, value.grantEpoch,
      page.tabId, page.frameId, page.documentId, page.url])
  }
  const renderedPresentationOwner = request => presentationOwner({
    sessionId: request.sessionId, installationId: request.installationId, grantEpoch: request.grantEpoch,
    page: request.payload.page,
  })
  const regionPanels = mountId => [...document.querySelectorAll('[data-dsh-region-mount-id]')]
    .filter(node => node.dataset.dshRegionMountId === mountId)
  const containerHasRegionPanel = (container, mounted) => [...(mounted?.panels ?? [])]
    .some(panel => panel.isConnected && container.contains(panel))
  const regionPanelStyle = 'all:initial;display:block;box-sizing:border-box;margin:0 0 12px;padding:12px 14px;border:1px solid rgba(127,127,127,.28);border-radius:12px;background:#fff;color:#1a1a1a;font:13px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.06)'
  const safeHref = value => {
    try {
      const url = new URL(String(value ?? ''), location.href)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
      return url.href
    } catch { return null }
  }
  const regionLink = (href, labelText) => {
    const resolved = safeHref(href)
    if (!resolved) return null
    const anchor = document.createElement('a')
    anchor.href = resolved
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    anchor.setAttribute('style', 'color:#1772f6;text-decoration:none')
    anchor.textContent = text(labelText).slice(0, 512) || resolved
    return anchor
  }
  const regionBlockNode = block => {
    const row = document.createElement('div')
    row.setAttribute('style', 'margin:0 0 6px')
    if (block?.type === 'heading') {
      row.setAttribute('style', 'font-weight:600;margin:8px 0 4px')
      row.textContent = text(block.text).slice(0, 512)
      return row
    }
    if (block?.type === 'text') {
      row.textContent = text(block.text).slice(0, 4096)
      return row
    }
    if (block?.type === 'keyvalue') {
      const label = document.createElement('span')
      label.setAttribute('style', 'color:#666;margin-right:6px')
      label.textContent = text(block.label).slice(0, 256)
      const value = document.createElement('span')
      value.textContent = text(block.value).slice(0, 1024)
      row.append(label, value)
      return row
    }
    if (block?.type === 'item') {
      const title = document.createElement('div')
      title.setAttribute('style', 'font-weight:500')
      title.textContent = text(block.title).slice(0, 512)
      row.append(title)
      if (typeof block.meta === 'string' && block.meta) {
        const meta = document.createElement('div')
        meta.setAttribute('style', 'color:#888;font-size:12px')
        meta.textContent = text(block.meta).slice(0, 512)
        row.append(meta)
      }
      const anchor = regionLink(block.link, '查看')
      if (anchor) row.append(anchor)
      return row
    }
    if (block?.type === 'link') {
      const anchor = regionLink(block.href, block.text)
      if (anchor) row.append(anchor)
      else row.textContent = text(block.text).slice(0, 512)
      return row
    }
    return row
  }
  const regionPanel = (mountId, action) => {
    const panel = document.createElement('div')
    panel.dataset.dshRegionMount = 'true'
    panel.dataset.dshRegionMountId = mountId
    panel.dataset.dshRegionMode = action.mode === 'replace' ? 'replace' : 'append'
    panel.setAttribute('style', regionPanelStyle)
    panel.setAttribute('role', 'region')
    panel.setAttribute('aria-label', typeof action.title === 'string' && action.title ? action.title : 'DSH 面板')
    if (typeof action.title === 'string' && action.title) {
      const heading = document.createElement('div')
      heading.setAttribute('style', 'font-weight:600;margin:0 0 8px')
      heading.textContent = action.title
      panel.append(heading)
    }
    for (const block of action.blocks.slice(0, MAX_REGION_BLOCKS)) panel.append(regionBlockNode(block))
    return panel
  }
  const restoreReplacedNodes = existing => {
    let restored = 0
    for (const saved of existing?.replaced ?? []) {
      if (!saved.container?.isConnected) continue
      // A route renderer may have populated this still-connected container
      // before our observer runs.  Restoring the pre-render nodes then would
      // overwrite that new route.  A restore is safe only while this exact
      // mount still owns every child of the container.
      const children = [...saved.container.childNodes]
      const whollyOwned = children.length > 0 && children.every(node => existing.panels.has(node))
      if (whollyOwned) { saved.container.replaceChildren(...saved.nodes); restored++ }
    }
    return restored
  }
  const regionClearById = mountId => {
    const existing = regionMounts.get(mountId)
    existing?.observer.disconnect()
    const restored = restoreReplacedNodes(existing)
    regionMounts.delete(mountId)
    const panels = existing === undefined ? regionPanels(mountId) : [...existing.panels]
    // A reloaded runtime can remove its panel, but cannot prove what a
    // replace-mode container held before the lost registry. Keep its Host
    // lease unresolved instead of claiming a restoration we did not perform.
    const unverifiedReplacement = existing === undefined && panels.some(panel => panel.dataset.dshRegionMode === 'replace')
    for (const node of panels) node.remove()
    if (existing === undefined && panels.length === 0) {
      return { cleared: true, restored: 0, disposition: 'absent' }
    }
    return { cleared: !unverifiedReplacement && (existing !== undefined || panels.length > 0), restored }
  }
  // Same-document URL drift is not document destruction. For replace mode we
  // must not restore nodes captured from the prior route into the new route.
  const discardRegionById = mountId => {
    const existing = regionMounts.get(mountId)
    existing?.observer.disconnect()
    regionMounts.delete(mountId)
    for (const node of existing === undefined ? regionPanels(mountId) : existing.panels) node.remove()
  }
  const regionContainers = selector => {
    try { return [...document.querySelectorAll(selector)].slice(0, MAX_REGION_CONTAINERS) }
    catch { return null }
  }
  const regionRender = request => {
    prune()
    if (!validIdentity(request) || request.payload?.kind !== 'region_render'
      || typeof request.payload.mountId !== 'string' || !request.payload.mountId
      || typeof request.payload.selector !== 'string' || !request.payload.selector
      || !Array.isArray(request.payload.blocks) || request.payload.blocks.length < 1
      || request.payload.blocks.length > MAX_REGION_BLOCKS
      || request.payload.title !== undefined && typeof request.payload.title !== 'string'
      || request.payload.placement !== undefined && !['prepend', 'append'].includes(request.payload.placement)
      || request.payload.mode !== undefined && !['append', 'replace'].includes(request.payload.mode))
      return receipt(request, 'failed', { reason: 'invalid_action', quiescent: true })
    const action = request.payload
    const page = actionPage(action)
    if (page && page.url !== location.href) return receipt(request, 'failed', { reason: 'target_url_stale', quiescent: true })
    const owner = regionOwner(request)
    const current = regionMounts.get(action.mountId)
    if (current && current.owner !== owner) return receipt(request, 'failed', { reason: 'region_mount_owner_mismatch', quiescent: true })
    const containers = regionContainers(action.selector)
    if (containers === null) return receipt(request, 'failed', { reason: 'invalid_action', quiescent: true })
    if (containers.length === 0) return receipt(request, 'failed', { reason: 'region_target_not_found', quiescent: true })
    if (containers.length > 1) return receipt(request, 'failed', { reason: 'ambiguous_region', quiescent: true })
    regionClearById(action.mountId)
    const placement = action.placement === 'append' ? 'append' : 'prepend'
    const mode = action.mode === 'replace' ? 'replace' : 'append'
    const panels = new Set()
    const replaced = []
    let rendered = 0
    for (const container of containers) {
      if (!container?.isConnected || typeof container[placement] !== 'function') continue
      const panel = regionPanel(action.mountId, action)
      if (mode === 'replace') {
        replaced.push({ container, nodes: [...container.childNodes] })
        container.replaceChildren(panel)
      } else container[placement](panel)
      panels.add(panel)
      rendered++
    }
    if (rendered === 0) return receipt(request, 'failed', { reason: 'region_target_not_found', quiescent: true })
    // A SPA may replace the matched container later. Re-attach the same panel when
    // the container comes back, bounded so a hostile re-render loop cannot spin.
    let reattached = 0
    const observer = new MutationObserver(() => {
      const mounted = regionMounts.get(action.mountId)
      if (!mounted || mounted.url !== location.href || reattached >= MAX_REGION_REATTACH) {
        if (mounted && mounted.url !== location.href) {
          discardRegionById(action.mountId)
          rememberRouteDiscard('region', action.mountId, request, page, owner)
          reportRouteDiscard('region', action.mountId, request, page)
        }
        return
      }
      const live = regionContainers(action.selector)
      if (live === null || live.length !== 1) return
      for (const container of live) {
        if (!container?.isConnected || typeof container[placement] !== 'function') continue
        if (containerHasRegionPanel(container, mounted)) continue
        const panel = regionPanel(action.mountId, action)
        if (mode === 'replace') {
          mounted.replaced.push({ container, nodes: [...container.childNodes] })
          container.replaceChildren(panel)
        } else container[placement](panel)
        mounted.panels.add(panel)
        reattached++
        rendered++
      }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
    regionMounts.set(action.mountId, { observer, url: location.href, replaced, owner,
      presentationOwner: renderedPresentationOwner(request), panels })
    return receipt(request, 'observed', { quiescent: true, value: mode === 'replace'
      ? { rendered, containers: containers.length, replaced: rendered }
      : { rendered, containers: containers.length } })
  }
  const regionClear = request => {
    prune()
    if (!validIdentity(request) || request.payload?.kind !== 'region_clear'
      || typeof request.payload.mountId !== 'string' || !request.payload.mountId)
      return receipt(request, 'failed', { reason: 'invalid_action', quiescent: true })
    const page = actionPage(request.payload)
    const owner = regionOwner(request)
    const existing = regionMounts.get(request.payload.mountId)
    if (page && page.url !== location.href) {
      const heldByExactOwner = existing?.owner === owner && existing.url === page.url
      if (heldByExactOwner) {
        discardRegionById(request.payload.mountId)
        rememberRouteDiscard('region', request.payload.mountId, request, page, owner)
        reportRouteDiscard('region', request.payload.mountId, request, page)
      }
      if (heldByExactOwner || routeDiscarded('region', request.payload.mountId, request, page, owner)) {
        return receipt(request, 'observed', { quiescent: true, value: { cleared: true, restored: 0, disposition: 'route_discarded' } })
      }
      return receipt(request, 'failed', { reason: 'target_url_stale', quiescent: true })
    }
    if (existing && existing.owner !== owner && !renewedOwnerCanRelease(existing.owner, request)) {
      return receipt(request, 'failed', { reason: 'region_mount_owner_mismatch', quiescent: true })
    }
    const cleared = regionClearById(request.payload.mountId)
    return receipt(request, 'observed', { quiescent: true, value: cleared })
  }

  const pageMap = request => {
    prune()
    if (!validIdentity(request) || request.payload?.kind !== 'page_map') return receipt(request, 'failed', { reason: 'invalid_action', quiescent: true })
    const page = actionPage(request.payload)
    if (page && page.url !== location.href) return receipt(request, 'failed', { reason: 'target_url_stale', quiescent: true })
    const nodes = [...document.querySelectorAll('header,nav,main,aside,footer,section,[role="main"],[role="navigation"],[role="complementary"],[role="region"]')]
      .filter(visible).slice(0, 32)
    const selectorOf = node => {
      const escape = value => globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/gu, '\\$&')
      if (node.id) {
        const candidate = `#${escape(node.id)}`
        if (document.querySelectorAll(candidate).length === 1) return candidate
      }
      const parts = []
      let cursor = node
      while (cursor?.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
        const tag = cursor.tagName.toLowerCase()
        const siblings = cursor.parentElement ? [...cursor.parentElement.children].filter(sibling => sibling.tagName === cursor.tagName) : []
        const suffix = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(cursor) + 1})` : ''
        parts.unshift(`${tag}${suffix}`)
        const candidate = parts.join(' > ')
        if (document.querySelectorAll(candidate).length === 1) return candidate
        cursor = cursor.parentElement
      }
      return parts.join(' > ')
    }
    const roleOfRegion = node => {
      const explicit = node.getAttribute('role')
      if (explicit === 'main' || explicit === 'navigation' || explicit === 'complementary' || explicit === 'region') return explicit
      return ({ HEADER: 'banner', NAV: 'navigation', MAIN: 'main', ASIDE: 'complementary', FOOTER: 'contentinfo' })[node.tagName] ?? 'region'
    }
    const regions = nodes.map((node, index) => {
      const role = roleOfRegion(node)
      const regionText = elementText(node, 320)
      const controls = node.querySelectorAll('input,textarea,select,button,[contenteditable="true"]').length
      const hasPrimary = role === 'main' || node.querySelector('article,h1,h2') !== null
      const adLike = /广告|推广|赞助|ad[-_ ]?container|banner/iu.test(`${node.id} ${node.className} ${regionText.slice(0, 120)}`)
      const importance = hasPrimary ? 'high' : adLike ? 'low' : role === 'complementary' ? 'medium' : 'normal'
      return { regionId: `region-${index + 1}`, role, selector: selectorOf(node), label: text(node.getAttribute('aria-label') ?? node.querySelector(':scope > h1,:scope > h2,:scope > h3')?.textContent ?? '').slice(0, 160),
        text: regionText, importance, disposable: importance === 'low' || (role === 'complementary' && controls === 0), protected: controls > 0 || hasPrimary,
        stability: node.id || node.getAttribute('role') ? 'medium' : 'low', bounds: (() => { const rect = node.getBoundingClientRect(); return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } })() }
    })
    return receipt(request, 'observed', { quiescent: true, value: { page: { tabId: page?.tabId, frameId: page?.frameId, documentId: page?.documentId, url: location.href }, regions } })
  }


  const inspect = (identity, { cancel = false } = {}) => {
    prune()
    if (!validIdentity(identity)) return { outcome: 'unknown', quiescent: false }
    const existing = records.get(identity.requestId)
    if (existing) {
      if (!sameIdentity(existing.identity, identity)) return receipt(identity, 'failed', { reason: 'request_conflict', quiescent: true })
      if (cancel && existing.cancel) existing.cancel()
      return copy(existing.receipt ?? unknown(identity, 'in_flight'))
    }
    if (cancel && Date.now() < identity.deadline && addRecord(identity, { receipt: receipt(identity, 'cancelled', { quiescent: true }) })) return copy(records.get(identity.requestId).receipt)
    return unknown(identity, Date.now() >= identity.deadline ? 'receipt_unavailable' : 'in_flight', Date.now() >= identity.deadline)
  }

  // These methods live only in the extension's isolated world. CDP adopts the
  // exact node from this record, rather than trusting a page-controlled selector.
  const externalRecord = request => {
    const record = records.get(request?.requestId)
    return validIdentity(request) && record?.external && sameIdentity(record.identity, request) ? record : null
  }
  const startExternal = request => {
    prune()
    const reject = reason => receipt(request, 'failed', { reason, quiescent: true })
    if (!validIdentity(request) || request.payload?.kind !== 'commit') return reject('invalid_request')
    const prior = records.get(request.requestId)
    if (prior) return sameIdentity(prior.identity, request) ? copy(prior.receipt ?? unknown(request, 'in_flight')) : reject('request_conflict')
    if (Date.now() >= request.deadline) return reject('deadline')
    if (records.size >= MAX_RECORDS) return reject('capacity')
    const action = request.payload.action, prepared = preparations.get(request.payload.preparationId)
    if (![...elementActions, ...pageActions].includes(action?.kind)) return reject('unsupported_action')
    if (!prepared || prepared.used) return reject('preparation_unavailable')
    if (prepared.binding !== binding(request) || prepared.action !== JSON.stringify(action)) return reject('preparation_mismatch')
    const node = action.element ? staleElement(action) : null
    try { if (action.element && !node || node !== prepared.node || pageState(action, node) !== prepared.state) return reject('stale_preparation') }
    catch { return reject('stale_preparation') }
    prepared.used = true
    const record = addRecord(request, { external: { action, prepared, node, issued: false, before: null }, receipt: undefined })
    record.cancel = () => {
      record.external.cancelled = true
      if (!record.external.issued) finish(record, receipt(request, 'cancelled', { quiescent: true }))
    }
    return { ready: true }
  }
  const externalNode = (request, dropTarget = false) => {
    const record = externalRecord(request)
    return record && !record.receipt && !record.external.cancelled
      ? dropTarget ? staleElement({ element: record.external.action.target }) : record.external.node ?? document.documentElement : null
  }
  const issueExternal = request => {
    const record = externalRecord(request)
    if (!record) return receipt(request, 'failed', { reason: 'request_conflict', quiescent: true })
    if (record.receipt) return copy(record.receipt)
    if (record.external.issued) return unknown(request, 'in_flight')
    const { action, prepared, node } = record.external
    let reason
    if (Date.now() >= request.deadline || Date.now() >= prepared.expiresAt) reason = 'deadline'
    else {
      try { if (action.element && staleElement(action) !== node || pageState(action, node) !== prepared.state) reason = 'stale_preparation' }
      catch { reason = 'stale_preparation' }
    }
    if (reason) { finish(record, receipt(request, 'failed', { reason, quiescent: true })); return copy(record.receipt) }
    record.external.before = effectState(node)
    record.external.issued = true
    return { ready: true }
  }
  const completeExternal = (request, options = {}) => {
    const record = externalRecord(request)
    if (!record) return unknown(request, 'receipt_unavailable')
    if (record.receipt) return copy(record.receipt)
    const { action, node, issued, before, cancelled } = record.external
    let result
    if (!issued) result = receipt(request, cancelled ? 'cancelled' : 'failed', { reason: options.reason ?? 'target_unavailable', quiescent: true })
    else if (options.reason || cancelled) result = unknown(request, options.reason ?? 'cancelled', true)
    else if (action.kind === 'fill') {
      const valueSet = (node.isContentEditable ? node.textContent : node.value) === action.value
      result = valueSet ? receipt(request, 'observed', { quiescent: true, value: { engine: 'puppeteer', valueSet: true, businessOutcome: 'unverified' } })
        : unknown(request, 'field_value_unverified', true)
    } else if (options.result) result = receipt(request, 'observed', { quiescent: true,
      value: { engine: 'puppeteer', ...options.result, businessOutcome: 'unverified' } })
    else result = before !== effectState(node)
      ? receipt(request, 'observed', { quiescent: true, value: { engine: 'puppeteer', effect: 'page-changed', businessOutcome: 'unverified' } })
      : unknown(request, 'effect_unverified', true)
    finish(record, result)
    return copy(result)
  }

  const revealNode = node => {
    if (!node?.isConnected || !visible(node) || typeof node.scrollIntoView !== 'function') {
      return { ok: false, reason: 'target_unavailable' }
    }
    node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    // Web Animations leaves the page's inline styles and interaction state intact.
    if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      node.animate?.([{ outline: '3px solid #6192e3', outlineOffset: '4px' },
        { outline: '3px solid transparent', outlineOffset: '4px' }], { duration: 1800 })
    }
    return { ok: true }
  }
  const reveal = reference => {
    prune()
    if (!reference || reference.url !== location.href) return { ok: false, reason: 'target_changed' }
    const node = staleElement({ element: { ...reference, page: { url: reference.url } } })
    return node ? revealNode(node) : { ok: false, reason: 'stale_element' }
  }
  const revealFunction = reference => {
    if (!reference || reference.url !== location.href) return { ok: false, reason: 'target_changed' }
    const region = regionMounts.get(reference.mountId)
    const entry = entryMounts.get(reference.mountId)
    const nodes = region ? [...region.panels] : [...(entry?.attached.values() ?? [])].map(item => item.button)
    const node = nodes.find(candidate => candidate.isConnected && visible(candidate))
    return node ? revealNode(node) : { ok: false, reason: 'function_view_unavailable' }
  }

  globalThis.__dshBrowserAssistant = Object.freeze({ snapshot, prepare, execute, inspect, reveal, revealFunction,
    entryInspect, entryMount, entryUnmount, releaseEntries, releaseInstallation, pageMap, regionRender, regionClear,
    documentToken: () => documentToken, startExternal, externalNode, issueExternal, completeExternal,
    guardExternal: request => {
      const record = externalRecord(request)
      if (!record || record.receipt || !record.external.issued || record.external.cancelled || Date.now() >= request.deadline) return { ready: false, reason: 'cancelled' }
      const { action, node, prepared } = record.external
      if (action.element && (staleElement(action) !== node || disabledControl(node) || !visible(node))) return { ready: false, reason: 'stale_element' }
      try { if (pageState(action, node) !== prepared.state) return { ready: false, reason: 'stale_preparation' } }
      catch { return { ready: false, reason: 'stale_preparation' } }
      if (['fill', 'press'].includes(action.kind) && (action.kind === 'fill' && !editable(node)
        || node.getRootNode().activeElement !== node)) return { ready: false, reason: 'input_focus_changed' }
      return { ready: true }
    },
    externalChanged: request => {
      const record = externalRecord(request)
      return record?.external.issued && record.external.before !== effectState(record.external.node)
    } })
})()

(() => {
  if (globalThis.__dshBrowserDomTree) return

  const RETENTION_MS = 60_000
  const MAX_SNAPSHOTS = 8
  const DEFAULT_LIMIT = 256
  const MAX_LIMIT = 1_000
  const PAGE_BYTES = 100 * 1024
  const MAX_TREE_NODES = 200_000
  const MAX_TREE_BYTES = 16 * 1024 * 1024
  const MAX_TEXT_LENGTH = 4_096
  const snapshots = new Map()
  let serial = 0

  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength
  const id = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++serial}`}`
  const cleanText = value => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, MAX_TEXT_LENGTH)
  const limitOf = value => Number.isSafeInteger(value) ? Math.min(MAX_LIMIT, Math.max(1, value)) : DEFAULT_LIMIT
  const hiddenSelf = node => {
    if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true') return true
    const style = globalThis.getComputedStyle?.(node)
    return style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.opacity === '0'
  }
  const sensitiveElement = node => node.matches('input, textarea, select, option, [contenteditable]:not([contenteditable="false"])')
  const suppressedElement = node => node.matches('script, style, template')
  const critical = node => ({
    tag: node.localName,
    id: node.getAttribute('id'),
    name: node.getAttribute('name'),
    type: node.getAttribute('type'),
    role: node.getAttribute('role'),
    label: node.getAttribute('aria-label'),
    href: node.getAttribute('href'),
    src: node.localName === 'iframe' ? node.getAttribute('src') : null,
    disabled: node.disabled === true || node.getAttribute('aria-disabled') === 'true',
    readOnly: node.readOnly === true || node.getAttribute('aria-readonly') === 'true',
    text: ['a', 'button', 'summary'].includes(node.localName) ? cleanText(node.textContent).slice(0, 500) : null,
  })
  const prune = () => {
    const now = Date.now()
    for (const [snapshotId, snapshot] of snapshots) if (snapshot.expiresAt <= now) snapshots.delete(snapshotId)
    while (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value)
  }

  const appendNode = (tree, nodes, node, parentIndex, hidden, suppressText, snapshotId) => {
    if (tree.length >= MAX_TREE_NODES) throw new Error(`DOM tree exceeds the ${MAX_TREE_NODES} node snapshot safety limit`)
    const index = tree.length
    let entry
    if (node.nodeType === Node.DOCUMENT_NODE) {
      entry = { index, parentIndex, kind: 'document' }
    } else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && node.host) {
      entry = { index, parentIndex, kind: 'openShadowRoot' }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.localName
      entry = { index, parentIndex, kind: 'element', tag, hidden: hidden || undefined,
        role: hidden ? undefined : node.getAttribute('role') || undefined,
        label: hidden ? undefined : (tag === 'iframe' ? node.getAttribute('src') : node.getAttribute('aria-label')) || undefined,
        elementId: `element-${snapshotId}-${index}` }
      nodes.set(entry.elementId, { node, critical: critical(node) })
    } else {
      entry = { index, parentIndex, kind: 'text', text: hidden || suppressText ? undefined : cleanText(node.nodeValue) || undefined }
    }
    if (bytes(entry) + tree._bytes > MAX_TREE_BYTES) throw new Error(`DOM tree exceeds the ${MAX_TREE_BYTES} byte snapshot safety limit`)
    tree._bytes += bytes(entry)
    tree.push(entry)
    return index
  }

  const build = () => {
    const snapshotId = id('dom-tree')
    const tree = []
    tree._bytes = 0
    const nodes = new Map()
    const stack = [{ node: document, parentIndex: null, hidden: false, suppressText: false }]
    while (stack.length) {
      const current = stack.pop()
      const node = current.node
      const isElement = node.nodeType === Node.ELEMENT_NODE
      const hidden = current.hidden || (isElement && hiddenSelf(node))
      const suppressText = current.suppressText || (isElement && (sensitiveElement(node) || suppressedElement(node)))
      const index = appendNode(tree, nodes, node, current.parentIndex, hidden, suppressText, snapshotId)
      const children = []
      if (node.nodeType === Node.DOCUMENT_NODE || isElement || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        for (const child of node.childNodes) {
          if ([Node.ELEMENT_NODE, Node.TEXT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(child.nodeType)) children.push(child)
        }
        if (isElement && node.shadowRoot?.mode === 'open') children.push(node.shadowRoot)
      }
      for (let childIndex = children.length - 1; childIndex >= 0; childIndex--) {
        const child = children[childIndex]
        const collapsed = isElement && node.localName === 'details' && !node.open
        const summary = child.nodeType === Node.ELEMENT_NODE && child.localName === 'summary'
        stack.push({ node: child, parentIndex: index, hidden: hidden || collapsed && !summary, suppressText })
      }
    }
    delete tree._bytes
    return { snapshotId, tree, nodes, expiresAt: Date.now() + RETENTION_MS, url: location.href, title: document.title }
  }

  const readCursor = cursor => {
    if (typeof cursor !== 'string') throw new Error('DOM tree cursor is required for a paged snapshot')
    const separator = cursor.lastIndexOf(':')
    const snapshotId = cursor.slice(0, separator)
    const offset = Number(cursor.slice(separator + 1))
    const snapshot = snapshots.get(snapshotId)
    if (!snapshot || !Number.isSafeInteger(offset) || offset < 0 || offset > snapshot.tree.length) {
      throw Object.assign(new Error('DOM tree cursor is expired or invalid'), { code: 'dom_tree_cursor_invalid' })
    }
    return { snapshot, offset }
  }

  const page = (snapshot, offset, limit) => {
    const tree = []
    let used = bytes({ snapshotId: snapshot.snapshotId, tree, treeCursor: null, treeComplete: false, url: snapshot.url, title: snapshot.title })
    let end = offset
    while (end < snapshot.tree.length && tree.length < limit) {
      const candidate = snapshot.tree[end]
      const candidateBytes = bytes(candidate)
      if (tree.length && used + candidateBytes > PAGE_BYTES) break
      tree.push(candidate)
      used += candidateBytes
      end++
    }
    if (end === offset && end < snapshot.tree.length) throw new Error('DOM tree node exceeds the page byte safety limit')
    const treeComplete = end === snapshot.tree.length
    return { snapshotId: snapshot.snapshotId, tree, treeCursor: treeComplete ? null : `${snapshot.snapshotId}:${end}`,
      treeComplete, url: snapshot.url, title: snapshot.title }
  }

  const snapshot = (options = {}) => {
    prune()
    const cursor = options.treeCursor
    const state = cursor === undefined ? { snapshot: build(), offset: 0 } : readCursor(cursor)
    if (!snapshots.has(state.snapshot.snapshotId)) {
      snapshots.set(state.snapshot.snapshotId, state.snapshot)
      prune()
    }
    return page(state.snapshot, state.offset, limitOf(options.treeLimit))
  }

  const getNode = (snapshotId, elementId) => {
    prune()
    const record = snapshots.get(snapshotId)?.nodes.get(elementId)
    return record?.node.isConnected && JSON.stringify(critical(record.node)) === JSON.stringify(record.critical) ? record.node : null
  }

  globalThis.__dshBrowserDomTree = { snapshot, getNode }
})()

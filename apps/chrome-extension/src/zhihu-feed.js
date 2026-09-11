;(() => {
  if (globalThis.__dshZhihuFeedInstalled) return
  globalThis.__dshZhihuFeedInstalled = true

  const style = document.createElement('style')
  style.textContent = '.dsh-zhihu-summary-entry{align-items:center;display:inline-flex;font:13px/1.7 system-ui,sans-serif;margin-left:auto;padding-left:14px}.dsh-zhihu-summary-entry a{color:#1772f6!important;cursor:pointer;text-decoration:none!important;white-space:nowrap}.dsh-zhihu-summary-entry a:hover{text-decoration:underline!important}.dsh-zhihu-summary-entry a[aria-disabled="true"]{opacity:.65;cursor:progress}'
  document.documentElement.append(style)
  const entries = new WeakMap()
  const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim()
  const source = card => {
    const heading = card.querySelector('.ContentItem-title, h2')
    if (!heading) return null
    const links = [...heading.querySelectorAll('a[href]')]
    if (heading.matches('a[href]')) links.unshift(heading)
    for (const link of links) {
      try {
        const url = new URL(link.href, location.href)
        const answer = url.origin === 'https://www.zhihu.com' && /^\/question\/\d+(?:\/answer\/\d+)?\/?$/u.test(url.pathname)
        const article = url.origin === 'https://zhuanlan.zhihu.com' && /^\/p\/\d+\/?$/u.test(url.pathname)
        if ((!answer && !article) || url.username || url.password) continue
        return { title: clean(heading.textContent).slice(0, 512), url: url.origin + url.pathname, heading }
      } catch { /* A non-content link does not prevent trying the other title links. */ }
    }
    return null
  }
  const expansion = card => [...card.querySelectorAll('button, a')].find(node => /^(阅读全文|展开全文)/u.test(clean(node.textContent)))
  const bodyOf = card => card.querySelector('.RichContent-inner, .RichText')
  const readBody = root => {
    let text = '', visited = 0, node = root
    const after = current => {
      while (current && current !== root) {
        if (current.nextSibling) return current.nextSibling
        current = current.parentNode
      }
      return null
    }
    while (node && visited++ < 10000 && text.length < 48000) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches('button,form,input,textarea,select,script,style,noscript,svg,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],.Comments-container,.ContentItem-actions,[data-dsh-actions]')) { node = after(node); continue }
        const css = getComputedStyle(node)
        if (css.display === 'none' || css.visibility === 'hidden') { node = after(node); continue }
        if (node.matches('p,div,br,li,blockquote,pre,h1,h2,h3,h4') && text && !text.endsWith('\n')) text += '\n'
      } else if (node.nodeType === Node.TEXT_NODE) {
        text += (node.nodeValue ?? '').replace(/\s+/gu, ' ')
      }
      node = node.firstChild ?? after(node)
    }
    return { text: text.slice(0, 48000).trim(), truncated: Boolean(node) || text.length > 48000 }
  }
  const expandAnswer = card => {
    const expand = expansion(card)
    if (!expand) return Promise.resolve()
    return new Promise(resolve => {
      let timer
      const finish = () => { clearTimeout(timer); observer.disconnect(); resolve() }
      const observer = new MutationObserver(() => {
        if (!card.isConnected || !expansion(card) && bodyOf(card)?.textContent?.trim()) finish()
      })
      observer.observe(card, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
      timer = setTimeout(finish, 8000)
      expand.click()
      if (!expansion(card) && bodyOf(card)?.textContent?.trim()) finish()
    })
  }
  const send = message => chrome.runtime.sendMessage(message)
  const label = (entry, text, busy = false) => {
    entry.link.textContent = text
    entry.link.setAttribute('aria-disabled', String(busy))
  }
  const summarize = async (card, entry, event) => {
    event.preventDefault(); event.stopPropagation()
    if (!event.isTrusted || entry.busy) return
    entry.busy = true
    const selected = source(card)
    if (!selected) { entry.busy = false; return }
    label(entry, '正在打开解读…', true)
    let submitted = false
    try {
      // Show the reading view inside the side panel, keeping this Zhihu tab in place.
      const opened = await send({ type: 'dsh-zhihu-open-assistant', url: selected.url })
      if (!opened?.ok) throw new Error(opened?.error ?? '无法打开解读页')
      if (['running', 'complete', 'unknown'].includes(opened.readingStatus)
        || entry.sentUrl === selected.url && opened.readingStatus !== 'error') { label(entry, '已发送 · 查看解读'); return }
      label(entry, '正在读取这条回答…', true)
      await expandAnswer(card)
      if (!card.isConnected || source(card)?.url !== selected.url) throw new Error('页面内容已变化，请重新点击')
      const body = bodyOf(card)
      if (!body) throw new Error('暂未读取到回答，请展开后再点')
      const captured = readBody(body)
      if (!captured.text) throw new Error('这条回答没有可读取的文字')
      const payload = { title: selected.title, url: selected.url,
        author: clean(card.querySelector('.AuthorInfo-name, [itemprop="author"]')?.textContent).slice(0, 256),
        text: captured.text, incomplete: Boolean(expansion(card) || card.querySelector('.RichContent.is-collapsed')),
        truncated: captured.truncated, imageCount: Math.min(body.querySelectorAll('img').length, 1000) }
      label(entry, '正在交给 AI 解读…', true)
      submitted = true
      const result = await send({ type: 'dsh-zhihu-summarize', payload })
      if (!result?.ok) {
        submitted = result?.uncertain === true
        throw new Error(result?.error ?? '发送未完成，请查看侧栏')
      }
      entry.sentUrl = selected.url
      label(entry, '已发送 · 查看解读')
    } catch (error) {
      if (submitted) entry.sentUrl = selected.url
      const message = String(error?.message ?? error)
      label(entry, submitted ? '发送待确认 · 请在侧栏查看' : /Extension context invalidated|Receiving end does not exist/u.test(message) ? '扩展已更新，请刷新知乎页面' : message)
    } finally { entry.busy = false }
  }
  const scan = () => {
    for (const card of document.querySelectorAll('.TopstoryItem')) {
      const selected = source(card)
      if (!selected) continue
      let entry = entries.get(card)
      if (entry?.row.isConnected) {
        if (!entry.busy && entry.url !== selected.url) {
          entry.url = selected.url; entry.sentUrl = null; entry.link.href = selected.url
          label(entry, '✦ AI 总结解读')
        }
        continue
      }
      const row = document.createElement('div')
      row.className = 'dsh-zhihu-summary-entry'; row.dataset.dshActions = 'zhihu-summary'
      const link = document.createElement('a')
      link.href = selected.url; link.textContent = '✦ AI 总结解读'
      link.setAttribute('aria-label', '用 AI 总结解读这条知乎内容')
      if (entry) {
        entry.row = row; entry.link = link
        label(entry, entry.busy ? '正在交给 AI 解读…' : entry.sentUrl === selected.url ? '已发送 · 查看解读' : '✦ AI 总结解读', entry.busy)
      } else entry = { row, link, url: selected.url, sentUrl: null, busy: false }
      entries.set(card, entry)
      link.addEventListener('click', event => { void summarize(card, entry, event) })
      row.append(link)
      const actions = card.querySelector('.ContentItem-actions, [data-dsh-actions="zhihu-actions"]')
      if (actions) actions.append(row)
      else card.append(row)
    }
  }
  let scheduled = false
  const observer = new MutationObserver(() => {
    if (scheduled) return
    scheduled = true
    setTimeout(() => { scheduled = false; scan() }, 150)
  })
  const observe = () => observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] })
  observe()
  scan()
  addEventListener('pagehide', () => observer.disconnect(), { once: true })
  addEventListener('pageshow', event => {
    if (event.persisted) { observe(); scan() }
  })
})()

;(() => {
  if (window.__dshCaptureInstalled) return
  window.__dshCaptureInstalled = true

  const skipped = new Set(['BUTTON', 'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'SCRIPT', 'STYLE', 'SVG'])
  const blockTags = new Set(['P', 'DIV', 'SECTION', 'ARTICLE'])
  const escapeText = value => value.replace(/([\\\[\]\(\)])/gu, '\\$1')
  const compactText = value => value.replace(/\s+/gu, ' ').trim()
  const safeHref = href => {
    try {
      const url = new URL(href, location.href)
      return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null
    } catch { return null }
  }
  const render = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.trim() ? escapeText(node.textContent) : ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const element = node
    if (element.hidden || element.getAttribute('aria-hidden') === 'true' || skipped.has(element.tagName)) return ''
    const content = Array.from(element.childNodes).map(render).join('').trim()
    if (!content) return ''
    if (/^H[1-6]$/u.test(element.tagName)) return `${'#'.repeat(Number(element.tagName.slice(1)))} ${content}\n\n`
    if (element.tagName === 'PRE') return `\`\`\`\n${element.textContent.trim()}\n\`\`\`\n\n`
    if (element.tagName === 'CODE') return `\`${element.textContent.trim()}\``
    if (element.tagName === 'A') { const href = safeHref(element.href); return href ? `[${content}](${href})` : content }
    if (element.tagName === 'LI') return `- ${content}\n`
    if (blockTags.has(element.tagName) || ['UL', 'OL', 'BLOCKQUOTE'].includes(element.tagName)) return `${content}\n\n`
    return content
  }
  const sanitizedUrl = raw => {
    const url = new URL(raw, location.href)
    url.username = ''; url.password = ''; url.search = ''; url.hash = ''
    return url.href
  }
  const source = (kind, url = location.href) => ({ url: sanitizedUrl(url), pageTitle: document.title, site: location.hostname, kind, capturedAt: new Date().toISOString() })
  const chatReply = target => target.closest?.('[data-message-author-role="assistant"]')
  const zhihuAnswer = target => target.closest?.('.AnswerItem, [data-za-detail-view-element_name="AnswerItem"], article[data-za-detail-view-element_name="AnswerItem"]')
  const chatComplete = reply => reply && !(
    reply.getAttribute('data-message-finished') === 'false' || reply.getAttribute('data-is-streaming') === 'true' || reply.getAttribute('aria-busy') === 'true' || reply.querySelector('[data-is-streaming="true"], [aria-busy="true"]')
  )
  const answerExpanded = answer => answer && !(answer.querySelector('.RichContent.is-collapsed, [data-dsh-collapsed="true"]') || Array.from(answer.querySelectorAll('button, a')).some(node => /展开全文|阅读全文/u.test(compactText(node.textContent ?? ''))))
  const answerUrl = answer => {
    const link = Array.from(answer.querySelectorAll('a[href]')).find(anchor => /\/question\/\d+\/answer\/\d+/u.test(anchor.getAttribute('href') ?? ''))
    return link ? safeHref(link.getAttribute('href') ?? '') : null
  }
  const answerAuthor = answer => compactText(answer.querySelector('.AuthorInfo-name, [data-za-detail-view-element_name="User"], [itemprop="author"]')?.textContent ?? '') || undefined
  const pageTitle = () => compactText(document.querySelector('h1')?.textContent ?? document.title.replace(/\s*[-|]\s*(ChatGPT|知乎).*$/iu, ''))
  const chatPayload = reply => {
    if (!chatComplete(reply)) return { error: '回复仍在生成，请结束后再收藏全文' }
    const markdown = Array.from(reply.childNodes).map(render).join('').replace(/\n{3,}/gu, '\n\n').trim()
    if (!markdown) return { error: '这条回复没有可采集的文本' }
    const externalMessageId = reply.getAttribute('data-message-id') || undefined
    return { title: pageTitle() || compactText(markdown).slice(0, 72), markdown, source: { ...source('single-reply'), ...(externalMessageId ? { externalMessageId } : {}) } }
  }
  const zhihuPayload = answer => {
    if (!answerExpanded(answer)) return { error: '回答尚未展开，请展开全文后再收藏' }
    const body = answer.querySelector('.RichContent-inner, .RichContent, [data-dsh-answer-body]')
    const url = answerUrl(answer)
    const markdown = body ? Array.from(body.childNodes).map(render).join('').replace(/\n{3,}/gu, '\n\n').trim() : ''
    if (!markdown || !url) return { error: '未能确认这条回答的正文或直达链接，请改用选中文字' }
    const author = answerAuthor(answer)
    const question = pageTitle()
    return { title: author ? `${question} · ${author}` : question || compactText(markdown).slice(0, 72), markdown, source: source('single-reply', url) }
  }
  const isZhihu = () => /(^|\.)zhihu\.com$/iu.test(location.hostname)
  const isChatGpt = () => /(^|\.)chatgpt\.com$/iu.test(location.hostname)
  const capturePayload = target => isZhihu() ? zhihuPayload(zhihuAnswer(target)) : chatPayload(chatReply(target))
  const sourceKey = target => isZhihu()
    ? answerUrl(zhihuAnswer(target)) ?? ''
    : chatReply(target)?.getAttribute('data-message-id') ?? ''
  // This is only compared for an already saved button. It is never sent or used to collect a new capture.
  const contentSignature = target => Array.from(target.childNodes).map(render).join('').replace(/\n{3,}/gu, '\n\n').trim()

  const style = document.createElement('style')
  style.textContent = '.dsh-capture-reply-mode [data-message-author-role="assistant"],.dsh-capture-reply-mode .AnswerItem{outline:2px solid #2d70d6!important;cursor:crosshair!important}.dsh-capture-quick{align-items:center;background:transparent;border:0;border-radius:6px;color:#16704a;cursor:pointer;display:inline-flex;font:500 12px/1.5 system-ui,sans-serif;gap:4px;margin-left:auto;padding:6px 8px}.dsh-capture-quick:hover{background:#e7f3ec}.dsh-capture-quick[disabled]{color:#777;cursor:default}.dsh-capture-quick[data-dsh-status="saved"]{background:#e7f3ec}.dsh-capture-quick[data-dsh-status="failed"]{color:#9b4a26}'
  document.documentElement.append(style)

  const actionContainer = (target, kind) => {
    const root = kind === 'zhihu' ? zhihuAnswer(target) : chatReply(target)
    if (!root) return null
    const known = kind === 'zhihu' ? root.querySelector('.ContentItem-actions, [data-dsh-actions]') : root.querySelector('[data-testid="message-actions"], [data-dsh-actions]')
    if (known) return known
    const sibling = root.nextElementSibling
    if (sibling?.matches?.('[data-testid="message-actions"], .ContentItem-actions')) return sibling
    return root
  }
  const setButtonState = (button, state, entryId) => {
    const text = state === 'saving' ? '保存中…'
      : state === 'saved' ? '✓ 已收藏 · 查看'
        : state === 'failed' ? '保存未完成 · 请打开 DSH 侧栏'
          : '展开后收藏'
    if (button.dataset.dshStatus !== state) button.dataset.dshStatus = state
    const disabled = state === 'saving' || state === 'unavailable'
    if (button.disabled !== disabled) button.disabled = disabled
    if (button.textContent !== text) button.textContent = text
    if (state === 'saved' && button.dataset.dshEntryId !== (entryId ?? '')) button.dataset.dshEntryId = entryId ?? ''
    if (state === 'unavailable' && button.title !== '回答尚未展开，不能把摘要当作全文收藏') button.title = '回答尚未展开，不能把摘要当作全文收藏'
  }
  const setReady = button => {
    if (button.dataset.dshStatus) delete button.dataset.dshStatus
    if (button.disabled) button.disabled = false
    if (button.textContent !== '收藏到 DSH') button.textContent = '收藏到 DSH'
    if (button.title) button.title = ''
  }
  const setStreaming = button => {
    if (button.dataset.dshStatus !== 'unavailable') button.dataset.dshStatus = 'unavailable'
    if (!button.disabled) button.disabled = true
    if (button.textContent !== '回复生成中…') button.textContent = '回复生成中…'
    if (button.title !== '回复仍在生成，结束后才能收藏完整回复') button.title = '回复仍在生成，结束后才能收藏完整回复'
  }
  const send = (message, callback) => {
    try { chrome.runtime.sendMessage(message, response => callback(response, chrome.runtime.lastError)) } catch (error) { callback(null, error) }
  }
  const quickCapture = (target, button) => {
    if (button.dataset.dshStatus === 'saved') { send({ type: 'dsh-open-captured', entryId: button.dataset.dshEntryId }, () => {}); return }
    if (button.dataset.dshStatus === 'failed') return
    const payload = capturePayload(target)
    if (payload.error) { setButtonState(button, 'failed'); button.title = payload.error; return }
    setButtonState(button, 'saving')
    send({ type: 'dsh-quick-capture', payload }, (response, error) => {
      if (!target.isConnected || !button.isConnected) return
      if (error || !response?.ok || response.status !== 'saved') { setButtonState(button, 'failed'); button.title = response?.error ?? error?.message ?? '请打开 DSH 侧栏处理这份待保存内容'; return }
      setButtonState(button, 'saved', response.entryId)
      button.dataset.dshSourceKey = sourceKey(target)
      button.dataset.dshContentSignature = contentSignature(target)
    })
  }
  const installButton = (target, kind) => {
    const container = actionContainer(target, kind)
    if (!container) return
    const existing = container.querySelector(':scope > [data-dsh-quick-capture]')
    if (existing) {
      if (existing.dataset.dshStatus === 'saved' && (
        existing.dataset.dshSourceKey !== sourceKey(target) ||
        existing.dataset.dshContentSignature !== contentSignature(target)
      )) {
        delete existing.dataset.dshEntryId
        delete existing.dataset.dshSourceKey
        delete existing.dataset.dshContentSignature
        setReady(existing)
      }
      if (!['saving', 'saved', 'failed'].includes(existing.dataset.dshStatus ?? '')) {
        const ready = kind === 'zhihu' ? answerExpanded(target) : chatComplete(target)
        if (ready) setReady(existing)
        else if (kind === 'zhihu') setButtonState(existing, 'unavailable')
        else setStreaming(existing)
      }
      return
    }
    const button = document.createElement('button')
    button.type = 'button'; button.className = 'dsh-capture-quick'; button.dataset.dshQuickCapture = kind
    button.textContent = '收藏到 DSH'; button.setAttribute('aria-label', kind === 'zhihu' ? '收藏这条知乎回答到 DSH' : '收藏这条 ChatGPT 回复到 DSH')
    if (kind === 'zhihu' && !answerExpanded(target)) setButtonState(button, 'unavailable')
    if (kind === 'chatgpt' && !chatComplete(target)) setStreaming(button)
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); quickCapture(target, button) })
    container.append(button)
  }
  const installQuickActions = () => {
    if (isZhihu()) document.querySelectorAll('.AnswerItem, [data-za-detail-view-element_name="AnswerItem"], article[data-za-detail-view-element_name="AnswerItem"]').forEach(answer => installButton(answer, 'zhihu'))
    else if (isChatGpt()) document.querySelectorAll('[data-message-author-role="assistant"]').forEach(reply => installButton(reply, 'chatgpt'))
  }
  const observer = new MutationObserver(installQuickActions)
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-message-finished', 'data-is-streaming', 'aria-busy', 'class'],
  })
  installQuickActions()

  let activeRequestId = null
  const emit = payload => chrome.runtime.sendMessage({ type: 'dsh-capture-result', requestId: activeRequestId, payload })
  const selection = () => {
    const markdown = escapeText(window.getSelection()?.toString() ?? '').trim()
    emit(markdown ? { title: pageTitle(), markdown, source: source('selection') } : { error: '请先选中要采集的文字' })
  }
  const leaveReplyMode = () => {
    document.documentElement.classList.remove('dsh-capture-reply-mode')
    document.removeEventListener('click', chooseReply, true); document.removeEventListener('keydown', cancelReply, true)
  }
  const cancelReply = event => { if (event.key === 'Escape') leaveReplyMode() }
  const chooseReply = event => {
    const target = isZhihu() ? zhihuAnswer(event.target) : chatReply(event.target)
    if (!target) return
    event.preventDefault(); event.stopPropagation(); leaveReplyMode(); emit(capturePayload(target))
  }
  const replyMode = () => {
    const selector = isZhihu() ? '.AnswerItem, [data-za-detail-view-element_name="AnswerItem"], article[data-za-detail-view-element_name="AnswerItem"]' : '[data-message-author-role="assistant"]'
    if (!document.querySelector(selector)) return emit({ error: isZhihu() ? '当前页面没有可识别的知乎回答；请改用选中文字' : '当前页面没有可识别的 ChatGPT 回复；请改用选中文字' })
    document.documentElement.classList.add('dsh-capture-reply-mode')
    document.addEventListener('click', chooseReply, true); document.addEventListener('keydown', cancelReply, true)
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== 'dsh-capture-command') return
    activeRequestId = message.requestId
    if (message.action === 'selection') selection()
    if (message.action === 'single-reply') replyMode()
  })
})()

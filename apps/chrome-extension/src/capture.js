const SKIPPED_TAGS = new Set(['BUTTON', 'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'SCRIPT', 'STYLE', 'SVG'])
const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE'])

const escapeMarkdownText = value => value.replace(/([\\\[\]\(\)])/gu, '\\$1')

const safeHref = href => {
  try {
    const url = new URL(href, globalThis.location?.href ?? 'https://invalid.test')
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

const childrenToMarkdown = element => Array.from(element.childNodes).map(nodeToMarkdown).join('')

const nodeToMarkdown = node => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''
    return text.trim() ? escapeMarkdownText(text) : ''
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const element = /** @type {HTMLElement} */ (node)
  if (element.hidden || element.getAttribute('aria-hidden') === 'true' || SKIPPED_TAGS.has(element.tagName)) return ''
  const text = childrenToMarkdown(element).trim()
  if (!text) return ''
  if (/^H[1-6]$/u.test(element.tagName)) return `${'#'.repeat(Number(element.tagName.slice(1)))} ${text}\n\n`
  if (element.tagName === 'PRE') return `\`\`\`\n${element.textContent?.trim() ?? ''}\n\`\`\`\n\n`
  if (element.tagName === 'CODE') return `\`${element.textContent?.trim() ?? ''}\``
  if (element.tagName === 'A') {
    const href = safeHref(element.getAttribute('href') ?? '')
    return href ? `[${text}](${href})` : text
  }
  if (element.tagName === 'BLOCKQUOTE') return text.split('\n').filter(Boolean).map(line => `> ${line}`).join('\n') + '\n\n'
  if (element.tagName === 'LI') {
    const parent = element.parentElement
    const prefix = parent?.tagName === 'OL' ? `${Array.from(parent.children).indexOf(element) + 1}.` : '-'
    return `${prefix} ${text}\n`
  }
  if (element.tagName === 'UL' || element.tagName === 'OL') return `${text}\n`
  if (element.tagName === 'TR') {
    const cells = Array.from(element.querySelectorAll(':scope > th, :scope > td')).map(cell => childrenToMarkdown(cell).trim())
    return `| ${cells.join(' | ')} |\n`
  }
  if (element.tagName === 'TABLE') return `\n${text}\n`
  if (BLOCK_TAGS.has(element.tagName)) return `${text}\n\n`
  return text
}

/** Returns the currently explicit user selection as literal Markdown text. */
export const captureSelection = win => {
  const text = win.getSelection()?.toString() ?? ''
  const markdown = escapeMarkdownText(text).trim()
  return markdown ? { markdown, kind: 'selection' } : null
}

/** Self-contained for scripting.executeScript; captures only loaded, non-editable page prose. */
export const capturePageBody = () => {
  const maxChars = 48000, maxNodes = 10000
  const root = document.querySelector('main, [role="main"]') ?? document.querySelector('article') ?? document.body
  const skipped = new Set(['BUTTON', 'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT', 'NAV', 'ASIDE', 'FOOTER'])
  const blocks = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TR', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
  let text = '', visited = 0, textTruncated = false, incomplete = false
  const result = () => ({ url: location.href, title: document.title.slice(0, 512), text: text.trim(), textTruncated, incomplete })
  if (!root) return result()
  const hidden = element => {
    const style = getComputedStyle(element)
    return element.hidden || element.getAttribute('aria-hidden') === 'true' || style.display === 'none'
      || style.visibility === 'hidden' || style.visibility === 'collapse'
  }
  const excluded = element => {
    const unfinished = element.matches('[data-is-streaming="true"], [data-message-finished="false"], [aria-busy="true"], .RichContent.is-collapsed, [data-dsh-collapsed="true"], details:not([open])')
    if (unfinished) incomplete = true
    return unfinished || skipped.has(element.tagName)
      || element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false'
      || hidden(element) || element.matches('.Comments-container, .ContentItem-actions, [data-testid="message-actions"], [data-dsh-actions]')
  }
  for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (++visited >= maxNodes) { textTruncated = true; return result() }
    if (excluded(ancestor)) return result()
  }
  const after = current => {
    while (current && current !== root) {
      if (current.nextSibling) return current.nextSibling
      current = current.parentNode
    }
    return null
  }
  let node = root
  while (node && visited < maxNodes && text.length < maxChars) {
    visited += 1
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node
      if (excluded(element)) {
        node = after(node); continue
      }
      if (blocks.has(element.tagName) && text && !text.endsWith('\n')) text += '\n'
    } else if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? ''
      const remaining = maxChars - text.length
      if (value.length > remaining) textTruncated = true
      text += value.slice(0, remaining).replace(/\s+/gu, ' ')
    }
    node = node.firstChild ?? after(node)
  }
  if (node) textTruncated = true
  return result()
}

/** Converts one already-rendered ChatGPT assistant article without importing page HTML. */
export const captureChatGptReply = target => {
  const reply = target.closest?.('[data-message-author-role="assistant"]')
  if (!reply) return null
  const markdown = childrenToMarkdown(reply).replace(/\n{3,}/gu, '\n\n').trim()
  if (!markdown) return null
  const externalMessageId = reply.getAttribute('data-message-id') || undefined
  return { markdown, kind: 'single-reply', ...(externalMessageId ? { externalMessageId } : {}) }
}

/** A reply that is still changing cannot truthfully be saved as a complete reply. */
export const isChatGptReplyComplete = target => {
  const reply = target.closest?.('[data-message-author-role="assistant"]')
  if (!reply) return false
  return !(
    reply.getAttribute('data-message-finished') === 'false' ||
    reply.getAttribute('data-is-streaming') === 'true' ||
    reply.getAttribute('aria-busy') === 'true' ||
    reply.querySelector('[data-is-streaming="true"], [aria-busy="true"]')
  )
}

const zhihuAnswer = target => target.closest?.('.AnswerItem, [data-za-detail-view-element_name="AnswerItem"], article[data-za-detail-view-element_name="AnswerItem"]')

const zhihuAuthor = answer => {
  const author = answer.querySelector('.AuthorInfo-name, [data-za-detail-view-element_name="User"], [itemprop="author"]')
  return author?.textContent?.replace(/\s+/gu, ' ').trim() || undefined
}

const zhihuAnswerUrl = answer => {
  const link = Array.from(answer.querySelectorAll('a[href]')).find(anchor => /\/question\/\d+\/answer\/\d+/u.test(anchor.getAttribute('href') ?? ''))
  return link ? safeHref(link.getAttribute('href') ?? '') : null
}

/** Zhihu's collapsed answer is deliberately not treated as the whole answer. */
export const isZhihuAnswerExpanded = target => {
  const answer = zhihuAnswer(target)
  if (!answer) return false
  if (answer.querySelector('.RichContent.is-collapsed, [data-dsh-collapsed="true"]')) return false
  return !Array.from(answer.querySelectorAll('button, a')).some(node => /展开全文|阅读全文/u.test(node.textContent?.replace(/\s+/gu, '') ?? ''))
}

/** Converts exactly one expanded Zhihu answer, without neighboring answers or comments. */
export const captureZhihuAnswer = target => {
  const answer = zhihuAnswer(target)
  if (!answer || !isZhihuAnswerExpanded(answer)) return null
  const body = answer.querySelector('.RichContent-inner, .RichContent, [data-dsh-answer-body]')
  if (!body) return null
  const markdown = childrenToMarkdown(body).replace(/\n{3,}/gu, '\n\n').trim()
  const url = zhihuAnswerUrl(answer)
  if (!markdown || !url) return null
  const author = zhihuAuthor(answer)
  return { markdown, kind: 'single-reply', url, ...(author ? { author } : {}) }
}

/** Removes credential-bearing and unstable URL parts before the source is stored. */
export const sanitizeSourceUrl = raw => {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('只支持 HTTP 或 HTTPS 页面')
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return url.href
}

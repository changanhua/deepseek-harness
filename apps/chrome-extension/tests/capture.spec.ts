/** @vitest-environment jsdom */
import { describe, expect, test } from 'vitest'
import {
  captureSelection,
  captureChatGptReply,
  captureZhihuAnswer,
  isChatGptReplyComplete,
  isZhihuAnswerExpanded,
  sanitizeSourceUrl,
} from '../src/capture.js'

describe('浏览器采集', () => {
  test('把用户选区冻结为保留换行的安全 Markdown 文本', () => {
    document.body.innerHTML = '<main>第一行\n第二行 [不是链接](javascript:alert(1))</main>'
    const text = document.querySelector('main')!.firstChild!
    const range = document.createRange()
    range.selectNodeContents(text)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(captureSelection(window)).toEqual({
      markdown: '第一行\n第二行 \\[不是链接\\]\\(javascript:alert\\(1\\)\\)',
      kind: 'selection',
    })
  })

  test('只转换点中的 ChatGPT assistant 回复，忽略按钮和隐藏内容', () => {
    document.body.innerHTML = `
      <article data-message-author-role="assistant" data-message-id="msg_42">
        <h2>结论</h2><p>保留 <a href="https://example.test/doc">链接</a></p>
        <pre><code>const safe = true</code></pre>
        <button>复制</button><span aria-hidden="true">隐藏</span>
      </article>
      <article data-message-author-role="user"><p>不能采集我</p></article>`

    const reply = document.querySelector('[data-message-id="msg_42"]')!

    expect(captureChatGptReply(reply)).toEqual({
      markdown: '## 结论\n\n保留 [链接](https://example.test/doc)\n\n```\nconst safe = true\n```',
      kind: 'single-reply',
      externalMessageId: 'msg_42',
    })
  })

  test('保留 inline 元素两侧的文字空白，避免语句粘合', () => {
    document.body.innerHTML = '<article data-message-author-role="assistant"><p>保留 <a href="https://example.test/doc">链接</a> 与 <code>代码</code>。</p></article>'

    expect(captureChatGptReply(document.querySelector('article')!)).toMatchObject({
      markdown: '保留 [链接](https://example.test/doc) 与 `代码`。',
    })
  })

  test('拒绝非 assistant 回复和不安全链接', () => {
    document.body.innerHTML = '<article data-message-author-role="user"><a href="javascript:alert(1)">坏链接</a></article>'

    expect(captureChatGptReply(document.querySelector('article')!)).toBeNull()
  })

  test('流式 ChatGPT 回复不能当作完整回复收藏', () => {
    document.body.innerHTML = '<article data-message-author-role="assistant" data-message-finished="false"><p>还在生成</p></article>'

    expect(isChatGptReplyComplete(document.querySelector('article')!)).toBe(false)
  })

  test('只转换一条已展开的知乎回答，并取回答直达链接与作者', () => {
    document.body.innerHTML = `
      <article class="AnswerItem">
        <a class="AuthorInfo-name" href="https://www.zhihu.com/people/lin">林间笔记</a>
        <a href="https://www.zhihu.com/question/10001/answer/20002">回答链接</a>
        <div class="RichContent-inner"><p>只保留这条回答</p><p>不碰相邻评论</p></div>
        <div class="Comments-container">这不是正文</div>
      </article>
      <article class="AnswerItem"><div class="RichContent-inner">另一条回答</div></article>`

    const answer = document.querySelector('.AnswerItem')!
    expect(isZhihuAnswerExpanded(answer)).toBe(true)
    expect(captureZhihuAnswer(answer)).toEqual({
      markdown: '只保留这条回答\n\n不碰相邻评论',
      kind: 'single-reply',
      url: 'https://www.zhihu.com/question/10001/answer/20002',
      author: '林间笔记',
    })
  })

  test('拒绝折叠知乎回答的全文采集', () => {
    document.body.innerHTML = '<article class="AnswerItem"><div class="RichContent is-collapsed">摘要</div><button>展开阅读全文</button></article>'

    expect(isZhihuAnswerExpanded(document.querySelector('article')!)).toBe(false)
    expect(captureZhihuAnswer(document.querySelector('article')!)).toBeNull()
  })

  test('来源 URL 去掉凭证、查询和片段，但保留页面路径', () => {
    expect(sanitizeSourceUrl('https://name:secret@example.test/a/b?token=1#reply')).toBe('https://example.test/a/b')
  })
})

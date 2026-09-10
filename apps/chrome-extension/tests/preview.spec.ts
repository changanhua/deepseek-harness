/** @vitest-environment jsdom */
import { describe, expect, test } from 'vitest'
import { renderMarkdown } from '../src/preview.js'

describe('阅读预览', () => {
  test('把受支持的 Markdown 渲染为阅读 DOM', () => {
    const target = document.createElement('article')
    renderMarkdown(target, '## 标题\n\n一段 [资料](https://example.test) 与 `code` 和 **重点**。\n\n- 第一项\n- 第二项\n\n1. 有序项\n2. 下一项\n\n```\nconst answer = 42\n```')
    expect(target.querySelector('h2')?.textContent).toBe('标题')
    expect(target.querySelector('a')?.getAttribute('href')).toBe('https://example.test')
    expect(target.querySelectorAll('ul li')).toHaveLength(2)
    expect(target.querySelectorAll('ol li')).toHaveLength(2)
    expect(target.querySelector('strong')?.textContent).toBe('重点')
    expect(target.querySelector('pre')?.textContent).toContain('answer = 42')
  })

  test('永不把正文作为 HTML 解释', () => {
    const target = document.createElement('article')
    renderMarkdown(target, '<img src=x onerror=alert(1)>\n\n[坏链接](javascript:alert(1))')
    expect(target.querySelector('img')).toBeNull()
    expect(target.querySelector('a')).toBeNull()
    expect(target.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  test('把 Markdown 转义字符按正文显示', () => {
    const target = document.createElement('article')
    renderMarkdown(target, '\\[不是链接\\] \\*不是强调\\*')
    expect(target.textContent).toBe('[不是链接] *不是强调*')
  })
})

/** @vitest-environment jsdom */
import { afterEach, describe, expect, test } from 'vitest'
import { capturePageBody } from '../src/capture.js'

afterEach(() => { document.body.replaceChildren() })

describe('explicit page body extraction', () => {
  test('reads article structure while excluding navigation, editable values and hidden text', () => {
    document.body.innerHTML = '<nav>Unrelated navigation</nav><main><h1>Article heading</h1><p>First paragraph.</p>'
      + '<p>Second <strong>important</strong> paragraph.</p><input value="private input"><textarea>private draft</textarea>'
      + '<div contenteditable="true">private editor</div><p hidden>hidden fact</p><p style="display:none">css hidden fact</p>'
      + '<script>private script</script><aside>Unrelated aside</aside><footer>Unrelated footer</footer></main>'
    const result = capturePageBody()
    expect(result.text).toContain('Article heading')
    expect(result.text).toContain('First paragraph.')
    expect(result.text).toContain('Second important paragraph.')
    expect(result.text).not.toMatch(/private|hidden fact|Unrelated/u)
    expect(result).toMatchObject({ textTruncated: false, incomplete: false, url: location.href })
  })
  test('omits collapsed Zhihu bodies, live ChatGPT replies, and comment controls without expanding them', () => {
    document.body.innerHTML = '<main><article class="AnswerItem"><div class="RichContent-inner"><p>Expanded answer.</p></div>'
      + '<div class="Comments-container">private comment</div><div class="ContentItem-actions">Vote</div></article>'
      + '<article><div class="RichContent is-collapsed">Unexpanded complete body.</div></article>'
      + '<article data-message-author-role="assistant" data-is-streaming="true">Unfinished reply.</article></main>'
    const result = capturePageBody()
    expect(result.text).toContain('Expanded answer.')
    expect(result.text).not.toMatch(/private comment|Vote|Unexpanded|Unfinished/u)
    expect(result.incomplete).toBe(true)
    expect(document.querySelector('.is-collapsed')).not.toBeNull()
  })
  test('bounds text and traversal and remains serializable for isolated-world execution', () => {
    document.body.innerHTML = '<main><p>' + 'x'.repeat(60_000) + '</p></main>'
    const isolated = window.eval('(' + capturePageBody.toString() + ')') as typeof capturePageBody
    expect(isolated()).toMatchObject({ textTruncated: true })
    expect(isolated().text.length).toBeLessThanOrEqual(48_000)
    document.body.innerHTML = '<main>' + '<span></span>'.repeat(10_100) + '<p>Past traversal limit.</p></main>'
    expect(capturePageBody()).toMatchObject({ textTruncated: true })
    expect(capturePageBody().text).not.toContain('Past traversal limit.')
  })
  test('a main element inside an editable or hidden ancestor cannot bypass exclusion', () => {
    document.body.innerHTML = '<div contenteditable="true"><main>Unsubmitted private draft.</main></div>'
    expect(capturePageBody().text).toBe('')
    document.body.innerHTML = '<div hidden><main>Hidden private draft.</main></div>'
    expect(capturePageBody().text).toBe('')
  })
})

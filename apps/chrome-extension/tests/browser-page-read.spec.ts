/** @vitest-environment jsdom */
/** @vitest-environment-options {"url":"https://example.test/form"} */
import { afterEach, expect, test } from 'vitest'
import source from '../src/browser-page.js?raw'

interface ElementRead {
  label: string
  value?: string
  valueTruncated?: boolean
  valueRedacted?: boolean
}
interface PageRead {
  text: string
  textScope: string
  textTruncated: boolean
  elements: ElementRead[]
  structure?: unknown
  nextOffset: number | null
  elementsTruncated: boolean
}
type PageRuntime = { snapshot(options?: Record<string, unknown>): PageRead }
const runtime = globalThis as typeof globalThis & { __dshBrowserAssistant?: PageRuntime }
function install() {
  globalThis.eval(source)
  return runtime.__dshBrowserAssistant!
}
afterEach(() => { document.body.innerHTML = ''; delete runtime.__dshBrowserAssistant })

test('explicit form read returns current values with whitespace, including empty fields', () => {
  document.body.innerHTML = '<form><input aria-label="Title" value="Original"><textarea aria-label="Body">Old body</textarea><input aria-label="Empty"></form>'
  document.querySelector('input')!.value = '浏览器平台：子页面接续'
  document.querySelector('textarea')!.value = '  第一段\n\n- 第一项\n- 第二项  '
  const assistant = install()
  const before = assistant.snapshot()
  expect(JSON.stringify(before)).not.toContain('浏览器平台：子页面接续')
  expect(JSON.stringify(before)).not.toContain('第一段')
  expect(assistant.snapshot({ includeValues: true }).elements).toMatchObject([
    { label: 'Title', value: '浏览器平台：子页面接续', valueTruncated: false },
    { label: 'Body', value: '  第一段\n\n- 第一项\n- 第二项  ', valueTruncated: false },
    { label: 'Empty', value: '', valueTruncated: false },
  ])
})

test('explicit values still omit passwords, verification codes, payment fields and hidden controls', () => {
  document.body.innerHTML = '<input aria-label="Password" type="password" value="SECRET_PASSWORD">'
    + '<input aria-label="OTP" autocomplete="section-login one-time-code" value="SECRET_OTP">'
    + '<input aria-label="Card" autocomplete="cc-number" value="SECRET_CARD">'
    + '<input type="hidden" value="SECRET_HIDDEN"><textarea autocomplete="new-password">SECRET_NEW</textarea>'
  const assistant = install()
  const read = assistant.snapshot({ includeValues: true })
  expect(JSON.stringify(read)).not.toContain('SECRET_')
  expect(read.elements.filter(item => ['Password', 'OTP', 'Card'].includes(item.label)))
    .toMatchObject([{ valueRedacted: true }, { valueRedacted: true }, { valueRedacted: true }])
  expect(assistant.snapshot({ query: 'SECRET_OTP', includeValues: true }).elements).toEqual([])
})

test('value bounds mark incomplete field evidence and cap aggregate values', () => {
  document.body.innerHTML = Array.from({ length: 8 }, (_, i) => `<textarea aria-label="Field ${i}">${'中'.repeat(20_000)}</textarea>`).join('')
  const read = install().snapshot({ includeValues: true })
  expect(read.elements).toHaveLength(8)
  expect(read.elements.every(item => item.valueTruncated === true)).toBe(true)
  expect(read.elements[0].value?.length).toBeGreaterThan(0)
  expect(read.elements.reduce((sum, item) => sum + (item.value?.length ?? 0), 0)).toBeLessThanOrEqual(16_384)
})

test('query scopes text and structure to the returned controls, including their local form', () => {
  document.body.innerHTML = '<nav>Unrelated navigation</nav><main><article><h2>Unrelated README</h2><ul><li>Unrelated files</li></ul></article>'
    + '<section><h2>Create issue</h2><form><label>Issue title<input aria-label="Title"></label><p>Required field</p><button>Create</button></form></section></main>'
  const assistant = install()
  const read = assistant.snapshot({ query: 'Title', includeValues: true })
  expect(read).toMatchObject({ textScope: 'matched-controls', textTruncated: false })
  expect(read.text).toContain('Required field')
  expect(JSON.stringify(read)).not.toContain('Unrelated')
  expect(assistant.snapshot().textScope).toBe('page')
  expect(assistant.snapshot().text).toContain('Unrelated README')
  expect(assistant.snapshot({ query: 'no match' })).toMatchObject({ text: '', textScope: 'matched-controls', elements: [] })
  expect(assistant.snapshot({ query: 'Title', textLimit: 5, structure: false })).toMatchObject({ textTruncated: true })
  expect(assistant.snapshot({ query: 'Title', structure: false }).structure).toBeUndefined()
})

test('query pagination restricts evidence to the returned control page and open shadow roots', () => {
  document.body.innerHTML = '<article><h2>First</h2><button>Open</button></article><article><h2>Second</h2><button>Open</button></article><div id="host"></div>'
  const shadow = document.querySelector('#host')!.attachShadow({ mode: 'open' })
  shadow.innerHTML = '<form><h2>Shadow</h2><input aria-label="Title" value="Actual"></form>'
  const assistant = install()
  const first = assistant.snapshot({ query: 'open', limit: 1 })
  expect(first).toMatchObject({ textScope: 'matched-controls', nextOffset: 1, elementsTruncated: true })
  expect(first.text).toContain('First')
  expect(first.text).not.toContain('Second')
  const second = assistant.snapshot({ query: 'open', offset: 1, limit: 1 })
  expect(second.text).toContain('Second')
  expect(second.text).not.toContain('First')
  const shadowRead = assistant.snapshot({ query: 'Title', includeValues: true })
  expect(shadowRead.text).toContain('Shadow')
  expect(shadowRead.elements).toMatchObject([{ value: 'Actual', valueTruncated: false }])
})

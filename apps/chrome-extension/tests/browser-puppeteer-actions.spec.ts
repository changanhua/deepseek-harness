/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from 'vitest'
import { performPuppeteerAction } from '../src/browser-puppeteer-actions.js'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

test('a preflighted click does not wait again for a suspended viewport observer', async () => {
  const handle = { click: vi.fn(async () => { throw new Error('viewport observer suspended') }),
    clickablePoint: vi.fn(async () => ({ x: 120, y: 48 })) }
  const page = { mouse: { click: vi.fn() } }
  expect(await performPuppeteerAction({ action: { kind: 'click', element: { role: 'link' } }, handle, page, check: vi.fn() }))
    .toEqual({ input: 'click' })
  expect(page.mouse.click).toHaveBeenCalledWith(120, 48, {})
  expect(handle.click).not.toHaveBeenCalled()
})

test('a click rechecks authority after resolving the exact element point', async () => {
  let allowed = true
  const handle = { click: vi.fn(), clickablePoint: vi.fn(async () => { allowed = false; return { x: 120, y: 48 } }) }
  const page = { mouse: { click: vi.fn() } }
  await expect(performPuppeteerAction({ action: { kind: 'click', element: { role: 'link' } }, handle, page,
    check: () => { if (!allowed) throw new Error('authorization_changed') } })).rejects.toThrow('authorization_changed')
  expect(page.mouse.click).not.toHaveBeenCalled()
})

test.each([
  ['double_click', { count: 2 }],
  ['right_click', { button: 'right' }],
] as const)('preserves pointer options for %s after exact-node preflight', async (kind, expected) => {
  const handle = { clickablePoint: vi.fn(async () => ({ x: 5, y: 9 })) }
  const page = { mouse: { click: vi.fn() } }
  expect(await performPuppeteerAction({ action: { kind }, handle, page, check: vi.fn() })).toEqual({ input: kind })
  expect(page.mouse.click).toHaveBeenCalledWith(5, 9, expected)
})

test('check clicks the exact node only when its current checked state differs', async () => {
  let checked = false
  const handle = { evaluate: vi.fn(async () => checked), clickablePoint: vi.fn(async () => ({ x: 5, y: 9 })) }
  const page = { mouse: { click: vi.fn(async () => { checked = true }) } }
  const options = { action: { kind: 'check', checked: true }, handle, page, check: vi.fn() }
  expect(await performPuppeteerAction(options)).toEqual({ checked: true })
  expect(await performPuppeteerAction(options)).toEqual({ checked: true })
  expect(page.mouse.click).toHaveBeenCalledTimes(1)
})

test('page-bound opening creates a background tab and returns its complete browser-session reference', async () => {
  const created: unknown[] = []
  const chromeApi = { tabs: { create: async (options: unknown) => { created.push(options); return { id: 9, windowId: 3 } } } }
  const result = await performPuppeteerAction({ action: { kind: 'tab_open', url: 'https://example.test/child' },
    chromeApi, targetPage: { frameId: 0 }, check: () => {}, authorizeUrl: async () => {},
    getBrowserSessionId: async () => '123e4567-e89b-42d3-a456-426614174000' })
  expect(created).toEqual([{ url: 'https://example.test/child', active: false }])
  expect(result).toEqual({ opened: true, tab: { tabId: 9, windowId: 3, browserSessionId: '123e4567-e89b-42d3-a456-426614174000' } })
})

test('page-bound opening rechecks authorization after resolving its session identity', async () => {
  const created: unknown[] = []
  let allowed = true
  const chromeApi = { tabs: { create: async (options: unknown) => { created.push(options); return { id: 9, windowId: 3 } } } }
  await expect(performPuppeteerAction({ action: { kind: 'tab_open', url: 'https://example.test/child' },
    chromeApi, targetPage: { frameId: 0 }, check: () => { if (!allowed) throw new Error('authorization_changed') },
    authorizeUrl: async () => {}, getBrowserSessionId: async () => { allowed = false; return '123e4567-e89b-42d3-a456-426614174000' } }))
    .rejects.toThrow('authorization_changed')
  expect(created).toEqual([])
})

test('click on a generic pointer row targets its sole visible heading instead of blank row center', async () => {
  document.body.innerHTML = '<div id="row" style="cursor:pointer"><h1 id="title">挪威对葡萄牙</h1><div>开始挑战</div></div>'
  const row = document.querySelector<HTMLElement>('#row')!
  const heading = document.querySelector<HTMLElement>('#title')!
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 200, left: 100, top: 200, right: 900, bottom: 300,
    width: 800, height: 100, toJSON: () => {} })
  vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue({ x: 220, y: 215, left: 220, top: 215, right: 520, bottom: 245,
    width: 300, height: 30, toJSON: () => {} })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => heading) })
  const handle = { evaluate: vi.fn(async (fn: (node: HTMLElement) => unknown) => fn(row)), click: vi.fn(),
    clickablePoint: vi.fn(async () => ({ x: 370, y: 230 })) }
  const page = { mouse: { click: vi.fn() } }

  expect(await performPuppeteerAction({ action: { kind: 'click', element: { role: 'generic' } }, handle, page, check: vi.fn() }))
    .toEqual({ input: 'click' })

  expect(handle.clickablePoint).toHaveBeenCalledWith({ x: 270, y: 30 })
  expect(page.mouse.click).toHaveBeenCalledWith(370, 230, {})
  expect(handle.click).not.toHaveBeenCalled()
})

test('ordinary buttons use the clickable point of their exact node', async () => {
  const handle = { evaluate: vi.fn(), click: vi.fn(), clickablePoint: vi.fn(async () => ({ x: 20, y: 30 })) }
  const page = { mouse: { click: vi.fn() } }

  expect(await performPuppeteerAction({ action: { kind: 'click', element: { role: 'button' } }, handle, page, check: vi.fn() }))
    .toEqual({ input: 'click' })

  expect(handle.clickablePoint).toHaveBeenCalledWith(undefined)
  expect(handle.click).not.toHaveBeenCalled()
  expect(handle.evaluate).not.toHaveBeenCalled()
  expect(page.mouse.click).toHaveBeenCalledWith(20, 30, {})
})

test('ambiguous or obscured headings do not redirect a generic click', async () => {
  document.body.innerHTML = '<div id="row" style="cursor:pointer"><h1>First</h1><h2>Second</h2></div>'
  const row = document.querySelector<HTMLElement>('#row')!
  const handle = { evaluate: vi.fn(async (fn: (node: HTMLElement) => unknown) => fn(row)), click: vi.fn(),
    clickablePoint: vi.fn(async () => ({ x: 50, y: 15 })) }
  const page = { mouse: { click: vi.fn() } }
  const action = { kind: 'click', element: { role: 'generic' } }

  await performPuppeteerAction({ action, handle, page, check: vi.fn() })
  expect(page.mouse.click).toHaveBeenCalledWith(50, 15, {})
  expect(handle.click).not.toHaveBeenCalled()

  row.querySelector('h2')!.remove()
  const heading = row.querySelector('h1')!
  vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 30,
    width: 100, height: 30, toJSON: () => {} })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => row) })
  page.mouse.click.mockClear()

  await performPuppeteerAction({ action, handle, page, check: vi.fn() })
  expect(page.mouse.click).toHaveBeenCalledWith(50, 15, {})
  expect(handle.click).not.toHaveBeenCalled()
})

test('a pointer card with a favorite button refuses center-click when its heading is obscured', async () => {
  document.body.innerHTML = '<div id="card" style="cursor:pointer"><button id="favorite">★</button><h1>重大比赛</h1></div>'
  const card = document.querySelector<HTMLElement>('#card')!
  const heading = card.querySelector('h1')!
  const favorite = card.querySelector<HTMLElement>('#favorite')!
  vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 30,
    width: 100, height: 30, toJSON: () => {} })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true,
    value: vi.fn((): HTMLElement => favorite) })
  const handle = { evaluate: vi.fn(async (fn: (node: HTMLElement) => unknown) => fn(card)), click: vi.fn() }
  const page = { mouse: { click: vi.fn() } }

  await expect(performPuppeteerAction({ action: { kind: 'click', element: { role: 'generic' } },
    handle, page, check: vi.fn() })).rejects.toMatchObject({ code: 'ambiguous_click_target' })
  expect(handle.click).not.toHaveBeenCalled()
  expect(page.mouse.click).not.toHaveBeenCalled()
})

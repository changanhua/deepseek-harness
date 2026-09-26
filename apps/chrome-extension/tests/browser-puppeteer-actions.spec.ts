/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from 'vitest'
import { performPuppeteerAction } from '../src/browser-puppeteer-actions.js'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

test('click on a generic pointer row targets its sole visible heading instead of blank row center', async () => {
  document.body.innerHTML = '<div id="row" style="cursor:pointer"><h1 id="title">挪威对葡萄牙</h1><div>开始挑战</div></div>'
  const row = document.querySelector<HTMLElement>('#row')!
  const heading = document.querySelector<HTMLElement>('#title')!
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 200, left: 100, top: 200, right: 900, bottom: 300,
    width: 800, height: 100, toJSON: () => {} })
  vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue({ x: 220, y: 215, left: 220, top: 215, right: 520, bottom: 245,
    width: 300, height: 30, toJSON: () => {} })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => heading) })
  const handle = { evaluate: vi.fn(async (fn: (node: HTMLElement) => unknown) => fn(row)), click: vi.fn() }
  const page = { mouse: { click: vi.fn() } }

  expect(await performPuppeteerAction({ action: { kind: 'click', element: { role: 'generic' } }, handle, page, check: vi.fn() }))
    .toEqual({ input: 'click' })

  expect(handle.click).toHaveBeenCalledWith({ offset: { x: 270, y: 30 } })
  expect(page.mouse.click).not.toHaveBeenCalled()
})

test('ordinary buttons keep their exact-node Puppeteer click', async () => {
  const handle = { evaluate: vi.fn(), click: vi.fn() }
  const page = { mouse: { click: vi.fn() } }

  expect(await performPuppeteerAction({ action: { kind: 'click', element: { role: 'button' } }, handle, page, check: vi.fn() }))
    .toEqual({ input: 'click' })

  expect(handle.click).toHaveBeenCalledOnce()
  expect(handle.evaluate).not.toHaveBeenCalled()
  expect(page.mouse.click).not.toHaveBeenCalled()
})

test('ambiguous or obscured headings do not redirect a generic click', async () => {
  document.body.innerHTML = '<div id="row" style="cursor:pointer"><h1>First</h1><h2>Second</h2></div>'
  const row = document.querySelector<HTMLElement>('#row')!
  const handle = { evaluate: vi.fn(async (fn: (node: HTMLElement) => unknown) => fn(row)), click: vi.fn() }
  const page = { mouse: { click: vi.fn() } }
  const action = { kind: 'click', element: { role: 'generic' } }

  await performPuppeteerAction({ action, handle, page, check: vi.fn() })
  expect(handle.click).toHaveBeenCalledOnce()
  expect(page.mouse.click).not.toHaveBeenCalled()

  row.querySelector('h2')!.remove()
  const heading = row.querySelector('h1')!
  vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 30,
    width: 100, height: 30, toJSON: () => {} })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => row) })
  handle.click.mockClear()

  await performPuppeteerAction({ action, handle, page, check: vi.fn() })
  expect(handle.click).toHaveBeenCalledOnce()
  expect(page.mouse.click).not.toHaveBeenCalled()
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

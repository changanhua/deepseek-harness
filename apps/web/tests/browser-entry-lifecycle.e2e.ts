/** Real MV3 executor evidence; fixture automation does not claim model independence. */
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { developmentPage } from './fixtures/page-model/development.ts'

interface Identity { tabId: number; frameId: number; documentId: string; url: string }
interface Receipt { outcome: string; reason?: string; value?: Record<string, unknown> }
interface DriverScope {
  entryRun(payload: Record<string, unknown>, page?: Identity): Promise<Receipt>
  entryModule: { createBrowserExecutor(input: object): { execute(request: object, signal: AbortSignal): Promise<Receipt> } }
  chrome: { tabs: { query(value: object): Promise<Array<{ id: number; url: string }>> } }
}
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(developmentPage(request.url?.startsWith('/hn') ? 'hn' : 'lobsters', true))
})
let context: BrowserContext, panel: Page, page: Page, worker: Worker, directory: string, base: string

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-entry-lifecycle-'))
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing fixture port')
  base = `http://127.0.0.1:${address.port}`
  const extension = resolve('apps/chrome-extension')
  context = await chromium.launchPersistentContext(join(directory, 'chrome'), {
    channel: 'chromium', headless: true,
    ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  })
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  await worker.evaluate(`globalThis.entryClicks = []; chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'dsh-entry-click') globalThis.entryClicks.push(message);
  })`)
  panel = await context.newPage()
  await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidebar.html`)
  await panel.evaluate('import(chrome.runtime.getURL("src/browser-executor.js")).then(module => { globalThis.entryModule = module })')
  await panel.evaluate(async (origin) => {
    const scope = globalThis as unknown as DriverScope
    const module = scope.entryModule
    const grant = { installationId: 'entry-fixture', grantEpoch: 1, scopes: ['browser:read', 'browser:write'], origins: [origin] }
    const executor = module.createBrowserExecutor({ chromeApi: scope.chrome, getGrant: () => grant, getEngine: () => 'dom' })
    let sequence = 0
    scope.entryRun = (payload, target) => executor.execute({ protocolVersion: 1, ...grant, sessionId: 'entry-session',
      requestId: `entry-${++sequence}`, fingerprint: `entry-${sequence}`, deadline: Date.now() + 15_000,
      mutates: !['snapshot', 'entry_inspect'].includes(String(payload.kind)), payload,
      ...(target ? { target: { tabId: target.tabId, frameId: target.frameId, documentId: target.documentId } } : {}),
    }, new AbortController().signal)
  }, base)
  page = await context.newPage()
})
afterAll(async () => {
  await context?.close()
  await new Promise<void>(done => server.close(() => done()))
  if (directory) await rm(directory, { recursive: true, force: true })
})

async function snapshot(): Promise<Identity> {
  return panel.evaluate(async (url) => {
    const scope = globalThis as unknown as DriverScope
    const tab = (await scope.chrome.tabs.query({})).find(tab => tab.url === url)
    if (!tab) throw new Error('fixture tab missing')
    const result = await scope.entryRun({ kind: 'snapshot', tabId: tab.id, frameId: 0, tree: true })
    if (result.outcome !== 'observed') throw new Error(JSON.stringify(result))
    return result.value!.page as unknown as Identity
  }, page.url())
}
function run(kind: string, identity: Identity, binding: Record<string, unknown> = {}) {
  return panel.evaluate(({ kind, identity, binding }) => (globalThis as unknown as DriverScope)
    .entryRun({ kind, page: identity, ...binding }, identity), { kind, identity, binding })
}

it.each(['hn', 'lobsters'] as const)('observes, collects, restores and cleans %s entries including new and reused nodes', async (site) => {
  await page.goto(`${base}/${site}`)
  const identity = await snapshot()
  const binding = { regionSelector: '#feed', selector: site === 'hn' ? ':scope > tbody > tr.athing' : ':scope > li.story',
    titleSelector: site === 'hn' ? '.titleline > a' : 'h2 > a', linkSelector: 'a[href]', mountId: `collect-${site}`, label: 'Collect' }
  expect(await run('entry_mount', identity, binding)).toMatchObject({ reason: 'inspect_required' })
  expect(await run('entry_inspect', identity, binding)).toMatchObject({ value: { matched: 3, missingLink: 0, missingTitle: 0, duplicateLinks: 0 } })
  expect(await run('entry_mount', identity, binding)).toMatchObject({ outcome: 'observed', value: { mounted: 3 } })
  await expect.poll(() => page.locator('[data-dsh-entry-mount]').count()).toBe(3)
  expect(await page.locator('aside [data-dsh-entry-mount]').count()).toBe(0)
  await page.locator('[data-dsh-entry-mount]').first().click()
  await expect.poll(() => worker.evaluate('globalThis.entryClicks.length')).toBeGreaterThan(0)
  const events = await worker.evaluate('globalThis.entryClicks') as Array<{ mountId: string; entry: { title: string; link: string } }>
  expect(events.find(event => event.mountId === binding.mountId)?.entry).toEqual({ title: 'Entry 1', link: `${base}/item?id=1` })
  expect(await run('entry_mount', identity, { ...binding, collected: [`${base}/item?id=1`] })).toMatchObject({ outcome: 'observed' })
  expect(await run('entry_unmount', identity, { mountId: binding.mountId })).toMatchObject({ value: { unmounted: true, remaining: 0 } })
  expect(await run('entry_mount', identity, binding)).toMatchObject({ reason: 'inspect_required' })
  await run('entry_inspect', identity, binding)
  await run('entry_mount', identity, binding)
  expect(await page.locator('[data-dsh-entry-mount]').first().isDisabled()).toBe(true)
  await page.evaluate(() => document.dispatchEvent(new Event('fixture:append')))
  await expect.poll(() => page.locator('[data-dsh-entry-mount]').count()).toBe(4)
  expect(await run('entry_mount', identity, binding)).toMatchObject({ reason: 'stale_binding' })
  await page.locator('#feed a').first().evaluate((link) => { link.setAttribute('href', '/reused'); link.textContent = 'Reused' })
  await expect.poll(() => page.locator('[data-dsh-entry-mount]').count()).toBe(3)
  await run('entry_inspect', identity, binding)
  await run('entry_mount', identity, binding)
  expect(await page.locator('[data-dsh-entry-mount]').first().isEnabled()).toBe(true)
  await page.locator('[data-dsh-entry-mount]').first().click()
  await expect.poll(async () => (await worker.evaluate('globalThis.entryClicks') as Array<{ entry: { title: string } }>).at(-1)?.entry.title).toBe('Reused')
  await page.locator(site === 'hn' ? '#feed tbody' : '#feed').evaluate((root) => { root.appendChild(root.firstElementChild!) })
  expect(await run('entry_mount', identity, binding)).toMatchObject({ reason: 'stale_binding' })
  await run('entry_inspect', identity, binding)
  expect(await run('entry_mount', identity, binding)).toMatchObject({ outcome: 'observed' })
  expect(await run('entry_unmount', identity, { mountId: binding.mountId, forgetCollected: true })).toMatchObject({ value: { remaining: 0 } })
  await expect.poll(() => page.locator('[data-dsh-entry-mount]').count()).toBe(0)
})

it('rejects ambiguous, outside, stale and invalid-field bindings and recovers from fresh observations', async () => {
  await page.goto(`${base}/lobsters`)
  const identity = await snapshot()
  const binding = { regionSelector: '#feed', selector: ':scope > li.story', titleSelector: 'h2 > a', linkSelector: 'a', mountId: 'refusals', label: 'Collect' }
  expect(await run('entry_inspect', identity, { ...binding, regionSelector: 'main, aside' })).toMatchObject({ reason: 'ambiguous_region' })
  expect(await run('entry_inspect', identity, { ...binding, selector: 'li.story' })).toMatchObject({ reason: 'binding_outside_region' })
  expect(await run('entry_inspect', identity, { ...binding, titleSelector: '.missing' })).toMatchObject({ value: { missingTitle: 3 } })
  await page.locator('#feed a').nth(1).evaluate(link => link.setAttribute('href', '/item?id=1'))
  expect(await run('entry_inspect', identity, binding)).toMatchObject({ value: { duplicateLinks: 1 } })
  await page.locator('#feed').evaluate((root) => { root.outerHTML = root.outerHTML })
  expect(await run('entry_mount', identity, binding)).toMatchObject({ reason: 'stale_binding' })
  await page.reload()
  expect((await run('entry_mount', identity, binding)).outcome).not.toBe('observed')
  const fresh = await snapshot()
  await page.locator('h2').evaluateAll(nodes => nodes.forEach((node) => { const title = document.createElement('h3'); title.innerHTML = node.innerHTML; node.replaceWith(title) }))
  expect(await run('entry_inspect', fresh, binding)).toMatchObject({ value: { missingTitle: 3 } })
  binding.titleSelector = 'h3 > a'
  await run('entry_inspect', fresh, binding)
  expect(await run('entry_mount', fresh, binding)).toMatchObject({ outcome: 'observed' })
  await run('entry_unmount', fresh, { mountId: binding.mountId })
  await page.goto(`${base}/hn`)
  expect((await run('entry_mount', fresh, binding)).outcome).not.toBe('observed')
})

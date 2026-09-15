import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

interface PageIdentity { tabId: number; frameId: number; documentId: string; url: string }
interface Receipt { outcome: string; reason?: string; value?: unknown }
interface ChromeScope {
  chrome: { tabs: { query(options: object): Promise<Array<{ id?: number; url?: string }>> } }
  run: (payload: Record<string, unknown>, page?: PageIdentity) => Promise<Receipt>
}

it('mounts dynamic entries once and rejects a mount bound to a replaced document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-entry-'))
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><title>Entry fixture</title><section id="feed"><article class="item"><a href="/one">One</a></article></section>')
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing server address')
  const base = `http://127.0.0.1:${address.port}`, extension = resolve('apps/chrome-extension')
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined
  try {
    context = await chromium.launchPersistentContext(join(root, 'chrome'), { channel: 'chromium', headless: true,
      ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    const panel = await context.newPage(); await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidebar.html`)
    const fixture = await context.newPage(); await fixture.goto(base + '/one')
    await panel.evaluate('import(chrome.runtime.getURL("src/browser-executor.js")).then(value => globalThis.executorModule = value)')
    const result = await panel.evaluate(async ({ base }) => {
      const scope = globalThis as typeof globalThis & ChromeScope & {
        executorModule: { createBrowserExecutor: (options: object) => unknown }
      }
      const tabs = await scope.chrome.tabs.query({})
      const tab = tabs.find(candidate => candidate.url?.startsWith(base + '/'))
      if (!tab?.id) throw new Error('fixture tab missing')
      const grant = { installationId: 'entry-fixture', grantEpoch: 1, scopes: ['browser:read', 'browser:write'], origins: [base] }
      const executor = scope.executorModule.createBrowserExecutor({ chromeApi: scope.chrome, getGrant: () => grant }) as {
        execute(request: object, signal: AbortSignal): Promise<Receipt>
      }
      let counter = 0
      const run = (payload: Record<string, unknown>, page?: PageIdentity) => executor.execute({ protocolVersion: 1, ...grant,
        requestId: `entry-${++counter}`, sessionId: 'entry-session', fingerprint: `entry-${counter}`, deadline: Date.now() + 15000,
        mutates: !['snapshot', 'wait', 'screenshot'].includes(String(payload.kind)), payload,
        ...(page ? { target: { tabId: page.tabId, frameId: page.frameId, documentId: page.documentId } } : {}),
      }, new AbortController().signal)
      scope.run = run
      const snapshot = await run({ kind: 'snapshot', tabId: tab.id, frameId: 0 })
      if (snapshot.outcome !== 'observed') throw new Error(`snapshot failed: ${JSON.stringify(snapshot)}`)
      const page = (snapshot.value as { page: PageIdentity }).page
      const mount = { kind: 'entry_mount', page, mountId: 'fixture', selector: '.item', label: 'Collect' }
      const first = await run(mount, page)
      const second = await run(mount, page)
      return { first, second, page }
    }, { base })
    expect(result.first).toMatchObject({ outcome: 'observed', value: { mounted: 1 } })
    expect(result.second).toMatchObject({ outcome: 'observed', value: { mounted: 1 } })
    expect(await fixture.locator('[data-dsh-entry-mount-id="fixture"]').count()).toBe(1)
    await fixture.evaluate(() => { const item = document.createElement('article'); item.className = 'item'; item.innerHTML = '<a href="/two">Two</a>'; document.querySelector('#feed')?.append(item) })
    await expect.poll(async () => fixture.locator('[data-dsh-entry-mount-id="fixture"]').count()).toBe(2)
    await fixture.goto(base + '/two')
    const rejected = await panel.evaluate(async (page) => {
      const scope = globalThis as typeof globalThis & ChromeScope
      return scope.run({ kind: 'entry_mount', page, mountId: 'old-document', selector: '.item', label: 'Old' }, page)
    }, result.page)
    expect(rejected.outcome).toBe('failed')
    expect(['stale_document', 'page_unavailable']).toContain(rejected.reason)
  } finally {
    await context?.close()
    await new Promise<void>(done => server.close(() => done()))
    await rm(root, { recursive: true, force: true })
  }
})

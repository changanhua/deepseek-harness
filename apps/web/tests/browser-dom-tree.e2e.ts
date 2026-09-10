import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

interface FixturePage { tabId: number; frameId: number; documentId: string; url: string }
interface TreeNode { index: number; tag?: string; elementId?: string }
interface TreeSnapshot {
  snapshotId: string
  tree: TreeNode[]
  treeCursor: string | null
  treeComplete: boolean
  page: FixturePage
}
interface Receipt { outcome: string; value?: unknown; reason?: string }
interface Executor { execute(request: object, signal: AbortSignal): Promise<Receipt> }
interface ExecutorModule { createBrowserExecutor(options: object): Executor }
interface ChromeFacade { tabs: { query(options: object): Promise<Array<{ id?: number; url?: string }>> } }

it('uses paged DOM-tree references from the loaded extension to prepare and click the tail node', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-dom-tree-'))
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><div id="items"></div><button id="tail">Tail action</button><script>
      document.querySelector('#items').innerHTML = Array.from({ length: 10250 }, (_, index) => '<span>node ' + index + '</span>').join('');
      document.querySelector('#tail').addEventListener('click', event => { event.currentTarget.textContent = 'Tail clicked'; document.body.dataset.tailClicked = 'yes' });
    </script>`)
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture server did not listen')
  const base = `http://127.0.0.1:${address.port}`
  const extension = resolve('apps/chrome-extension')
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined
  try {
    context = await chromium.launchPersistentContext(join(root, 'chrome'), {
      channel: 'chromium', headless: true,
      ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    const panel = await context.newPage()
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidebar.html`)
    const fixture = await context.newPage()
    await fixture.goto(base)
    await panel.evaluate('import(chrome.runtime.getURL("src/browser-executor.js")).then(module => { globalThis.domTreeExecutorModule = module })')
    const result = await panel.evaluate(async (baseUrl) => {
      const scope = globalThis as typeof globalThis & { chrome: ChromeFacade; domTreeExecutorModule?: ExecutorModule }
      const module = scope.domTreeExecutorModule
      if (!module) throw new Error('browser executor module did not load')
      const tab = (await scope.chrome.tabs.query({})).find(candidate => candidate.url === baseUrl + '/')
      if (!tab?.id) throw new Error('fixture tab missing')
      const grant = { installationId: 'dom-tree-fixture', grantEpoch: 1, origins: [baseUrl], scopes: ['browser:read', 'browser:write'] }
      const executor = module.createBrowserExecutor({ chromeApi: scope.chrome, getGrant: () => grant, getEngine: () => 'dom' })
      let serial = 0
      const request = (payload: object, page?: FixturePage) => ({
        protocolVersion: 1, ...grant, requestId: `dom-tree-${++serial}`, sessionId: 'dom-tree-session', fingerprint: `fingerprint-${serial}`,
        deadline: Date.now() + 30_000, mutates: !('kind' in payload) || !['snapshot', 'prepare'].includes(payload.kind as string), payload,
        ...(page ? { target: { tabId: page.tabId, frameId: page.frameId, documentId: page.documentId } } : {}),
      })
      const run = (payload: object, page?: FixturePage) => executor.execute(request(payload, page), new AbortController().signal)
      let response = await run({ kind: 'snapshot', tabId: tab.id, frameId: 0, tree: true, treeLimit: 1_000 })
      if (response.outcome !== 'observed') return { first: response }
      let snapshot = response.value as TreeSnapshot
      while (snapshot.treeCursor) {
        response = await run({ kind: 'snapshot', tabId: tab.id, frameId: 0, tree: true, treeCursor: snapshot.treeCursor, treeLimit: 1_000 })
        if (response.outcome !== 'observed') return { page: response }
        snapshot = response.value as TreeSnapshot
      }
      const tail = snapshot.tree.find(node => node.tag === 'button' && node.elementId)
      if (!tail?.elementId) return { tailMissing: snapshot }
      const action = { kind: 'click', intent: 'click tail node', element: { page: snapshot.page, snapshotId: snapshot.snapshotId, elementId: tail.elementId } }
      const prepared = await run({ kind: 'prepare', action }, snapshot.page)
      if (prepared.outcome !== 'observed') return { prepared }
      const preparationId = (prepared.value as { preparationId: string }).preparationId
      const committed = await run({ kind: 'commit', action, preparationId }, snapshot.page)
      return { treeComplete: snapshot.treeComplete, tailIndex: tail.index, committed }
    }, base)
    expect(result).toMatchObject({ treeComplete: true, committed: { outcome: 'observed' } })
    expect((result as { tailIndex: number }).tailIndex).toBeGreaterThan(10_000)
    expect(await fixture.locator('body').getAttribute('data-tail-clicked')).toBe('yes')
  } finally {
    await context?.close()
    await new Promise<void>(done => server.close(() => { done() }))
    await rm(root, { recursive: true, force: true })
  }
})

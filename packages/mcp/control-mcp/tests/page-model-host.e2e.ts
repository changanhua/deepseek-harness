/** Built Profile, real runner, real authorization, and MV3 entries; no model verdict. */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type BrowserContext } from 'playwright'
import { expect, it } from 'vitest'
import { startManagedDshHost, type ManagedHost } from '../src/lifecycle.ts'

/** Connection state the extension assistant reports through its service worker. */
interface AssistantConnection { phase: string; grant?: { installationId: string } }

/** Minimal service-worker surface this test drives from the extension panel page. */
interface AssistantWorker {
  runtime: { sendMessage(message: object): Promise<{ state: { connection: AssistantConnection } }> }
}

it('collects actual entry events through the built Host and confirms stop without losing results', { timeout: 120_000 }, async () => {
  const repository = resolve(import.meta.dirname, '../../../..')
  const root = await mkdtemp(join(homedir(), 'dsh-page-entry-host-'))
  const profile = join(root, 'host/profiles/web')
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<main><article><a href="/one">Entry One</a></article></main>')
  })
  let host: ManagedHost | undefined, browser: BrowserContext | undefined
  try {
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('fixture port missing')
    const fixtureUrl = `http://127.0.0.1:${address.port}/`
    await mkdir(profile, { recursive: true })
    const fixture = pathToFileURL(resolve(import.meta.dirname, 'fixtures/page-model-host.mjs')).href
    await writeFile(join(profile, 'cordis.patch.yml'), `- id: session-title-llm\n  disabled: true\n- insert:\n    - id: page-model-host-fixture\n      name: ${JSON.stringify(fixture)}\n`)
    host = await startManagedDshHost({ runId: 'page-model-host', hostHome: join(root, 'host'), cwd: repository,
      cliEntry: join(repository, 'apps/cli/lib/bin.js'), startupTimeoutMs: 60_000 })
    browser = await chromium.launchPersistentContext(join(root, 'chrome'), {
      channel: 'chromium', headless: true,
      ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH } : {}),
      args: [`--disable-extensions-except=${join(repository, 'apps/chrome-extension')}`, `--load-extension=${join(repository, 'apps/chrome-extension')}`],
    })
    const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker')
    const panel = await browser.newPage()
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidebar.html`)
    await browser.request.get(`${host.origin}/?token=${encodeURIComponent(host.token)}`)
    const rpc = async <T = Record<string, unknown>>(method: string, payload: object = {}): Promise<T> => {
      const response = await browser!.request.post(`${host!.origin}/page-model-fixture/${method}`, {
        data: { type: 'client-request', rpcId: randomUUID(), method, payload },
      })
      if (response.status() !== 200) throw new Error(`fixture RPC ${method}: HTTP ${response.status()} ${await response.text()}`)
      const reply = await response.json()
      if (!reply.result?.ok) throw new Error(JSON.stringify(reply))
      return reply.result.value as T
    }
    await panel.locator('#show-settings').click()
    await panel.locator('#base-url').fill(host.origin)
    const opening = browser.waitForEvent('page')
    await panel.locator('#save-settings').click()
    const approval = await opening
    await approval.getByRole('button', { name: '允许所选权限', exact: true }).click()
    await expect.poll(() => approval.locator('#status').textContent()).toContain('已授权')
    const connected = async () => panel.evaluate(async () => {
      const chrome = (globalThis as unknown as { chrome: AssistantWorker }).chrome
      const { state } = await chrome.runtime.sendMessage({ type: 'dsh-assistant-state' })
      return state.connection
    })
    await expect.poll(async () => (await connected()).phase, { timeout: 30_000 }).toBe('connected')
    await approval.close()
    const { sessionId } = await rpc<{ sessionId: string }>('open')
    const installationId = (await connected()).grant!.installationId
    const source = await browser.newPage()
    await source.goto(fixtureUrl)
    const tabs = await rpc<{ value: { tabs: Array<{ tabId:number;url:string }> } }>('browser', { installationId, action: { kind: 'tabs' } })
    const tabId = tabs.value.tabs.find(tab => tab.url === fixtureUrl)!.tabId
    const snapshot = await rpc<{ value:{ page:unknown } }>('browser', { installationId, action: { kind:'snapshot', tabId, frameId:0 } })
    const input = JSON.stringify({ installationId, page: snapshot.value.page, slot:'feed', regionSelector:'main', selector:':scope > article', titleSelector:'a', linkSelector:'a', label:'Collect' })
    const definition = await rpc<{ pluginId:string;packageId:string }>('define', { plugin:{ kind:'new',idPrefix:'entry' }, name:'Collection', purpose:'Verify entry events', code:{ host:`
      harness.state.set('collection', [])
      return {name:'entry-test', async apply(ctx) {
        const input = ${input}
        ctx.on('browser/entry-click', event => {
          if (event.sessionId === harness.sessionId && event.mountId === harness.pluginId + ':feed') harness.state.set('collection', [event.entry])
        })
        await harness.browser.inspect(input)
        await harness.browser.mount(input)
      }}
    ` } })
    expect(await rpc('run', definition)).toMatchObject({ ok:true })
    await expect.poll(() => source.locator('[data-dsh-entry-mount]').count()).toBe(1)
    await source.locator('[data-dsh-entry-mount]').click()
    const expected = [{ title:'Entry One', link:`${fixtureUrl}one` }]
    await expect.poll(async () => (await rpc<{ state:{ collection:unknown } }>('inspect', definition)).state.collection).toEqual(expected)
    expect(await rpc('stop', definition)).toEqual({ ok:true })
    expect(await source.locator('[data-dsh-entry-mount]').count()).toBe(0)
    expect((await rpc<{ state:{ collection:unknown } }>('inspect', definition)).state.collection).toEqual(expected)
    expect(sessionId).toBeTruthy()
  } finally {
    await browser?.close()
    await host?.stop()
    await new Promise<void>(done => server.close(() => done()))
    await rm(root, { recursive:true,force:true })
  }
})

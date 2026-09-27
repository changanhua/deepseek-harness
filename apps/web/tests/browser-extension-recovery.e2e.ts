import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { chromium, type BrowserContext } from 'playwright'
import { WebSocketServer } from 'ws'
import { expect, it } from 'vitest'

type RecoveryChrome = {
  runtime: { sendMessage: (message: { type: string }) => Promise<unknown> }
  storage: { local: {
    set: (record: Record<string, unknown>) => Promise<void>
    get: (key: string) => Promise<Record<string, unknown>>
  } }
}

it('a real Chrome navigation hook restores a paused saved channel without pairing or background polling', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-recovery-'))
  const extension = join(root, 'extension')
  let context: BrowserContext | undefined
  let available = false
  let probes = 0
  let paired = 0
  const hellos: Array<{ installationId: string; token: string }> = []
  const token = randomBytes(32).toString('base64url')
  const installationId = randomUUID()
  const server = createServer((req, res) => {
    if (req.method === 'HEAD') probes++
    if (req.method === 'POST') paired++
    res.writeHead(available ? 200 : 503, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>Recovery host ready</title>Ready')
  })
  const sockets = new WebSocketServer({ server })
  let grant: Record<string, unknown>
  sockets.on('connection', (socket) => {
    socket.on('message', (bytes) => {
      const frame = JSON.parse(bytes.toString())
      if (frame.type === 'hello') {
        if (!available || frame.installationId !== installationId || frame.token !== token) { socket.close(4401); return }
        hellos.push({ installationId: frame.installationId, token: frame.token })
        socket.send(JSON.stringify({ type: 'ready', protocolVersion: 1, grant }))
      } else if (frame.type === 'request') {
        socket.send(JSON.stringify({ type: 'response', requestId: frame.requestId,
          result: { ok: false, error: { code: 'fixture_read_unavailable' } } }))
      }
    })
  })
  const launch = () => chromium.launchPersistentContext(join(root, 'profile'), {
    channel: 'chromium', headless: true,
    ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  })
  try {
    await cp(resolve('apps/chrome-extension'), extension, { recursive: true })
    await new Promise<void>((done) => { server.listen(0, '127.0.0.1', done) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('fixture listener missing')
    const baseUrl = `http://127.0.0.1:${address.port}`
    context = await launch()
    const firstWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    const extensionId = new URL(firstWorker.url()).host
    const initialPanel = await context.newPage()
    await initialPanel.goto(`chrome-extension://${extensionId}/sidebar.html`)
    await initialPanel.evaluate(async () => (globalThis as typeof globalThis & { chrome: RecoveryChrome }).chrome.runtime.sendMessage({ type: 'dsh-assistant-state' }))
    grant = { installationId, extensionId, grantEpoch: 1, scopes: ['browser:read', 'browser:write'],
      origins: ['*'], createdAt: new Date().toISOString() }
    await firstWorker.evaluate(async (record) => {
      await (globalThis as typeof globalThis & { chrome: RecoveryChrome }).chrome.storage.local.set({ 'dsh.assistant.connection.v1': record })
    }, { baseUrl, installationId, token, grant, retryPaused: true })
    await context.close()
    context = await launch()
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    const panel = await context.newPage()
    await panel.goto(`chrome-extension://${extensionId}/sidebar.html`)
    const read = () => panel.evaluate(async () => (globalThis as typeof globalThis & { chrome: RecoveryChrome }).chrome.runtime.sendMessage({ type: 'dsh-assistant-state' }))
    await expect.poll(read, { timeout: 10_000 }).toMatchObject({ ok: true, state: { connection: { phase: 'offline' } } })
    const before = probes
    // Beyond the persisted event cooldown, no timer alone may trigger another probe.
    await new Promise(done => setTimeout(done, 11_000))
    expect(probes).toBe(before)
    expect(hellos).toHaveLength(0)
    available = true
    const hostPage = await context.newPage()
    await hostPage.goto(baseUrl)
    await expect.poll(read, { timeout: 10_000 }).toMatchObject({ ok: true, state: { connection: { phase: 'connected' } } })
    expect(hellos).toEqual([{ installationId, token }])
    expect(paired).toBe(0)
    const saved = await worker.evaluate(async () => (await (globalThis as typeof globalThis & { chrome: RecoveryChrome }).chrome.storage.local.get('dsh.assistant.connection.v1'))['dsh.assistant.connection.v1'])
    expect(saved).toMatchObject({ installationId, token, grant })
  } finally {
    await context?.close()
    for (const socket of sockets.clients) socket.terminate()
    await new Promise<void>((done) => { sockets.close(() => done()) })
    await new Promise<void>((done) => { server.close(() => done()) })
    const target = resolve(root)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('dsh-browser-recovery-')) throw new Error('unsafe recovery cleanup')
    await rm(target, { recursive: true, force: true })
  }
}, 90_000)

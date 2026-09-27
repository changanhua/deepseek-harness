/** Real MV3 worker and page identity, isolated from the user's Chrome installation. */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { chromium, type BrowserContext } from 'playwright'
import { expect, it } from 'vitest'
import { REPO_ROOT } from './support.ts'

it('captures the foreground document before a later tab switch', async () => {
  const parent = resolve(homedir())
  const root = await mkdtemp(join(parent, 'dsh-target-'))
  const extension = join(root, 'extension')
  let context: BrowserContext | undefined
  try {
    await cp(join(REPO_ROOT, 'apps/chrome-extension'), extension, { recursive: true })
    const parsed: unknown = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid extension manifest')
    const manifest = parsed as Record<string, unknown>
    manifest.host_permissions = ['<all_urls>']
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest))
    context = await chromium.launchPersistentContext(join(root, 'browser'), {
      channel: 'chromium', headless: true,
      ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH === undefined ? {} : { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH }),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 })
    const panel = await context.newPage()
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidebar.html`)
    const first = await context.newPage()
    await first.route('https://example.com/a', route => route.fulfill({ contentType: 'text/html', body: '<title>Page A</title><main>A</main>' }))
    await first.goto('https://example.com/a'); await first.bringToFront()
    const current = async (): Promise<{ tabId: number; documentId: string; url: string }> => {
      const reply: { ok: boolean; value?: { tabId: number; documentId: string; url: string } } =
        await panel.evaluate('chrome.runtime.sendMessage({type:"dsh-assistant-target-current"})')
      expect(reply.ok).toBe(true)
      expect(reply.value).toBeDefined()
      return reply.value!
    }
    const selected = await current()
    expect(selected.url).toBe(first.url())
    expect(selected.documentId).toBeTruthy()
    const second = await context.newPage()
    await second.route('https://example.com/b', route => route.fulfill({ contentType: 'text/html', body: '<title>Page B</title><main>B</main>' }))
    await second.goto('https://example.com/b'); await second.bringToFront()
    const later = await current()
    expect(later.url).toBe(second.url())
    expect(later.tabId).not.toBe(selected.tabId)
  } finally {
    await context?.close()
    const target = resolve(root)
    if (dirname(target) !== parent || !basename(target).startsWith('dsh-target-')) throw new Error('Refusing unexpected cleanup target')
    await rm(target, { recursive: true, force: true })
  }
}, 60_000)

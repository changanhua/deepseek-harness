import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

const source = resolve(import.meta.dirname, '../../chrome-extension/src/browser-page.js')
const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>球员列表</title>
<style>body{font:18px sans-serif}.space{height:1000px}.player{padding:20px;border:1px solid #ddd}</style></head><body>
<main><div class="space"></div><div class="players">
<div class="player" id="first"><a href="/player/1"><div><span>Kylian Mbappé</span></div></a>
<div class="meta"><div>ST</div><div>91</div></div></div>
<div class="player" id="second"><a href="/player/2"><div><span>Aitana Bonmatí</span></div></a>
<div class="meta"><div>CM</div><div>91</div></div></div></div><div class="space"></div></main></body></html>`

it('captures nested list cards as separate records and locates the exact original in Chromium', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
    await page.route('http://127.0.0.1:47656/list', route => route.fulfill({ body: html, contentType: 'text/html' }))
    await page.goto('http://127.0.0.1:47656/list')
    await page.addScriptTag({ path: source })
    const snapshot = await page.evaluate(() => {
      const assistant = (globalThis as typeof globalThis & { __dshBrowserAssistant?: {
        snapshot(options: object): { snapshotId: string; source: { contentBlocks: Array<{ blockId: string; kind: string; text: string }> } }
      } }).__dshBrowserAssistant
      return assistant?.snapshot({ textLimit: 0 })
    })
    expect(snapshot?.source.contentBlocks).toEqual([
      expect.objectContaining({ kind: 'record', text: 'Kylian Mbappé ST 91' }),
      expect.objectContaining({ kind: 'record', text: 'Aitana Bonmatí CM 91' }),
    ])
    const second = snapshot?.source.contentBlocks[1]
    if (!snapshot || !second) throw new Error('second source record is missing')
    const reference = { snapshotId: snapshot.snapshotId, blockId: second.blockId }
    const reveal = async () => page.evaluate((input) => {
      const assistant = (globalThis as typeof globalThis & { __dshBrowserAssistant?: {
        revealSource(reference: object): { ok: boolean; reason?: string; text?: string }
      } }).__dshBrowserAssistant
      return assistant?.revealSource({ ...input, url: location.href })
    }, reference)
    expect(await reveal()).toMatchObject({ ok: true, text: 'Aitana Bonmatí CM 91' })
    await expect.poll(async () => page.locator('#second').evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return bounds.top >= 0 && bounds.top < innerHeight
    })).toBe(true)
    await page.locator('#second .meta').evaluate((element) => { element.textContent = '评分已变化' })
    expect(await reveal()).toMatchObject({ ok: false, reason: 'source_changed' })
  } finally { await browser.close() }
})

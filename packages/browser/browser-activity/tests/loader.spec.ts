import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import BrowserActivity from '../src/index.ts'
import MockBrowser from '../../browser-monitor/tests/fixtures/mock-browser.ts'

const roots: Array<{ root: string; parent: string }> = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const { root, parent } of roots.splice(0)) {
    const target = resolve(root); const child = relative(resolve(parent), target)
    if (child.startsWith('..') || child.includes('/') || child.includes('\\') || !child.startsWith('dsh-browser-activity-')) {
      throw new Error('unsafe activity fixture cleanup')
    }
    await rm(target, { recursive: true, force: true })
  }
})

async function boot(root: string): Promise<Context> {
  const config = join(root, 'cordis.yml')
  await writeFile(config, [
    "- { name: '@deepseek-ai/dsh-storage' }",
    `- name: '@deepseek-ai/dsh-storage-json'\n  config: { root: ${JSON.stringify(join(root, 'storage'))} }`,
    `- name: '@deepseek-ai/dsh-storage-sqlite'\n  config: { path: ${JSON.stringify(join(root, 'activity', 'main', 'activity.sqlite'))}, journalMode: delete, ownership: exclusive, synchronous: full, privateDirectory: true }`,
    "- name: '@deepseek-ai/dsh-storage-domain'\n  config: { backend: sqlite }",
    "- name: '@fixture/browser'",
    "- name: '@changanhua/dsh-browser-activity'\n  config: { pruneIntervalMs: 100, maxInstallations: 2 }",
  ].join('\n'))
  const ctx = new Context(); contexts.push(ctx); ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage], ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-sqlite', StorageSqlite], ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@fixture/browser', MockBrowser], ['@changanhua/dsh-browser-activity', BrowserActivity],
  ])
  ctx.loader.internal = { version: 'v2', async import(name: string) {
    const module = modules.get(name); if (!module) throw new Error(`missing ${name}`); return module
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  await vi.waitFor(() => { expect(ctx.browserActivity.status().phase).toBe('ready') }, { timeout: 5000 })
  return ctx
}

it('loads opt-in activity through Loader and recovers one upload, its retry receipt, and a durable pause from SQLite', async () => {
  const parent = process.platform === 'win32' ? homedir() : tmpdir()
  const root = await mkdtemp(join(parent, 'dsh-browser-activity-')); roots.push({ root, parent })
  const installationId = '00000000-0000-4000-8000-000000000001'
  const first = await boot(root)
  expect(await first.browserActivity.state(installationId)).toMatchObject({ policy: null })
  const created = await first.browserActivity.configure(installationId, { requestId: randomUUID(), expectedRevision: null,
    settings: { enabled: true, sessionId: 'session', origins: ['https://example.test'], kinds: ['visit'],
      minIntervalMs: 1000, retentionDays: 1, maxEvents: 10, maxTextChars: 100 } })
  const input = { id: randomUUID(), revision: created.revision!, sequence: 1,
    events: [{ id: randomUUID(), kind: 'visit' as const, at: Date.now(), tabId: 1, url: 'https://example.test/page',
      title: 'Activity fixture', text: 'ACTIVITY_SQLITE_SENTINEL' }] }
  await first.browserActivity.append(installationId, input)
  await first.fiber.dispose(); contexts.splice(contexts.indexOf(first), 1)
  const reopened = await boot(root)
  expect(await reopened.browserActivity.append(installationId, input)).toEqual({ sequence: 1, accepted: 1 })
  const events = await reopened.browserActivity.query(installationId, { query: 'ACTIVITY_SQLITE_SENTINEL' })
  expect(events).toHaveLength(1); expect(events[0]?.id).toBe(input.events[0]!.id)
  const { revision: _revision, grantEpoch: _grantEpoch, ...settings } = created.policy!
  const paused = await reopened.browserActivity.configure(installationId, { requestId: randomUUID(), expectedRevision: created.revision,
    settings: { ...settings, enabled: false } })
  expect(paused.policy?.enabled).toBe(false)
  await reopened.fiber.dispose(); contexts.splice(contexts.indexOf(reopened), 1)
  const last = await boot(root)
  expect(await last.browserActivity.state(installationId)).toMatchObject({ revision: paused.revision, policy: { enabled: false } })
  await expect(last.browserActivity.append(installationId, input)).rejects.toThrow('activity_policy_changed')
}, 15000)

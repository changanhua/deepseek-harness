import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import LocalTaskQueue, { WorkQueueStore } from '@changanhua/dsh-task-queue-local'
import BrowserMonitor from '../src/index.ts'
import MockBrowser from './fixtures/mock-browser.ts'
import * as HoldTerminal from './fixtures/hold-terminal.ts'
import { createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'

const roots: Array<{ readonly root: string; readonly parent: string }> = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const entry of roots.splice(0).reverse()) {
    const target = resolve(entry.root)
    const child = relative(resolve(entry.parent), target)
    if (child.startsWith('..') || child.includes('/') || child.includes('\\')
      || !target.split(/[\\/]/u).at(-1)?.startsWith('dsh-browser-monitor-')) throw new Error('unsafe monitor fixture cleanup')
    await rm(target, { recursive: true, force: true })
  }
})

async function boot(root: string, holdTerminal = false): Promise<Context> {
  const config = join(root, 'cordis.yml')
  await writeFile(config, [
    "- { name: '@deepseek-ai/dsh-storage' }",
    `- name: '@deepseek-ai/dsh-storage-json'\n  config: { root: ${JSON.stringify(join(root, 'storage'))} }`,
    `- name: '@deepseek-ai/dsh-storage-sqlite'\n  config: { path: ${JSON.stringify(join(root, 'content', 'main', 'monitor.sqlite'))}, journalMode: delete, ownership: exclusive, synchronous: full, privateDirectory: true }`,
    "- name: '@deepseek-ai/dsh-storage-domain'\n  config: { backend: sqlite }",
    `- name: '@changanhua/dsh-task-queue-local'\n  config: { queueRoot: ${JSON.stringify(join(root, 'queue'))}, maxConcurrent: 1, resourceCapacity: {}, shutdownTimeoutMs: 100 }`,
    "- name: '@fixture/browser'",
    ...(holdTerminal ? ["- name: '@fixture/hold-terminal'"] : []),
    "- name: '@changanhua/dsh-browser-monitor'\n  config: { pollIntervalMs: 100, maxMonitors: 4, checkTimeoutMs: 1000 }",
  ].join('\n'))
  const ctx = new Context(); contexts.push(ctx); ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage], ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-sqlite', StorageSqlite], ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@changanhua/dsh-task-queue-local', LocalTaskQueue], ['@fixture/browser', MockBrowser],
    ['@changanhua/dsh-browser-monitor', BrowserMonitor],
    ['@fixture/hold-terminal', HoldTerminal],
  ])
  ctx.loader.internal = { version: 'v2', async import(name: string) { const module = modules.get(name); if (!module) throw new Error(`missing ${name}`); return module } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } }); await ctx.loader.await()
  await waitFor(() => ctx.browserMonitor.status().phase === 'ready')
  return ctx
}
async function waitFor(predicate: () => boolean): Promise<void> { const until = Date.now() + 5000; while (!predicate()) { if (Date.now() > until) throw new Error('timeout'); await new Promise(resolve => setTimeout(resolve, 25)) } }

describe('browser monitor Loader vertical', () => {
  it.each([null, 60000])('settles a saved result after an interrupted Queue terminal commit (%s)', async (intervalMs) => {
    const parent = process.platform === 'win32' ? homedir() : tmpdir()
    const root = await mkdtemp(join(parent, 'dsh-browser-monitor-')); roots.push({ root, parent })
    const first = await boot(root, true)
    const installationId = '00000000-0000-4000-8000-000000000001'
    await first.browserMonitor.create({ requestId: '00000000-0000-4000-8000-000000000003', sessionId: 'session',
      installationId, title: 'terminal recovery', url: 'https://example.test/page', intervalMs,
      missedPolicy: 'latest', match: { kind: 'changed' } })
    await waitFor(() => first.browserMonitor.list(installationId)[0]?.settlement?.workId != null)
    const saved = first.browserMonitor.list(installationId)[0]
    if (!saved?.settlement?.workId) throw new Error('missing settlement')
    const operator = first.taskQueue.forOperator(createVerifiedOperatorAuthority())
    expect(operator.list()[0]?.state.status).toBe('running')
    await first.fiber.dispose(); contexts.splice(contexts.indexOf(first), 1)
    const storedQueue = new WorkQueueStore(join(root, 'queue'))
    try {
      const projection = await storedQueue.open()
      expect([...projection.statesByWorkId.values()].map(state => state.status)).toEqual(['unknown'])
    } finally { await storedQueue.close() }
    const observe = vi.spyOn(MockBrowser.prototype, 'observe')
    try {
      const reopened = await boot(root)
      const recoveredQueue = reopened.taskQueue.forOperator(createVerifiedOperatorAuthority())
      await waitFor(() => recoveredQueue.list()[0]?.state.status === 'succeeded'
        && reopened.browserMonitor.list(installationId)[0]?.settlement === null)
      expect(observe).not.toHaveBeenCalled()
      const work = recoveredQueue.list()[0]
      expect(work?.attempts.map(attempt => attempt.status)).toEqual(['failed', 'succeeded'])
      expect(work?.result?.output).toMatchObject({ outcome: 'already-recorded' })
      expect(recoveredQueue.pendingAttentions().filter(attention => attention.kind === 'unknown')).toEqual([])
      expect(reopened.browserMonitor.list(installationId)[0]).toMatchObject({ lastSample: saved.lastSample, outbox: saved.outbox })
    } finally { observe.mockRestore() }
  }, 15000)

  it('runs a finite visible-page check, persists notice acknowledgement, and reopens the domain', async () => {
    const parent = process.platform === 'win32' ? homedir() : tmpdir()
    const root = await mkdtemp(join(parent, 'dsh-browser-monitor-')); roots.push({ root, parent })
    const first = await boot(root); const installationId = '00000000-0000-4000-8000-000000000001'
    expect(first.taskQueue.listKinds()).toContain('browser.monitor.check@1')
    const created = await first.browserMonitor.create({ requestId: '00000000-0000-4000-8000-000000000002', sessionId: 'session', installationId, title: 'one', url: 'https://example.test/page', intervalMs: null, missedPolicy: 'latest', match: { kind: 'changed' } })
    await waitFor(() => first.browserMonitor.list(installationId)[0]?.outbox.some(notice => notice.kind === 'completed') === true)
    const finished = first.browserMonitor.list(installationId)[0]
    const notice = finished?.outbox[0]
    if (!notice) throw new Error('missing completion notice')
    expect(finished?.outbox).toHaveLength(1)
    expect(JSON.stringify(finished)).not.toContain('PRIVATE_MONITOR_TEXT_SHOULD_NOT_PERSIST')
    await first.fiber.dispose(); contexts.splice(contexts.indexOf(first), 1)
    expect(first.get('taskQueue')).toBeUndefined()
    const reopened = await boot(root)
    const recovered = reopened.browserMonitor.list(installationId)[0]
    expect(reopened.taskQueue.listKinds()).toContain('browser.monitor.check@1')
    expect(recovered).toMatchObject({ id: created.id, enabled: false })
    expect(recovered?.outbox).toMatchObject([{ id: notice.id, kind: 'completed' }])
    expect(recovered?.outbox).toHaveLength(1)
    await reopened.browserMonitor.acknowledge(created.id, installationId, notice.id)
    await reopened.fiber.dispose(); contexts.splice(contexts.indexOf(reopened), 1)
    const acknowledged = await boot(root)
    expect(acknowledged.browserMonitor.list(installationId)[0]).toMatchObject({ id: created.id, enabled: false, outbox: [] })
  }, 15_000)
})

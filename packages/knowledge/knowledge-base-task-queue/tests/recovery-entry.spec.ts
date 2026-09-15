import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { KnowledgeRepository } from '@changanhua/dsh-knowledge-base'
import type { WorkView } from '@changanhua/dsh-task-queue'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

const repository = resolve(import.meta.dirname, '../../../..')
const fixture = join(import.meta.dirname, 'fixtures/recovery.mjs')
const built = existsSync(join(repository, 'apps/cli/lib/bin.js'))

interface Report { readonly workId: string; readonly stageId: string; readonly view: WorkView }
interface Invocation { readonly phase: string; readonly at: number }

describe.skipIf(!built)('knowledge Queue recovery through the built dsh profile', () => {
  const roots: string[] = []
  afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  })

  async function setup() {
    const root = await mkdtemp(join(tmpdir(), 'dsh-knowledge-recovery-'))
    roots.push(root)
    const profile = join(root, 'home/profiles/knowledge-recovery')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'knowledge-recovery-test', private: true,
      dsh: { profile: { bundles: [], patchReload: 'startup' } } }))
    return { root, profile }
  }

  async function run(root: string, profile: string, phase: string, stopAt?: string) {
    const plugin = (path: string) => pathToFileURL(join(repository, path)).href
    await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      { id: 'storage', name: plugin('packages/storage/storage/lib/index.js') },
      { id: 'storage-json', name: plugin('packages/storage/storage-json/lib/index.js'), config: { root: join(root, 'storage') } },
      { id: 'storage-domain', name: plugin('packages/storage/storage-domain/lib/index.js'), config: { backend: 'json' } },
      { id: 'subprocess', name: plugin('packages/subprocess/subprocess-local/lib/index.js') },
      { id: 'knowledge', name: plugin('packages/knowledge/knowledge-base/lib/index.js'), config: { root: join(root, 'content') } },
      { id: 'queue', name: plugin('packages/task-queue/task-queue-local/lib/index.js'), config: {
        queueRoot: join(root, 'queue'), maxConcurrent: 1, resourceCapacity: { 'knowledge-base': 1, codex: 1 },
      } },
      { id: 'recovery-fixture', name: pathToFileURL(fixture).href, config: { root, phase } },
    ] }]))
    const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'), mode: 'lib',
      configArgs: ['--profile', 'knowledge-recovery'], env: { DSH_HOME: join(root, 'home') } })
    const child = spawn(launch.command, launch.args, { cwd: repository, env: { ...process.env, ...launch.env },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let diagnostic = ''
    child.stdout.on('data', (chunk) => { diagnostic += String(chunk) })
    child.stderr.on('data', (chunk) => { diagnostic += String(chunk) })
    const ended = new Promise<number | null>((resolveExit, reject) => {
      child.on('error', reject)
      child.on('exit', resolveExit)
    })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 20_000)
    try {
      if (stopAt !== undefined) {
        for (let n = 0; n < 1_500 && !existsSync(join(root, stopAt)) && child.exitCode === null; n++) await sleep(10)
        expect(existsSync(join(root, stopAt)), diagnostic).toBe(true)
        child.kill('SIGKILL')
      }
      const code = await ended
      if (stopAt === undefined) expect(code, diagnostic).toBe(0)
    } finally {
      clearTimeout(timeout)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await ended
    }
  }

  async function report(root: string, phase: string): Promise<Report> {
    return JSON.parse(await readFile(join(root, `${phase}.json`), 'utf8')) as Report
  }
  async function invocations(root: string): Promise<Invocation[]> {
    return (await readFile(join(root, 'invocations.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Invocation)
  }
  async function reopen(root: string) {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const backend = new JsonStorageBackend(join(root, 'storage'))
    ctx.storage.backend.register('json', backend)
    const facility = new DomainFacility(ctx, { backend: 'json' })
    const repo = await KnowledgeRepository.open(facility, join(root, 'content'))
    return { repo, async close() { await repo.close(); await backend.close(); await ctx.fiber.dispose() } }
  }
  async function journal(root: string) {
    return (await readFile(join(root, 'queue/active.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { events: { type: string }[] })
  }

  it('keeps a killed in-flight model call unknown and does not start it again', async () => {
    const { root, profile } = await setup()
    await run(root, profile, 'model-window', 'windows/model-started')
    await run(root, profile, 'inspect-model')
    const recovered = await report(root, 'inspect-model')
    expect(recovered.view.state.status).toBe('unknown')
    expect(recovered.view.attempts).toHaveLength(1)
    expect(await invocations(root)).toHaveLength(1)
    expect((await journal(root)).flatMap(change => change.events).filter(event => event.type === 'attempt/unknown')).toHaveLength(1)
  }, 45_000)

  for (const window of ['candidate-window', 'completed-window'] as const) {
    it(`recovers ${window} without another model call`, async () => {
      const { root, profile } = await setup()
      await run(root, profile, window, `windows/${window}`)
      await run(root, profile, `recover-${window}`)
      const recovered = await report(root, `recover-${window}`)
      expect(recovered.view.state.status).toBe('succeeded')
      expect(recovered.view.attempts).toHaveLength(2)
      expect(await invocations(root)).toHaveLength(1)
      const opened = await reopen(root)
      try {
        const stage = opened.repo.get('recovery-project').stages[recovered.stageId]!
        expect(stage.state).toBe('completed')
        expect(await opened.repo.files.readEntry('recovery-project', 'recovery-entry')).toContain('受控恢复测试')
      } finally {
        await opened.close()
      }
      const events = (await journal(root)).flatMap(change => change.events).map(event => event.type)
      expect(events).toContain('attempt/unknown')
      expect(events.filter(type => type === 'attempt/succeeded')).toHaveLength(1)
    }, 45_000)
  }
})

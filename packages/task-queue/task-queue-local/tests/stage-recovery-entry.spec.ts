import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import type { ChangeSet, WorkView } from '@changanhua/dsh-task-queue'

interface StageReport {
  research: string
  duplicate: string
  conflict: boolean
  draft: string
  works: WorkView[]
  wait: { kind: string; eligibleAt: string }
}
interface ExecutionRecord { stage: string; at: number; inputArtifact: string }

const repository = resolve(import.meta.dirname, '../../../..')
const fixture = join(import.meta.dirname, 'fixtures/stage-recovery.mjs')
const built = existsSync(join(repository, 'apps/cli/lib/bin.js'))

describe.skipIf(!built)('Queue stages through the built dsh profile', () => {
  const roots: string[] = []
  afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  })
  async function setup() {
    const root = await mkdtemp(join(tmpdir(), 'dsh-queue-stages-'))
    roots.push(root)
    const profile = join(root, 'home/profiles/queue-stages')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'queue-stages-test', private: true,
      dsh: { profile: { bundles: [], patchReload: 'startup' } } }))
    return { root, profile }
  }
  async function run(root: string, profile: string, phase: string, killWhen?: string) {
    await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      { id: 'queue', name: pathToFileURL(join(repository, 'packages/task-queue/task-queue-local/lib/index.js')).href,
        config: { queueRoot: join(root, 'queue'), maxConcurrent: 1 } },
      { id: 'stage-fixture', name: pathToFileURL(fixture).href, config: { root, phase } },
    ] }]))
    const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'), mode: 'lib',
      configArgs: ['--profile', 'queue-stages'], env: { DSH_HOME: join(root, 'home') } })
    const child = spawn(launch.command, launch.args, { cwd: repository, env: { ...process.env, ...launch.env },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let diagnostic = ''
    child.stdout.on('data', (chunk) => { diagnostic += String(chunk) })
    child.stderr.on('data', (chunk) => { diagnostic += String(chunk) })
    const ended = new Promise<number | null>((resolveExit, reject) => {
      child.on('error', reject)
      child.on('exit', resolveExit)
    })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 20000)
    try {
      if (killWhen !== undefined) {
        for (let n = 0; n < 1500 && !existsSync(join(root, killWhen)) && child.exitCode === null; n++) await sleep(10)
        expect(existsSync(join(root, killWhen)), diagnostic).toBe(true)
        child.kill('SIGKILL')
      }
      const code = await ended
      if (killWhen === undefined) expect(code, diagnostic).toBe(0)
    } finally {
      clearTimeout(timeout)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await ended
    }
  }
  async function json<T>(root: string, name: string): Promise<T> { return JSON.parse(await readFile(join(root, name), 'utf8')) as T }

  it('keeps an otherwise idle profile alive until its queued retry finishes', async () => {
    const { root, profile } = await setup()
    await run(root, profile, 'idle-retry')
    const result = await json<WorkView>(root, 'idle-retry.json')
    expect(result.state.status).toBe('succeeded')
    expect(result.attempts).toHaveLength(2)
    expect(Date.parse(result.attempts[1]!.startedAt) - Date.parse(result.attempts[0]!.finishedAt!)).toBeGreaterThanOrEqual(1000)
  }, 30000)

  it('recovers stage bindings and completed results without repeating work, including a delayed retry', async () => {
    const { root, profile } = await setup()
    await run(root, profile, 'research')
    const research = await json<StageReport>(root, 'research.json')
    expect(research.duplicate).toBe(research.research)
    expect(research.conflict).toBe(true)
    await run(root, profile, 'draft')
    const draft = await json<StageReport>(root, 'draft.json')
    expect(draft.research).toBe(research.research)
    expect(draft.wait.kind).toBe('retry-backoff')
    await run(root, profile, 'finish')
    const finish = await json<StageReport>(root, 'finish.json')
    expect(finish.draft).toBe(draft.draft)
    expect(finish.works.map(view => view.state.status)).toEqual(['succeeded', 'succeeded', 'succeeded'])
    const executions = (await readFile(join(root, 'executions.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as ExecutionRecord)
    expect(executions.map(value => value.stage)).toEqual(['research', 'draft', 'review'])
    expect(executions[1]!.at).toBeGreaterThanOrEqual(Date.parse(draft.wait.eligibleAt))
    expect(executions[1]!.inputArtifact).toBe('research-v1')
    expect(executions[2]!.inputArtifact).toBe('draft-v1')
    const log = (await readFile(join(root, 'queue/active.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as ChangeSet)
    const events = log.flatMap(value => value.events)
    expect(events.filter(event => event.type === 'work/admitted')).toHaveLength(3)
    expect(events.filter(event => event.type === 'attempt/started')).toHaveLength(4)
    expect(events.filter(event => event.type === 'attempt/succeeded')).toHaveLength(3)
  }, 45000)

  it('retains unknown after an owning process is killed and duplicate admission cannot restart it', async () => {
    const { root, profile } = await setup()
    await run(root, profile, 'unknown-start', 'unknown-work.json')
    await run(root, profile, 'unknown-inspect')
    const recovered = await json<{ id: string; duplicate: string; view: WorkView }>(root, 'unknown-inspect.json')
    expect(recovered.duplicate).toBe(recovered.id)
    expect(recovered.view.state.status).toBe('unknown')
    expect(recovered.view.attempts).toHaveLength(1)
    expect((await readFile(join(root, 'executions.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1)
  }, 45000)
})

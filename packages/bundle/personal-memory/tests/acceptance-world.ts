import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { expect } from 'vitest'
import {
  launchWebScaffold, webSnapshotMode, type WebScaffold,
} from '../../../../apps/web/tests/scaffold.ts'
import type {} from '@deepseek-ai/dsh-commands'
import type { AcceptanceAgent } from './assertions.ts'
import { memoryLiveOptions, MEMORY_MODEL, MEMORY_PROVIDER } from './live-provider.ts'

const bundle = resolve(import.meta.dirname, '..')
const repo = resolve(bundle, '../../..')

export async function createAcceptanceWorld(memoryEnabled = true, provider: string = MEMORY_PROVIDER) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-acceptance-'))
  const a = join(root, 'project-a')
  const b = join(root, 'project-b')
  const home = join(root, '.dsh')
  const storageRoot = join(home, 'storages')
  const evidence = join(repo, '.artifacts/project-memory', 'acceptance-' + randomUUID())
  await Promise.all([mkdir(a), mkdir(b), mkdir(evidence, { recursive: true })])
  const inputs: Record<string, string> = {}
  const fingerprint = async (path: string): Promise<void> => {
    const info = await lstat(path)
    if (info.isDirectory()) {
      for (const child of (await readdir(path)).sort()) await fingerprint(join(path, child))
    } else if (info.isFile()) {
      inputs[relative(repo, path).split(sep).join('/')] = createHash('sha256').update(await readFile(path)).digest('hex')
    }
  }
  for (const name of ['memory', 'memory-local', 'tool-memory', 'command-memory']) {
    await fingerprint(join(repo, 'packages/memory', name, 'src'))
  }
  await fingerprint(join(bundle, 'cordis.patch.yml'))
  await fingerprint(join(bundle, 'tests'))
  await fingerprint(join(repo, 'apps/web/tests/scaffold.ts'))
  await writeFile(join(evidence, 'input-fingerprints.json'), JSON.stringify(inputs, null, 2))
  let host: WebScaffold | undefined
  let generation = 0
  const sessions: AcceptanceAgent[] = []
  const getHost = (): WebScaffold => {
    if (host === undefined) throw new Error('acceptance Host is not running')
    return host
  }
  const saveEvidence = async (): Promise<void> => {
    if (host === undefined) return
    const selected = new Set(['tool/call', 'tool/result', 'command/run', 'command/done', 'turn/start', 'turn/end', 'assistant/message'])
    for (const agent of sessions) {
      await host.ctx.sessions.flush(agent.session)
      await writeFile(join(evidence, agent.id + '.json'), JSON.stringify({
        sessionId: agent.id, cwd: agent.session.header.cwd, hostGeneration: generation,
        events: agent.session.events.filter(event => selected.has(event.type)),
      }, null, 2))
    }
    try {
      await writeFile(join(evidence, 'memory-generation-' + String(generation) + '.json'),
        await readFile(join(storageRoot, 'project_memory.json')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const stop = async (): Promise<void> => {
    if (host === undefined) return
    const closing = host
    try { await saveEvidence() }
    finally { await closing.close(); host = undefined; sessions.length = 0 }
  }
  return {
    root, a, b, home, storageRoot, evidence, getHost, saveEvidence, stop,
    async start() {
      if (host !== undefined) throw new Error('stop the previous Host before restarting')
      host = await launchWebScaffold({
        ...webSnapshotMode() === 'record' ? await memoryLiveOptions(provider) : {},
        harnessHome: home, storageRoot, toolsMode: 'native',
        ...memoryEnabled ? {
          extraOverlayPath: join(bundle, 'cordis.patch.yml'),
          extraInstallAnchors: [join(bundle, 'package.json')],
        } : {},
      })
      generation++
      await writeFile(join(evidence, 'host-generation-' + String(generation) + '.json'), JSON.stringify({
        generation, mode: webSnapshotMode(), baseRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim(),
        provider, model: MEMORY_MODEL,
        profile: memoryEnabled ? 'base + web + personal-memory' : 'base + web', home, storageRoot,
      }, null, 2))
      return host
    },
    async session(cwd: string) {
      const current = getHost()
      const workspace = await current.ctx.workspaceRegistry.create(cwd)
      const created = await current.ctx.sessionController.create({ workspaceId: workspace.id })
      if (webSnapshotMode() === 'record') {
        await current.ctx.sessionController.selectModel({
          sessionId: created.sessionId, provider, model: MEMORY_MODEL,
        })
      }
      const agent = current.ctx.agents.get(created.sessionId)
      if (agent === undefined) throw new Error('Session Controller did not activate its Agent')
      sessions.push(agent)
      return agent
    },
    async prompt(agent: AcceptanceAgent, text: string) {
      const current = getHost()
      const prior = agent.session.events.length
      // Observe only this request's turn; no parallel model work is admitted here.
      const settled = current.whenTurnSettled(180_000)
      void settled.catch(() => undefined)
      await current.ctx.sessionController.prompt({
        requestId: randomUUID() as Parameters<typeof current.ctx.sessionController.prompt>[0]['requestId'],
        sessionId: agent.session.id, mode: 'queue', content: [{ type: 'text', text }],
      }, new AbortController().signal)
      expect(await settled).toBe(agent.session.id)
      expect(agent.session.events.slice(prior).filter(event => event.type === 'turn/end' && event.data.reason.kind === 'error'),
        'real Provider/runtime errors fail acceptance').toEqual([])
      await saveEvidence()
    },
    async command(agent: AcceptanceAgent, text: string) {
      const current = getHost()
      const priorTurns = agent.session.events.filter(event => event.type === 'turn/start').length
      const command = await current.ctx.commands.execute(agent, text, [], new AbortController().signal)
      expect(command?.result.kind).toBe('success')
      expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(priorTurns)
      await current.ctx.sessions.flush(agent.session)
      return command
    },
    async close() {
      await stop()
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !root.includes('dsh-memory-acceptance-')) {
        throw new Error('refusing unrelated acceptance cleanup')
      }
      const removeLinks = async (directory: string): Promise<void> => {
        for (const name of await readdir(directory)) {
          const path = join(directory, name)
          const info = await lstat(path)
          if (info.isSymbolicLink()) await unlink(path)
          else if (info.isDirectory()) await removeLinks(path)
        }
      }
      await removeLinks(root)
      await rm(root, { recursive: true, force: true })
    },
  }
}

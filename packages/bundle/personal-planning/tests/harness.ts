import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import LocalPlanning from '@changanhua/dsh-planning-local'
import * as ToolPlanning from '@changanhua/dsh-tool-planning'
import PlanningRemote from '@changanhua/dsh-planning-remote'
import PlanningDelivery from '@changanhua/dsh-planning-delivery-bridge'
import LocalDelivery from '@changanhua/dsh-delivery-local'
import type { PlanningBoardSnapshot, PlanningCommand, PlanningHandoff, PlanningMutationResult } from '@changanhua/dsh-planning/types'
import type { PlanningHandoffInput } from '@changanhua/dsh-planning-remote/types'

const root = join(import.meta.dirname, '..')
const support = {
  apply(ctx: Context): void {
    ctx.provide('tools', { register: () => () => {} } as never)
    ctx.provide('systemPrompt', { section: () => () => {} } as never)
    ctx.provide('agents', {} as never)
  },
}

interface PlanningRemoteOperations {
  snapshot(workspaceId: string, signal: AbortSignal): Promise<PlanningBoardSnapshot>
  execute(input: { readonly workspaceId: string; readonly command: PlanningCommand }, signal: AbortSignal): Promise<PlanningMutationResult>
  handoff(input: PlanningHandoffInput, signal: AbortSignal): Promise<PlanningHandoff>
}

interface Booted {
  readonly ctx: Context
  readonly root: string
  readonly project: string
  readonly workspaceId: string
  readonly remote: PlanningRemoteOperations
  create(requestId: string): PlanningCommand
  close(): Promise<void>
  reopen(): Promise<Booted>
  dispose(): Promise<void>
}

async function boot(rootPath: string, project: string, withDelivery = false): Promise<Booted> {
  const configPath = join(rootPath, 'cordis.yml')
  const bundleLink = join(rootPath, 'node_modules', '@changanhua', 'dsh-personal-planning')
  await mkdir(dirname(bundleLink), { recursive: true })
  try { await symlink(root, bundleLink, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  let patch = (await readFile(join(root, 'cordis.patch.yml'), 'utf8')).replaceAll('\r\n', '\n')
  patch = patch.replace("!!js dshHomePath('storages', 'planning-ownership')", JSON.stringify(join(rootPath, 'ownership')))
    .replace(/^- insert:\r?\n/mu, '').replace(/^    /gmu, '')
  const deliveryPatch = withDelivery ? (await readFile(join(root, 'delivery.patch.yml'), 'utf8'))
    .replace('!!js process.cwd()', JSON.stringify(project))
    .replace(/^- insert:\r?\n/mu, '').replace(/^    /gmu, '') : ''
  await writeFile(configPath, [
    "- { id: storage, name: '@deepseek-ai/dsh-storage' }",
    `- id: storage-json\n  name: '@deepseek-ai/dsh-storage-json'\n  config:\n    root: ${JSON.stringify(join(rootPath, 'storage'))}`,
    "- id: storage-domain\n  name: '@deepseek-ai/dsh-storage-domain'\n  isolate:\n    storageDomain: web-host\n  config:\n    backend: json",
    "- { id: sessions, name: '@deepseek-ai/dsh-session' }",
    `- id: session-persistence\n  name: '@deepseek-ai/dsh-session-persistence-jsonl'\n  config:\n    root: ${JSON.stringify(join(rootPath, 'sessions'))}\n    compression: none`,
    "- id: workspace-registry\n  name: '@deepseek-ai/dsh-workspace'\n  isolate:\n    storageDomain: web-host\n    workspaceRegistry: web-host",
    "- id: session-query\n  name: '@deepseek-ai/dsh-session-query-sqlite'\n  config:\n    path: ':memory:'\n    openAt: never",
    "- { id: planning-support, name: '@test/planning-support' }",
    "- { id: skill, name: '@deepseek-ai/dsh-skill' }",
    patch,
    ...withDelivery ? ["- id: delivery-local\n  name: '@changanhua/dsh-delivery-local'\n  isolate:\n    storageDomain: web-host", deliveryPatch] : [],
  ].join('\n'))
  // Keep Host compilation out of the Client project's source graph while Loader
  // still receives the real inert Node entry for the UI package.
  const uiPlanning: unknown = await import(
    pathToFileURL(join(root, '..', '..', 'client', 'ui-planning', 'src', 'index.ts')).href,
  )
  const modules = new Map<string, unknown>([
    ['@changanhua/dsh-planning-delivery-bridge', PlanningDelivery], ['@changanhua/dsh-delivery-local', LocalDelivery],
    ['@deepseek-ai/dsh-storage', Storage], ['@deepseek-ai/dsh-storage-json', StorageJson], ['@deepseek-ai/dsh-storage-domain', StorageDomain], ['@deepseek-ai/dsh-session', SessionStore], ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlPersistence], ['@deepseek-ai/dsh-workspace', WorkspaceRegistry], ['@deepseek-ai/dsh-session-query-sqlite', SessionQuery], ['@deepseek-ai/dsh-skill', SkillRegistry], ['@deepseek-ai/dsh-skill-filesystem', SkillFileSystem], ['@test/planning-support', support], ['@changanhua/dsh-planning-local', LocalPlanning], ['@changanhua/dsh-tool-planning', ToolPlanning], ['@changanhua/dsh-planning-remote', PlanningRemote], ['@changanhua/dsh-client-ui-planning', uiPlanning],
  ])
  const ctx = new Context(); ctx.baseUrl = pathToFileURL(rootPath).href + '/'
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string) { const value = modules.get(specifier); if (value === undefined) throw new Error(`unexpected module ${specifier}`); return value } } as never
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } }); await ctx.loader.await()
  const workspaceEntry = [...ctx.loader.entries()].find(entry => entry.options.id === 'workspace-registry')
  const remoteEntry = [...ctx.loader.entries()].find(entry => entry.options.id === 'planning-remote')
  if (workspaceEntry?.ctx === undefined || remoteEntry?.ctx === undefined) throw new Error('planning bundle entries did not mount')
  const workspaceRegistry = workspaceEntry.ctx.get('workspaceRegistry')
  if (workspaceRegistry === undefined) throw new Error('web-host Workspace Registry is unavailable')
  const workspace = await workspaceRegistry.create(project)
  const remote = remoteEntry.ctx.get('planningRemote') as unknown as PlanningRemoteOperations
  return {
    ctx, root: rootPath, project, workspaceId: workspace.id, remote,
    create: requestId => ({ kind: 'create', requestId, expectedBoardVersion: 0, itemId: 'captured-plan', lane: 'inbox', title: 'Captured bundle plan', intent: 'Prove real Loader composition survives restart.', scope: [], acceptance: [], sources: [{ kind: 'manual', text: 'operator note' }], estimate: { value: null, urgency: null, reuse: null, compounding: null, timeCost: null, tokenCost: null, risk: null, cognitiveCost: null, rationale: '' }, reviewAt: null }),
    close: async () => { await ctx.fiber.dispose() },
    reopen: async () => boot(rootPath, project, withDelivery),
    dispose: async () => { await ctx.fiber.dispose(); await rm(rootPath, { recursive: true, force: true }) },
  }
}

/** Boot a real Loader/Include composition with only infrastructure support stubbed. */
export async function bootPlanningBundle(withDelivery = false): Promise<Booted> {
  const rootPath = await mkdtemp(join(tmpdir(), 'dsh-personal-planning-'))
  const project = join(rootPath, 'project'); await mkdir(project)
  return boot(rootPath, project, withDelivery)
}

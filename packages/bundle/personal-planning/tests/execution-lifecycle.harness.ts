import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
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
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import LocalTaskQueue from '@changanhua/dsh-task-queue-local'
import LocalPlanning from '@changanhua/dsh-planning-local'
import * as ToolPlanning from '@changanhua/dsh-tool-planning'
import PlanningRemote from '@changanhua/dsh-planning-remote'
import PlanningDelivery from '@changanhua/dsh-planning-delivery-bridge'
import LocalDelivery from '@changanhua/dsh-delivery-local'
import LocalDeliveryEvidence from '@changanhua/dsh-delivery-evidence-local'
import DeliveryRemote from '@changanhua/dsh-delivery-remote'
import type { DeliveryEvidenceView } from '@changanhua/dsh-delivery-remote'
import * as DeliveryTaskQueue from '@changanhua/dsh-delivery-task-queue'
import GitLocalRepositoryWorkspace from '@changanhua/dsh-repo-workspace-git-local'
import type {
  PlanningBoardSnapshot,
  PlanningCommand,
  PlanningHandoff,
  PlanningMutationResult,
} from '@changanhua/dsh-planning'

const run = promisify(execFile)
const planningRoot = resolve(import.meta.dirname, '..')
const deliveryRoot = resolve(planningRoot, '..', 'personal-delivery')

const support = {
  apply(ctx: Context): void {
    ctx.provide('tools', { register: () => () => {} } as never)
    ctx.provide('systemPrompt', { section: () => () => {} } as never)
    ctx.provide('agents', {} as never)
  },
}
const credentials = {
  apply(ctx: Context): void {
    ctx.provide('credentials', {
      async describe() {
        return { configured: false, writable: false }
      },
      async resolve() {
        return undefined
      },
    } as never)
  },
}
const ui = { apply(): void {} }

export interface PlanningRemoteOperations {
  evidence(
    input: { readonly workspaceId: string; readonly itemId: string; readonly evidenceId: string },
    signal: AbortSignal,
  ): Promise<DeliveryEvidenceView>
  snapshot(workspaceId: string, signal: AbortSignal): Promise<PlanningBoardSnapshot>
  execute(
    input: { readonly workspaceId: string; readonly command: PlanningCommand },
    signal: AbortSignal,
  ): Promise<PlanningMutationResult>
  handoff(
    input: { readonly workspaceId: string; readonly itemId: string; readonly expectedRevisionId: string },
    signal: AbortSignal,
  ): Promise<PlanningHandoff>
  execution(
    input: { readonly workspaceId: string; readonly itemId: string },
    signal: AbortSignal,
  ): Promise<{
    readonly available: boolean
    readonly handoffs: readonly {
      readonly handoff: PlanningHandoff
      readonly case: {
        readonly lane: string
        readonly packets: readonly {
          readonly acceptanceDecision: { readonly decision: string } | null
          readonly verificationVerdict: {
            readonly status: string
            readonly evidenceIds: readonly string[]
          } | null
        }[]
      } | null
    }[]
  }>
}

export interface DeliveryRemoteOperations {
  reviseCase(
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{
    readonly case: { readonly id: string; readonly headRevisionId: string }
    readonly revision: { readonly id: string }
  }>
  recordRequirementDecision(input: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
  createPacket(
    input: { readonly contractRevisionId: string; readonly packet: Record<string, unknown> },
    signal: AbortSignal,
  ): Promise<{ readonly id: string }>
  startChange(
    input: { readonly packetId: string; readonly executorId: string },
    signal: AbortSignal,
  ): Promise<{ readonly id: string; readonly queueWorkId: string | null }>
  startVerification(
    input: { readonly packetId: string; readonly changeBindingId: string },
    signal: AbortSignal,
  ): Promise<{ readonly id: string; readonly queueWorkId: string | null }>
  recordDecision(input: Record<string, unknown>, signal: AbortSignal): Promise<{ readonly decision: string }>
}

export interface ExecutionWorld {
  readonly root: string
  readonly repository: string
  readonly workspaceId: string
  readonly ctx: Context
  readonly planning: PlanningRemoteOperations
  readonly delivery: DeliveryRemoteOperations
  close(): Promise<void>
  reopen(): Promise<ExecutionWorld>
  dispose(): Promise<void>
}

export interface ExecutionWorldOptions {
  readonly codexEnv?: Readonly<Record<string, string>>
  readonly codexPermissionMode?: 'never' | 'approve-for-me'
}

async function git(directory: string, ...args: string[]): Promise<void> {
  await run('git', ['-C', directory, ...args])
}

function flatten(patch: string): string {
  return patch.replace(/^- insert:\r?\n/mu, '').replace(/^    /gmu, '')
}

async function boot(root: string, repository: string, options: ExecutionWorldOptions): Promise<ExecutionWorld> {
  const configPath = join(root, 'cordis.yml')
  const link = join(root, 'node_modules', '@changanhua', 'dsh-personal-planning')
  await mkdir(dirname(link), { recursive: true })
  try {
    await symlink(planningRoot, link, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const planningPatch = flatten(
    (await readFile(join(planningRoot, 'cordis.patch.yml'), 'utf8')).replace(
      "!!js dshHomePath('storages', 'planning-ownership')",
      JSON.stringify(join(root, 'ownership')),
    ),
  )
  const deliveryPatch = flatten(
    (await readFile(join(deliveryRoot, 'cordis.patch.yml'), 'utf8'))
      .replace("!!js dshHomePath('personal-delivery/evidence')", JSON.stringify(join(root, 'evidence')))
      .replace("!!js dshHomePath('personal-delivery/worktrees')", JSON.stringify(join(root, 'worktrees')))
      .replace('!!js process.cwd()', JSON.stringify(repository)),
  ).replace(
    "name: '@changanhua/dsh-delivery-task-queue'",
    options.codexEnv === undefined
      ? "name: '@changanhua/dsh-delivery-task-queue'"
      : `name: '@changanhua/dsh-delivery-task-queue'\n  config:\n    permissionMode: ${options.codexPermissionMode ?? 'never'}\n    env: ${JSON.stringify(options.codexEnv)}`,
  )
  const bridgePatch = flatten(
    (await readFile(join(planningRoot, 'delivery.patch.yml'), 'utf8')).replace(
      '!!js process.cwd()',
      JSON.stringify(repository),
    ),
  )
  await writeFile(
    configPath,
    [
      "- { id: storage, name: '@deepseek-ai/dsh-storage' }",
      `- id: storage-json\n  name: '@deepseek-ai/dsh-storage-json'\n  config:\n    root: ${JSON.stringify(join(root, 'storage'))}`,
      "- id: storage-domain\n  name: '@deepseek-ai/dsh-storage-domain'\n  isolate:\n    storageDomain: web-host\n  config:\n    backend: json",
      "- { id: sessions, name: '@deepseek-ai/dsh-session' }",
      `- id: session-persistence\n  name: '@deepseek-ai/dsh-session-persistence-jsonl'\n  config:\n    root: ${JSON.stringify(join(root, 'sessions'))}\n    compression: none`,
      "- id: workspace-registry\n  name: '@deepseek-ai/dsh-workspace'\n  isolate:\n    storageDomain: web-host\n    workspaceRegistry: web-host",
      "- id: session-query\n  name: '@deepseek-ai/dsh-session-query-sqlite'\n  config:\n    path: ':memory:'\n    openAt: never",
      "- { id: planning-support, name: '@test/planning-support' }",
      "- { id: skill, name: '@deepseek-ai/dsh-skill' }",
      "- { id: credentials, name: '@test/dsh-credentials' }",
      "- { id: subprocess, name: '@deepseek-ai/dsh-subprocess-local' }",
      `- id: task-queue\n  name: '@changanhua/dsh-task-queue-local'\n  config:\n    queueRoot: ${JSON.stringify(join(root, 'queue'))}\n    maxConcurrent: 1\n    resourceCapacity:\n      agent-run: 1`,
      planningPatch,
      deliveryPatch,
      bridgePatch,
    ].join('\n'),
  )
  const modules = new Map<string, unknown>([
    ['@test/planning-support', support],
    ['@test/dsh-credentials', credentials],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlPersistence],
    ['@deepseek-ai/dsh-workspace', WorkspaceRegistry],
    ['@deepseek-ai/dsh-session-query-sqlite', SessionQuery],
    ['@deepseek-ai/dsh-skill', SkillRegistry],
    ['@deepseek-ai/dsh-skill-filesystem', SkillFileSystem],
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocess],
    ['@changanhua/dsh-task-queue-local', LocalTaskQueue],
    ['@changanhua/dsh-planning-local', LocalPlanning],
    ['@changanhua/dsh-tool-planning', ToolPlanning],
    ['@changanhua/dsh-planning-remote', PlanningRemote],
    ['@changanhua/dsh-planning-delivery-bridge', PlanningDelivery],
    ['@changanhua/dsh-client-ui-planning', ui],
    ['@changanhua/dsh-delivery-local', LocalDelivery],
    ['@changanhua/dsh-delivery-evidence-local', LocalDeliveryEvidence],
    ['@changanhua/dsh-repo-workspace-git-local', GitLocalRepositoryWorkspace],
    ['@changanhua/dsh-delivery-task-queue', DeliveryTaskQueue],
    ['@changanhua/dsh-delivery-remote', DeliveryRemote],
    ['@changanhua/dsh-client-ui-delivery', ui],
  ])
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      const module = modules.get(specifier)
      if (module === undefined) throw new Error(`unexpected module ${specifier}`)
      return module
    },
  } as never
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const entries = [...ctx.loader.entries()]
  const registry = entries.find(entry => entry.options.id === 'workspace-registry')?.ctx?.get('workspaceRegistry')
  const planning = entries
    .find(entry => entry.options.id === 'planning-remote')
    ?.ctx?.get('planningRemote') as unknown as PlanningRemoteOperations | undefined
  const delivery = entries
    .find(entry => entry.options.id === 'delivery-remote')
    ?.ctx?.get('deliveryRemote') as unknown as DeliveryRemoteOperations | undefined
  if (registry === undefined || planning === undefined || delivery === undefined)
    throw new Error('execution acceptance composition did not mount')
  const workspace = await registry.create(repository)
  return {
    root,
    repository,
    workspaceId: workspace.id,
    ctx,
    planning,
    delivery,
    close: () => ctx.fiber.dispose(),
    reopen: () => boot(root, repository, options),
    dispose: async () => {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}

export async function bootExecutionWorld(options: ExecutionWorldOptions = {}): Promise<ExecutionWorld> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-planning-execution-'))
  const repository = join(root, 'repository')
  await mkdir(join(repository, 'src'), { recursive: true })
  await git(repository, 'init', '--initial-branch=main')
  await git(repository, 'config', 'user.email', 'execution@example.test')
  await git(repository, 'config', 'user.name', 'Execution Acceptance')
  // Byte-level verifier fixtures must not inherit the operator's Git EOL conversion.
  await git(repository, 'config', 'core.autocrlf', 'false')
  await writeFile(join(repository, '.gitattributes'), '* -text\n')
  await writeFile(join(repository, 'src', 'base.txt'), 'base\n')
  await git(repository, 'add', '.')
  await git(repository, 'commit', '-m', 'execution acceptance base')
  return boot(root, repository, options)
}

export async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for governed Queue settlement')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

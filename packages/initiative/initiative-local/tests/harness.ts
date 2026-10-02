import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import Commands from '@deepseek-ai/dsh-commands'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import LocalPlanning from '@changanhua/dsh-planning-local'
import { initiativeCommandSchema, initiativeQuerySchema } from '@changanhua/dsh-initiative'
import type { InitiativeCommand, InitiativeReceipt } from '@changanhua/dsh-initiative'
import LocalInitiative from '../src/index.ts'
import * as CommandInitiative from '../../command-initiative/src/index.ts'
import * as ToolInitiative from '../../tool-initiative/src/index.ts'
import Llm from '@deepseek-ai/dsh-llm'
import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import LocalAssessment from '../../../requirement-assessment/requirement-assessment-local/src/index.ts'
import Review from '../../../requirement-assessment/requirement-assessment-review/src/index.ts'

export async function boot(existingRoot?: string, maxWorkspaceBytes?: number, assessmentAdapter?: LlmAdapter,
  extensions: Array<{ name: string; plugin: unknown; config?: Record<string, unknown> }> = []) {
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), 'dsh-initiative-test-'))
  const cwd = join(root, 'project')
  await mkdir(cwd, { recursive: true })
  const ctx = new Context()
  const configPath = join(root, 'cordis.yml')
  const rows: Array<{ name: string; config?: Record<string, unknown> }> = [
    { name: '@deepseek-ai/dsh-session' }, { name: '@deepseek-ai/dsh-agent' },
    { name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
    { name: '@deepseek-ai/dsh-storage' }, { name: '@deepseek-ai/dsh-storage-json', config: { root: join(root, 'storage') } },
    { name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } }, { name: '@deepseek-ai/dsh-workspace' },
    { name: '@deepseek-ai/dsh-session-query-sqlite', config: { path: ':memory:', openAt: 'never' } },
    { name: '@changanhua/dsh-planning-local', config: { ownershipRoot: join(root, 'planning-owner') } },
    { name: '@deepseek-ai/dsh-commands' }, { name: '@deepseek-ai/dsh-tools' }, { name: '@deepseek-ai/dsh-system-prompt' },
    { name: '@changanhua/dsh-initiative-local', config: { ownershipRoot: join(root, 'initiative-owner'), operatorId: 'local-human', ...(maxWorkspaceBytes === undefined ? {} : { maxWorkspaceBytes }) } },
    { name: '@changanhua/dsh-command-initiative' }, { name: '@changanhua/dsh-tool-initiative' },
  ]
  if (assessmentAdapter !== undefined) rows.push(
    { name: 'assessment', config: { ownershipRoot: join(root, 'assessment-owner') } },
    { name: 'llm' }, { name: 'review-fixture' },
    { name: 'review', config: { provider: 'initiative-fixture', model: 'fixture', dshBaseline: 'keyless-test',
      maxInputBytes: 200000, maxOutputBytes: 200000, maxOutputTokens: 12000, timeoutMs: 10000 } },
  )
  // JSON is also YAML; the real Loader owns import normalization, injection and disposal.
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore], ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlPersistence], ['@deepseek-ai/dsh-session-query-sqlite', SessionQuery],
    ['@deepseek-ai/dsh-storage', Storage], ['@deepseek-ai/dsh-storage-json', JsonStorage], ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-workspace', WorkspaceRegistry], ['@changanhua/dsh-planning-local', LocalPlanning],
    ['@deepseek-ai/dsh-commands', Commands], ['@deepseek-ai/dsh-tools', Tools], ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@changanhua/dsh-initiative-local', LocalInitiative], ['@changanhua/dsh-command-initiative', CommandInitiative], ['@changanhua/dsh-tool-initiative', ToolInitiative],
  ])
  for (const extension of extensions) {
    rows.push({ name: extension.name, config: { ...extension.config, ownershipRoot: join(root, `${extension.name}-owner`) } })
    modules.set(extension.name, extension.plugin)
  }
  await writeFile(configPath, JSON.stringify(rows, null, 2))
  modules.set('assessment', LocalAssessment)
  modules.set('llm', Llm)
  modules.set('review', Review)
  modules.set('review-fixture', { name: 'initiative-review-fixture', inject: ['llm'], apply(context: Context) {
    context.llm.registerAdapter(['initiative-fixture'], assessmentAdapter!)
  } })
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error(`unexpected import: ${specifier}`)
    return modules.get(specifier)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  try {
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    const workspace = await ctx.workspaceRegistry.create(cwd)
    const session = ctx.sessions.create(SessionId('initiative-session'), { meta: { cwd } })
    const agent = { id: session.id, session, ctx, status: 'idle', options: {}, reserveTurnAdmission: () => () => {} } as unknown as Agent
    const unregister = ctx.agents.register(agent)
    const human = async (input: unknown) => {
      const execution = await ctx.commands.execute(agent, `/initiative ${JSON.stringify(input)}`, [], new AbortController().signal)
      if (execution === undefined) throw new Error('initiative command not registered')
      return execution.result
    }
    const humanOK = async (input: unknown): Promise<InitiativeReceipt> => {
      const result = await human(input)
      if (result.kind !== 'success' || result.text === undefined) throw new Error(JSON.stringify(result))
      return JSON.parse(result.text) as InitiativeReceipt
    }
    const read = async (id?: string, version?: number) => {
      const result = await human({ action: 'read', ...(id === undefined ? {} : { id }), ...(version === undefined ? {} : { version }) })
      if (result.kind !== 'success') throw new Error(JSON.stringify(result))
      return JSON.parse(result.text!) as Awaited<ReturnType<typeof ctx.initiative.read>>
    }
    let calls = 0
    const tool = (input: unknown, name = 'initiative_record') => ctx.tools.execute({
      agent, name, arguments: { input_json: JSON.stringify(input) }, callId: ToolCallId(`candidate-${++calls}`), signal: new AbortController().signal,
    })
    const access = () => ({ workspaceId: workspace.id, actorId: 'local-human', kind: 'human' as const, authorize() {} })
    return { ctx, root, cwd, workspace, agent, session, unregister, human, humanOK, read, tool, access,
      close: () => ctx.fiber.dispose(),
      dispose: async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) },
    }
  } catch (error) {
    await ctx.fiber.dispose()
    if (existingRoot === undefined) await rm(root, { recursive: true, force: true })
    throw error
  }
}
export const propose = (key = 'new'): InitiativeCommand => initiativeCommandSchema.parse({ action: 'propose', key, kind: 'simplify', trigger: 'Observed repeated work', facts: { claim: 'Reduce manual checks' } })
export const investigate = (result: InitiativeReceipt, key = 'investigate'): InitiativeCommand => initiativeCommandSchema.parse({
  action: 'investigate', key, id: result.id,
  expectedRecordVersion: result.recordVersion, expectedVersion: result.headVersion,
  facts: { claim: 'Prefer a current-state delta', evidenceRefs: [{ owner: 'audit', kind: 'document', id: 'audit-1', verification: 'unverified' }],
    counterEvidenceRefs: [{ owner: 'audit', kind: 'document', id: 'audit-1', verification: 'unknown',
      excerpt: 'The audit already declares snapshot scope.' }] }, completion: 'complete',
})
export const promotion = (result: InitiativeReceipt, key = 'promote'): InitiativeCommand => initiativeCommandSchema.parse({
  action: 'promote', key, id: result.id, expectedRecordVersion: result.recordVersion, expectedVersion: result.headVersion, rationale: 'Review this exact hypothesis as a pending proposal',
})
export const query = () => initiativeQuerySchema.parse({ action: 'read' })

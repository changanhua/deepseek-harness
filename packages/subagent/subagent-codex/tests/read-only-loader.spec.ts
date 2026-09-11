import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Inbox } from '@deepseek-ai/dsh-agent'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolSubagent from '../../tool-subagent/src/index.ts'
import * as Codex from '../src/index.ts'
import { startResponsesFixture, type ResponsesFixture } from './responses-fixture.ts'

const roots: string[] = []
const contexts: Context[] = []
const fixtures: ResponsesFixture[] = []
const readOnlyPatch = new URL(
  '../../tool-subagent/examples/codex-read-only.patch.yml',
  import.meta.url,
)

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(fixtures.splice(0).map(fixture => fixture.close()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function parent(workspace: string): Agent {
  const id = SessionId('read-only-loader-parent')
  const session = Session.create(id, undefined, {
    version: 0,
    id,
    createdAt: Date.now(),
    cwd: workspace,
  })
  const inbox = new Inbox(session, { inserted() {}, discarded() {}, claimed() {} })
  return { id: session.id, options: {}, session, inbox } as unknown as Agent
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a record`)
  }
  return value as Record<string, unknown>
}

describe('read-only Codex Host patch through the real Loader', () => {
  it('returns a Codex result through its foreground tool while rejecting a workspace write', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-codex-readonly-loader-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const codexHome = join(root, 'codex-home')
    mkdirSync(workspace)
    mkdirSync(codexHome)
    const fixture = await startResponsesFixture([
      {
        kind: 'advertisedFunctionCall',
        choices: [
          { name: 'exec_command', arguments: { cmd: 'cmd /c type nul > read-only-loader-side-effect' } },
          { name: 'shell_command', arguments: { command: 'cmd /c type nul > read-only-loader-side-effect' } },
        ],
      },
      { kind: 'complete', text: 'READ_ONLY_LOADER_RESULT' },
    ])
    fixtures.push(fixture)
    writeFileSync(join(codexHome, 'config.toml'), [
      'model = "fixture-model"',
      'model_provider = "fixture"',
      'approval_policy = "on-request"',
      'sandbox_mode = "workspace-write"',
      'disable_response_storage = true',
      'check_for_update_on_startup = false',
      '',
      '[model_providers.fixture]',
      'name = "Fixture Responses"',
      `base_url = "${fixture.baseUrl}"`,
      'env_key = "OPENAI_API_KEY"',
      'wire_api = "responses"',
      'requires_openai_auth = false',
      '',
      '[analytics]',
      'enabled = false',
      '',
    ].join('\n'))
    const env = {
      OPENAI_API_KEY: 'dsh-fake-openai-key',
      CODEX_HOME: codexHome,
      HOME: root,
      XDG_CONFIG_HOME: join(root, 'xdg'),
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
      NO_PROXY: '127.0.0.1,localhost',
    }
    const configPath = join(root, 'cordis.yml')
    writeFileSync(configPath, '[]\n')
    const patches = loadOverlayPatches(
      'subagent-codex-readonly-loader',
      fileURLToPath(readOnlyPatch),
    )
    const sourceEntry = patches.flatMap(patch => patch.insert ?? []).find(entry => (
      entry.id === 'subagent-codex-readonly'
    ))
    if (sourceEntry === undefined) throw new Error('read-only Codex Host patch has no provider entry')
    expect(sourceEntry.name).toBe('@deepseek-ai/dsh-subagent-codex')
    const sourceConfig = record(sourceEntry.config, 'read-only Codex Host provider config')
    expect(sourceConfig.providerName).toBe('codex-readonly')
    expect(sourceConfig.permissionMode).toBe('read-only')
    const runtimePatches = patches.map(patch => patch.insert === undefined
      ? patch
      : {
        ...patch,
        insert: patch.insert.map((entry) => {
          if (entry.id !== 'subagent-codex-readonly') return entry
          return { ...entry, config: { ...record(entry.config, 'read-only Codex patch provider config'), env } }
        }),
      })
    const ctx = await boot(
      'subagent-codex-readonly-loader',
      configPath,
      runtimePatches,
      async (hostCtx) => {
        await hostCtx.plugin(LlmRuntime)
        await hostCtx.plugin(SystemPrompt)
        await hostCtx.plugin(ToolRuntime)
        await hostCtx.plugin(SubagentRuntime)
        await hostCtx.plugin(LocalSubprocessRuntime)
        hostCtx.loader.internal = {
          version: 'v2',
          async import(specifier: string) {
            if (specifier === '@deepseek-ai/dsh-subagent-codex') return Codex
            if (specifier === '@deepseek-ai/dsh-tool-subagent') return ToolSubagent
            throw new Error(`unexpected read-only Host patch import: ${specifier}`)
          },
        } as unknown as NonNullable<typeof hostCtx.loader.internal>
      },
    )
    contexts.push(ctx)

    expect(ctx.subagents.getProvider('codex-readonly')).toBeDefined()
    const schema = ctx.tools.schemas().find(entry => entry.name === 'subagent_codex_readonly')
    expect(schema?.parameters.properties).not.toHaveProperty('run_in_background')
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('read-only-loader-call'),
      name: 'subagent_codex_readonly',
      arguments: {
        description: 'exercise the read-only host tool',
        prompt: 'Attempt the fixture write, then return the fixture result.',
      },
      agent: parent(workspace),
    })

    expect(JSON.stringify(result.content)).toContain('READ_ONLY_LOADER_RESULT')
    expect(existsSync(join(workspace, 'read-only-loader-side-effect'))).toBe(false)
    expect(fixture.requests).toHaveLength(2)
  }, 60_000)
})

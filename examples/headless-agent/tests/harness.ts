import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import * as BashEnvPlugin from '@deepseek-ai/dsh-shell-env'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SessionCheckpointPolicy from '@deepseek-ai/dsh-session-checkpoint-policy'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import RuntimeFacts from '@deepseek-ai/dsh-runtime-facts'
import * as RuntimeFactsHost from '@deepseek-ai/dsh-runtime-facts-host'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as WebSearchExa from '@deepseek-ai/dsh-web-search-exa'
import * as ToolRuntimeInspect from '@deepseek-ai/dsh-tool-runtime-inspect'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'

/**
 * Shared harness for the headless-agent e2e suites: the full plugin stack
 * with the real DeepSeek adapter and the real bash + todo_write tools. Lives
 * outside the *.e2e.ts pattern so importing it never re-registers another
 * file's tests.
 */

export const SYSTEM_PROMPT = 'You are a coding agent. Use bash for file operations '
  + 'with cat/grep/heredocs; check [exit code: N] markers, '
  + 'and report results briefly.'

/** System prompt for the todo_write e2e: nudges the model to plan with the tool. */
export const TODO_SYSTEM_PROMPT = 'You are a coding agent. For multi-step work, '
  + 'use the todo_write tool to track a task list: send the WHOLE list each call, '
  + 'mark every task being actively worked on in_progress (several at once when '
  + 'work runs in parallel, at least one while work remains), and mark a task '
  + 'completed as soon as it is done.'

/** Options for {@link codingHarness}. */
export interface CodingHarnessOptions {
  /**
   * Deployment persona for the tree (the system-prompt plugin's `persona`
   * config — per-context, not per-agent). Omitted ⇒ no persona section.
   */
  persona?: string
  /** Durable JSONL persistence root (the resume suite needs it; others stay file-free). */
  persistenceRoot?: string
  /**
   * Load {@link BasicCompactionEngine} with this config so the compaction e2e can
   * trigger compaction at a small, controlled history size. Omitted ⇒ no
   * compaction plugin (the default suites run without it).
   */
  compact?: BasicCompactionConfig
  /** Test-only context capacity advertised for `deepseek-v4-flash`. */
  modelContextWindow?: number
}

export async function codingHarness(workdir: string, options: CodingHarnessOptions = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { persona: options.persona ?? '' },
  })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LlmDeepSeek, options.modelContextWindow === undefined ? {} : {
    models: [{ id: 'deepseek-v4-flash', contextWindow: options.modelContextWindow }],
  })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(LocalBashExecutor, { cwd: workdir, timeoutMs: 30_000 })
  await ctx.plugin(ToolBash)
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  // Compaction is opt-in: only the compaction e2e loads the reusable meter and backend.
  if (options.compact !== undefined) {
    await ctx.plugin(TokenMeter)
    await ctx.plugin(ToolResultPruner)
    await ctx.plugin(BasicCompactionEngine, options.compact)
  }
  // Durable JSONL persistence is opt-in: only the resume e2e needs it, and the
  // other suites stay file-free. Loaded last so a resume's deferred
  // `ctx.inject(['sessionPersistence'])` resolves once this is present.
  if (options.persistenceRoot !== undefined) {
    await ctx.plugin(JsonlSessionPersistence, { root: options.persistenceRoot })
    await ctx.plugin(SessionCheckpointPolicy)
  }
  return ctx
}

/** The smallest real settings provider: one in-memory document, always writable. */
export class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** Options for {@link runtimeAwarenessHarness}. */
export interface RuntimeAwarenessHarnessOptions {
  /** Deployment persona for the tree (per-context, not per-agent). */
  persona?: string
  /**
   * The pi-ai provider route the agent turns run against. Must name a route the
   * {@link LlmPiAi} config declares; defaults to the host `huoshancoding` route.
   */
  provider?: string
  /** Credential reference resolved from the host credentials document. */
  apiKeyEnv?: string
  /** OpenAI-compatible endpoint for the route. */
  baseURL?: string
  /** Model id served by the route. */
  model?: string
}

/**
 * Boot the full Runtime Awareness stack for a real-model behavior eval: the
 * agent loop, credential + pi-ai LLM plane, host subprocess, runtime-facts
 * registry + host provider, the web seam with an Exa search provider, and the
 * `runtime_inspect` tool. The Exa provider carries a dummy key so its fact
 * renders as available; behavior evals never issue a real search.
 */
export async function runtimeAwarenessHarness(
  workdir: string,
  options: RuntimeAwarenessHarnessOptions = {},
): Promise<Context> {
  void workdir
  const provider = options.provider ?? 'huoshancoding'
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { persona: options.persona ?? '' },
  })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalCredentialProvider, {})
  await ctx.plugin(LlmPiAi, {
    providers: {
      [provider]: {
        apiKeyEnv: options.apiKeyEnv ?? 'HUOSHANCODING_API_KEY',
        api: 'openai-responses',
        baseURL: options.baseURL ?? 'https://ark.cn-beijing.volces.com/api/coding/v3',
        models: [{
          id: options.model ?? 'deepseek-v4-flash-ga-260731',
          contextWindow: 128_000,
          maxTokens: 32_768,
        }],
      },
    },
  })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(LocalBashExecutor, { cwd: workdir, timeoutMs: 30_000 })
  await ctx.plugin(ToolBash)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(RuntimeFacts, {})
  await ctx.plugin(RuntimeFactsHost)
  await ctx.plugin(WebRuntime, { searchProvider: 'exa' })
  await ctx.plugin(WebSearchExa, { apiKey: 'test-key' })
  await ctx.plugin(ToolRuntimeInspect)
  await ctx.plugin(ToolWeb)
  // The eval turns do not touch the filesystem; the workdir exists so a future
  // scenario that probes the shell has a valid cwd to start from.
  return ctx
}

export function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

export function finalText(events: SessionEvent[]): string {
  const message = events.findLast(event => event.type === 'assistant/message')
  if (message?.type !== 'assistant/message') return ''
  return message.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

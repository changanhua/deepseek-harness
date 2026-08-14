/**
 * Built-in prepare-only executor adapters (§6).
 *
 * An adapter returns a fully-specified {@link SubprocessSpawnSpec}; it never
 * touches `child_process` itself — the scheduler is the sole spawn/terminate/
 * wait point via `ctx.subprocess`. Executables are resolved against `argv[0]`
 * directly (a bare name relies on the subprocess service's scrubbed PATH, an
 * absolute path is passed through): the scheduler ultimately calls
 * `ctx.subprocess.spawn(spec)`, which already owns executable resolution, so a
 * second resolution hop here would duplicate policy. Output is collected with
 * bounded spill, `cwd` is the task's output directory (created ahead of time),
 * and `env` is left unset so the subprocess service's scrubbed parent
 * environment applies (§6.2).
 * @module @deepseek-ai/dsh-task-queue-local/executors
 */

import { mkdir } from 'node:fs/promises'
import type { SubprocessSpawnSpec, SubprocessCollect } from '@deepseek-ai/dsh-subprocess'
import type { ExecutorAdapter, Task } from '@deepseek-ai/dsh-task-queue'
import { DIR_MODE } from './paths.ts'

/** Default grace period for a spawned task's terminate escalation. */
const DEFAULT_GRACE_MS = 5_000

/** Bounded collect for stdout/stderr with a spill cap (memory stays bounded). */
function collect(maxBytes: number): SubprocessCollect {
  return { maxBytes, spill: { maxBytes: maxBytes * 16 } }
}

/** Common per-stream stdio disposition for a task execution. */
function stdio(): SubprocessSpawnSpec['stdio'] {
  return { stdin: 'ignore', stdout: collect(256 * 1024), stderr: collect(256 * 1024) }
}

/**
 * Ensure a task's output directory exists before it is used as cwd.
 * @param dir - the output directory to create, recursively, with owner-only mode.
 */
export async function ensureOutputDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIR_MODE })
}

/** Build a CLI adapter from an argv factory plus whether cwd must be outputDir. */
function cliAdapter(build: (task: Task, prompt: string, cwd: string, command: string) => string[]): ExecutorAdapter {
  return {
    async prepare(task, _run, signal): Promise<SubprocessSpawnSpec> {
      void signal
      const cwd = task.outputDir ?? ''
      if (cwd !== '') await ensureOutputDir(cwd)
      const argv = build(task, task.prompt, cwd, task.executor)
      return {
        argv,
        cwd: cwd || process.cwd(),
        stdio: stdio(),
        graceMs: DEFAULT_GRACE_MS,
      }
    },
  }
}

/**
 * Built-in adapters registry. `command` is the executable name used in
 * `argv[0]` (bare name → subprocess scrambles PATH, absolute → passed through).
 * @param commands - optional per-executor command overrides; omission uses the bare CLI name.
 * @returns a map from executor name to its prepare-only adapter.
 */
export function builtinAdapters(commands: ExecutorCommands): Map<string, ExecutorAdapter> {
  return new Map<string, ExecutorAdapter>([
    ['claude', claudeAdapter(commands.claude ?? 'claude')],
    ['codex', codexAdapter(commands.codex ?? 'codex')],
    ['opencode', opencodeAdapter(commands.opencode ?? 'opencode')],
    ['arkcli', arkcliAdapter(commands.arkcli ?? 'arkcli')],
    ['shell', shellAdapter()],
  ])
}

/** Commands for the fixed-name built-in adapters (defaults are bare names). */
export interface ExecutorCommands {
  claude?: string
  codex?: string
  opencode?: string
  arkcli?: string
}

/** `claude -p <prompt> --output-format json --add-dir <outputDir>`. */
function claudeAdapter(command: string): ExecutorAdapter {
  return cliAdapter((_task, prompt, cwd) => [
    command, '-p', prompt, '--output-format', 'json', '--add-dir', cwd || '.',
  ])
}

/** `codex exec <prompt>` with cwd = outputDir. */
function codexAdapter(command: string): ExecutorAdapter {
  return cliAdapter((_task, prompt, _cwd) => [command, 'exec', prompt])
}

/** `opencode run <prompt>` with cwd = outputDir. */
function opencodeAdapter(command: string): ExecutorAdapter {
  return cliAdapter((_task, prompt, _cwd) => [command, 'run', prompt])
}

/** `arkcli +chat <prompt>` (user profile). */
function arkcliAdapter(command: string): ExecutorAdapter {
  return cliAdapter((_task, prompt, _cwd) => [command, '+chat', prompt])
}

/**
 * `shell` executes an argv array taken from the task prompt's JSON
 * `{ argv: string[] }`. Only inbox-originated tasks may reach it (§6.3);
 * a malformed prompt fails the attempt immediately.
 */
function shellAdapter(): ExecutorAdapter {
  return {
    async prepare(task, _run, signal): Promise<SubprocessSpawnSpec> {
      void signal
      let argv: string[] | undefined
      try {
        const parsed: unknown = JSON.parse(task.prompt)
        if (typeof parsed === 'object' && parsed !== null) {
          const candidate = (parsed as { argv?: unknown }).argv
          if (Array.isArray(candidate) && candidate.length > 0 && candidate.every(x => typeof x === 'string')) {
            argv = candidate as string[]
          }
        }
      } catch {
        argv = undefined
      }
      if (argv === undefined) {
        throw new Error('shell executor requires task.prompt JSON { argv: string[] }')
      }
      const cwd = task.outputDir ?? process.cwd()
      return {
        argv,
        cwd,
        stdio: stdio(),
        graceMs: DEFAULT_GRACE_MS,
      }
    },
  }
}

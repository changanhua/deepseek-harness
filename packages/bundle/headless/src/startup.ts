/**
 * The one-shot app's command-line provider: it parses the task positional,
 * `--model`, `--resume`, `--list`, and `--help`, then publishes
 * {@link HEADLESS_STARTUP_SERVICE}. The runner is an ordinary consumer whose
 * lazy config waits for that service.
 * @module @deepseek-ai/dsh-headless/startup
 */

import { readSync } from 'node:fs'
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'headless-startup'

/** Services required before the task can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the one-shot runner. */
export const HEADLESS_STARTUP_SERVICE = 'headlessStartup'

/** What the runner row reads from {@link HEADLESS_STARTUP_SERVICE}. */
export interface HeadlessStartupValues {
  /** The task text this invocation asked for (positional, or piped stdin). */
  task: string | undefined
  /** Model name override; the runner keeps the default provider. */
  model: string | undefined
  /** Persisted session id to resume instead of creating a new session. */
  resume: string | undefined
  /** List sessions and exit instead of running a task. */
  list: boolean | undefined
}

/**
 * Read piped stdin to EOF synchronously. The startup provider publishes inside
 * the command action and cannot await, so a sync read keeps the task available
 * before the runner row's lazy config evaluates.
 * @returns the complete piped input as UTF-8.
 */
function readStdinSync(): string {
  const chunks: Buffer[] = []
  const buf = Buffer.allocUnsafe(65536)
  for (;;) {
    const count = readSync(0, buf, 0, buf.length, null)
    if (count <= 0) break
    chunks.push(Buffer.from(buf.subarray(0, count)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The stdin probe the startup provider uses; tests substitute a capture. */
export const internals: { readStdin(): string } = { readStdin: readStdinSync }

/**
 * This app's command: the task positional, the run options, and the help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function headlessCommand(): Command {
  return new Command()
    .name('dsh --profile headless')
    .description('Answer one task, print the final assistant message, and exit.')
    .helpOption('-h, --help', 'show this help')
    .argument('[task...]', 'the task text; multiple words are joined by spaces')
    .option('-m, --model <model>', 'model name for this run (default: the agent default)')
    .option('-r, --resume <sessionId>', 'resume the persisted session instead of creating one')
    .option('-l, --list', 'list sessions (newest first) and exit')
    .addHelpText('after', `
Examples:
  dsh --profile headless "run the tests"             answer one task and exit
  echo "run the tests" | dsh --profile headless      take the task from stdin
  dsh --profile headless --list                      list sessions and exit
  dsh --profile headless --resume session-abc "keep going"
`)
}

/**
 * Parse and provide the one-shot task as an ordinary Cordis service. The
 * command's action publishes the task; a missing or whitespace-only task (with
 * no piped stdin) is a usage error, so on rejection (and on `--help`) nothing
 * is provided. `--list` publishes only the list intent and needs no task.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = headlessCommand()
  program.action(() => {
    const options = program.opts<{ model?: string; resume?: string; list?: boolean }>()
    if (options.list === true) {
      ctx.provide(HEADLESS_STARTUP_SERVICE, {
        task: undefined,
        model: undefined,
        resume: undefined,
        list: true,
      } satisfies HeadlessStartupValues)
      return
    }
    let task = program.args.join(' ').trim()
    // A non-TTY stdin (pipe, file redirection) supplies the task. Node leaves
    // `isTTY` undefined for every non-terminal fd — pipes included — so probe
    // anything that is not a definite TTY: a TTY stdin would block on the sync
    // read. An open pipe with no data blocks until its writer closes it.
    if (task === '' && process.stdin.isTTY !== true) task = internals.readStdin().trim()
    if (task === '') program.error('error: a task is required, for example: dsh --profile headless "run the tests"')
    ctx.provide(HEADLESS_STARTUP_SERVICE, {
      task,
      model: options.model,
      resume: options.resume,
      list: undefined,
    } satisfies HeadlessStartupValues)
  })
  parseCmdline(ctx, program)
}

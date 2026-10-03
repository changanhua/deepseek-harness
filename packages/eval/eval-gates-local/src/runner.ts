/** Host-owned runner for the fixed verifier Profile. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, symlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { observeRuntimeTree } from '@changanhua/dsh-eval-isolated'
import { evalContractDigest } from '@changanhua/dsh-eval'
import type { GateVerifierInput, GateVerifierReport } from '@changanhua/dsh-eval-gates'
import type { GatePolicy, VerifierExecution } from './config.ts'
import { z } from 'zod'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const reportSchema = z.object({ kind: z.literal('eval-verifier-report'), schemaVersion: z.literal(1),
  snapshotRevision: z.string(), inputDigest: z.string(), outcome: z.enum(['approved', 'rejected', 'unknown']),
  reason: z.enum(['criteria-satisfied', 'criteria-failed', 'invalid-result', 'invalid-input']),
  cells: z.array(z.object({ caseId: z.string(), routeId: z.string(), repeatIndex: z.number().int().nonnegative(),
    outcome: z.enum(['approved', 'rejected', 'unknown']), reason: z.enum(['criteria-satisfied', 'criteria-failed', 'invalid-input']) }).strict()),
  runtime: z.object({ sessionId: z.string().min(1), profile: z.string().min(1), configDigest: z.string() }).strict(),
}).strict()

async function writeExclusive(path: string, contents: string, limit: number): Promise<string> {
  if (Buffer.byteLength(contents) > limit) throw new Error('eval-gate-input-capacity')
  const file = await open(path, 'wx')
  try { await file.writeFile(contents) } finally { await file.close() }
  return sha256(contents)
}

async function readBounded(path: string, limit: number): Promise<string> {
  const file = await open(path, 'r')
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size > limit) throw new Error('eval-gate-output-capacity')
    const body = await file.readFile({ encoding: 'utf8' })
    const after = await file.stat()
    if (before.size !== after.size || Buffer.byteLength(body) > limit) throw new Error('eval-gate-output-changed')
    return body
  } finally { await file.close() }
}

function contained(root: string, path: string): boolean {
  const relation = relative(resolve(root), resolve(path))
  return !isAbsolute(relation) && relation !== '..' && !relation.startsWith(`..${sep}`)
}

function moduleAt(core: string, name: string): string {
  return pathToFileURL(join(core, 'node_modules', name, 'lib/index.js')).href
}

/**
 * Produce the private Host callback used by LocalEvalGates.  The caller can
 * supply no executable, home, patch, or evidence path; all of those derive
 * from the already admitted policy.
 * @param ctx Host context with the managed Subprocess owner.
 * @returns A private runner that authenticates pinned core bytes and retains the exact verifier report.
 */
export function createLocalVerifierExecution(ctx: Context): (input: GateVerifierInput, policy: GatePolicy,
  signal?: AbortSignal) => Promise<VerifierExecution> {
  const subprocess = ctx.get('subprocess')
  if (!subprocess) throw new Error('eval-gate-subprocess-unavailable')
  return async (input, policy, signal) => {
    const launch = policy.launch
    if (!contained(launch.core.directory, launch.executable) || !contained(launch.core.directory, launch.entrypoint)) throw new Error('eval-gate-launch-outside-core')
    const deadline = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(launch.timeoutMs)])
    const before = await observeRuntimeTree(launch.core.directory, launch.core.imageBounds, deadline)
    if (before.digest !== launch.core.digest || before.digest !== policy.coreDigest) throw new Error('eval-gate-core-mismatch')
    const provenance = JSON.parse(await readBounded(join(launch.core.directory, 'eval-core.json'), policy.maxInputBytes)) as { sourceCommit?: string }
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(launch.core.sourceCommit)
      || provenance.sourceCommit !== launch.core.sourceCommit) throw new Error('eval-gate-core-provenance-mismatch')
    const executionId = randomUUID(), root = join(launch.homeRoot, executionId), home = join(root, 'home')
    const profileRoot = join(home, 'profiles', launch.profile), inputFile = join(root, 'input.json'), outputFile = join(root, 'report.json')
    await mkdir(profileRoot, { recursive: true })
    const rendered = JSON.stringify(input)
    const inputDigest = await writeExclusive(inputFile, rendered, policy.maxInputBytes)
    const configuration = { inputDigest, coreDigest: before.digest, verifierPlan: input.verifierPlan,
      sourceCommit: provenance.sourceCommit }
    const configDigest = evalContractDigest(configuration)
    const rows = [
      { id: 'sessions', name: moduleAt(launch.core.directory, '@deepseek-ai/dsh-session') },
      { id: 'jsonl', name: moduleAt(launch.core.directory, '@deepseek-ai/dsh-session-persistence-jsonl'), config: { root: join(home, 'sessions'), compression: 'none' } },
      { id: 'eval-verifier', name: moduleAt(launch.core.directory, '@changanhua/dsh-eval-verifier'), config: {
        inputFile, outputFile, maxInputBytes: policy.maxInputBytes, maxOutputBytes: policy.maxOutputBytes,
        profile: launch.profile, configDigest,
      } },
    ]
    const patch = JSON.stringify([{ insert: rows }])
    const profile = JSON.stringify({ name: 'dsh-eval-verifier-profile', private: true, dsh: { profile: { bundles: [], patchReload: 'startup' } } })
    await writeExclusive(join(profileRoot, 'package.json'), profile, policy.maxInputBytes)
    const profileDigest = await writeExclusive(join(profileRoot, 'cordis.patch.yml'), patch, policy.maxInputBytes)
    // The profile-local resolution root points only at the frozen core. It is a
    // junction on Windows and never exposes the Subject workspace lease.
    const modules = join(profileRoot, 'node_modules')
    await mkdir(dirname(modules), { recursive: true })
    await symlink(join(launch.core.directory, 'node_modules'), modules, 'junction')
    let handle: ReturnType<SubprocessRuntime['spawn']> | undefined
    let quiescent = false
    try {
      handle = subprocess.spawn({ argv: [launch.executable, launch.entrypoint, '--profile', launch.profile], cwd: launch.core.directory,
        env: { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, stdio: { stdin: 'ignore',
          stdout: { maxBytes: policy.maxOutputBytes }, stderr: { maxBytes: policy.maxOutputBytes } }, graceMs: launch.graceMs,
        signal: deadline })
      const outcome = await handle.done
      quiescent = await handle.waitForExit(AbortSignal.timeout(launch.graceMs))
      if (outcome.exitCode !== 0 || outcome.signal !== null || !quiescent || deadline.aborted) {
        const stderr = handle.collected.stderr?.readFrom(0).text.slice(-1024) ?? ''
        throw new Error(`eval-gate-verifier-unsettled:${stderr}`)
      }
      const reportText = await readBounded(outputFile, policy.maxOutputBytes)
      const report: GateVerifierReport = reportSchema.parse(JSON.parse(reportText))
      const reportDigest = sha256(reportText)
      if (report.snapshotRevision !== input.snapshotRevision || report.inputDigest !== inputDigest
        || report.runtime.profile !== launch.profile || report.runtime.configDigest !== configDigest || !report.runtime.sessionId) {
        throw new Error('eval-gate-verifier-mismatch')
      }
      // The report identity is usable only when the profile's JSONL persistence
      // has materialized it; a self-reported Session id alone is insufficient.
      const entries = await readdir(join(home, 'sessions'), { recursive: true }).catch(() => [])
      if (!entries.some(entry => entry.includes(report.runtime.sessionId))) throw new Error('eval-gate-verifier-session-unpersisted')
      const after = await observeRuntimeTree(launch.core.directory, launch.core.imageBounds, deadline)
      if (after.digest !== before.digest) throw new Error('eval-gate-core-drift')
      const world = await lstat(root)
      const workspace = JSON.stringify({ kind: 'verifier-world', executionId, directory: root,
        identity: { dev: world.dev, ino: world.ino }, sourceCommit: provenance.sourceCommit, disposition: 'preserved' })
      const observer = JSON.stringify({ kind: 'verifier-observer', executionId, sourceCommit: provenance.sourceCommit,
        coreDigest: before.digest, profilePatch: patch, configuration, sessionId: report.runtime.sessionId, quiescent })
      return { executionId, sessionId: report.runtime.sessionId,
        report, reportText, reportDigest, inputDigest, quiescent, profileDigest, configDigest,
        verifiedCommit: provenance.sourceCommit, observer, workspace }
    } finally {
      if (handle && !quiescent) {
        handle.terminate()
        await handle.waitForExit(AbortSignal.timeout(launch.graceMs)).catch(() => false)
      }
    }
  }
}

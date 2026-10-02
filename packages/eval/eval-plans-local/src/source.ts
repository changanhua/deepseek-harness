import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path'
import { evalContractDigest, parseEvalPlan, parseEvalSuite } from '@changanhua/dsh-eval'
import type { EvalPlan, EvalSuite } from '@changanhua/dsh-eval'
import { z } from 'zod'

const routeParameters = z.object({
  maxTokens: z.number().int().positive().optional(), temperature: z.number().optional(),
  reasoningEffort: z.string().min(1).optional(), stop: z.array(z.string()).optional(),
}).strict()

function assertRelativePath(path: string): void {
  if (isAbsolute(path) || win32.isAbsolute(path) || path.includes(':') || path.includes('\0')
    || path.split(/[\\/]/u).some(part => part === '..' || part === '')) throw new Error('Plan source requires a contained relative path')
}

/** Host configuration pins the complete Plan, including its authority references. */
export interface PinnedPlanSource {
  readonly root: string
  readonly planFile: string
  readonly suiteFile: string
  readonly approvedPlan: { readonly id: string; readonly version: string; readonly digest: string }
  readonly maxFileBytes: number
  readonly maxCells: number
}

/** Detached source data; no runtime permission is minted by the file reader. */
export interface PlanSourceSnapshot {
  readonly plan: EvalPlan
  readonly suite: EvalSuite
  readonly cellCount: number
}

function contained(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

async function readSource(root: string, path: string, maxBytes: number, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted()
  assertRelativePath(path)
  const logical = resolve(root, path)
  const physical = await realpath(logical)
  if (!contained(root, physical)) throw new Error('Plan source escapes its trusted root')
  const handle = await open(physical, 'r')
  try {
    const before = await handle.stat()
    if (!before.isFile()) throw new Error('Plan source is not a regular file')
    if (before.size > maxBytes) throw new Error('Plan source exceeds its complete file bytes limit')
    const bytes = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < bytes.length) {
      signal?.throwIfAborted()
      const read = await handle.read(bytes, length, bytes.length - length, length)
      if (read.bytesRead === 0) break
      length += read.bytesRead
    }
    const after = await handle.stat()
    const currentPath = await realpath(logical)
    const named = await stat(currentPath)
    if (currentPath !== physical || !contained(root, currentPath)
      || named.dev !== before.dev || named.ino !== before.ino
      || before.size !== length || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error('Plan source changed while reading')
    }
    signal?.throwIfAborted()
    return JSON.parse(bytes.subarray(0, length).toString('utf8')) as unknown
  } finally {
    await handle.close()
  }
}

/**
 * Read a complete Host-pinned Plan and its exact Suite beneath one trusted root.
 *
 * This helper checks source containment, identity and matrix bounds, not live
 * Provider availability or budget authorization. The Provider admits separately.
 * @param source Host configuration, never browser/model input.
 * @param signal Optional cancellation, checked before reads and publication.
 * @returns Detached Plan/Suite data and the exact planned cell count, without paths.
 * @throws {Error} On unsafe paths, source drift, invalid JSON/schema or a failed bound.
 */
export async function readPinnedPlanSource(source: PinnedPlanSource, signal?: AbortSignal): Promise<PlanSourceSnapshot> {
  signal?.throwIfAborted()
  if (!isAbsolute(source.root)) throw new Error('Plan root must be absolute')
  for (const bound of [source.maxFileBytes, source.maxCells]) {
    if (!Number.isSafeInteger(bound) || bound < 1) throw new Error('Plan source limits must be positive safe integers')
  }
  const root = await realpath(source.root)
  const rootIdentity = await stat(root)
  const plan = parseEvalPlan(await readSource(root, source.planFile, source.maxFileBytes, signal))
  if (plan.id !== source.approvedPlan.id || plan.version !== source.approvedPlan.version
    || evalContractDigest(plan) !== source.approvedPlan.digest) {
    throw new Error('Plan content differs from the Host-approved identity')
  }
  const suite = parseEvalSuite(await readSource(root, source.suiteFile, source.maxFileBytes, signal))
  if (suite.id !== plan.suiteRef.id || suite.version !== plan.suiteRef.version || evalContractDigest(suite) !== plan.suiteRef.digest) {
    throw new Error('Suite content differs from the exact Plan reference')
  }
  if (suite.sourceRevision !== plan.repository.expectedCommit) throw new Error('Suite revision differs from the Plan')
  for (const route of plan.routes) {
    routeParameters.parse(route.parameters)
    const declared = suite.routes.find(candidate => candidate.id === route.id)
    if (!declared || declared.provider !== route.provider || declared.model !== route.model || declared.preset !== route.preset.id) {
      throw new Error('Plan route differs from the referenced Suite')
    }
  }
  for (const item of suite.cases) {
    if (item.workspace.kind === 'fixture') assertRelativePath(item.workspace.path)
    for (const fixture of item.replayFixtures) {
      assertRelativePath(fixture.sessionFile)
      if (fixture.overrideFile !== undefined) assertRelativePath(fixture.overrideFile)
      for (const child of fixture.childFiles ?? []) assertRelativePath(child)
    }
  }
  const cellCount = suite.cases.length * plan.routes.length * plan.repeatPolicy.count
  if (!Number.isSafeInteger(cellCount) || cellCount > source.maxCells) throw new Error('Plan cell matrix exceeds the Host limit')
  const currentRoot = await realpath(source.root)
  const currentIdentity = await stat(currentRoot)
  if (root !== currentRoot || rootIdentity.dev !== currentIdentity.dev || rootIdentity.ino !== currentIdentity.ino) {
    throw new Error('Plan trusted root changed while reading')
  }
  signal?.throwIfAborted()
  return { plan, suite, cellCount }
}

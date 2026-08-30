import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  gatesForMode,
  runGates,
  type Gate,
  type GateResult,
} from './run-gates.ts'

export interface GateSnapshot {
  gateId: string
  status: 'passed' | 'failed' | 'skipped'
  diagnostics: string[]
}

export interface DifferentialFailure {
  gateId: string
  diagnostics: string[]
}

const C0_PATH_PREFIXES = [
  'packages/delivery/',
  'packages/bundle/personal-delivery/',
  'packages/client/ui-delivery/',
  'docs/subsystems/delivery.',
  'docs/subsystems/delivery/',
  'docs/specs/2026-08-29-personal-delivery',
] as const

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))

export function c0PathChanged(paths: string[]): boolean {
  return paths.some((path) => {
    const normalized = path.replaceAll('\\', '/')
    return C0_PATH_PREFIXES.some(prefix => normalized.startsWith(prefix))
  })
}

export function normalizeDiagnostics(lines: string[], roots: string[]): string[] {
  const normalizedRoots = roots
    .map(root => resolve(root).replaceAll('\\', '/'))
    .sort((left, right) => right.length - left.length)
  const diagnostics = new Set<string>()

  for (const rawLine of lines) {
    let line = rawLine
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, '')
      .replaceAll('\\', '/')
      .trim()
    if (line === ''
      || /^run-gates: (?:PASS|start)\b/u.test(line)
      || /^Start at\s/u.test(line)
      || /^│\s*(?:Total:|typescript)\s*│/u.test(line)
      || /^(?:\.\.\/)*tsconfig\.base\.json:6:14:$/u.test(line)) continue
    for (const root of normalizedRoots) {
      line = line.replace(new RegExp(escapeRegExp(root), 'giu'), '<root>')
    }
    line = line.replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/gu, '<duration>')
    diagnostics.add(line)
  }

  return [...diagnostics].sort()
}

export function newFailureDiagnostics(base: GateSnapshot[], head: GateSnapshot[]): DifferentialFailure[] {
  const baseByGate = new Map(base.map(result => [result.gateId, result]))
  const failures: DifferentialFailure[] = []

  for (const headResult of head) {
    if (headResult.status === 'passed') continue
    const baseResult = baseByGate.get(headResult.gateId)
    const baseline = baseResult?.status === 'passed' || baseResult === undefined
      ? new Set<string>()
      : new Set(baseResult.diagnostics)
    const diagnostics = headResult.diagnostics
      .filter(line => !baseline.has(line))
      .filter(isC0Diagnostic)
    if (diagnostics.length === 0 && (baseResult === undefined || baseResult.status !== headResult.status)) {
      diagnostics.push(`status changed from ${baseResult?.status ?? 'missing'} to ${headResult.status}`)
    }
    if (diagnostics.length > 0) failures.push({ gateId: headResult.gateId, diagnostics })
  }

  return failures
}

function isC0Diagnostic(diagnostic: string): boolean {
  const normalized = diagnostic.replaceAll('\\', '/')
  return C0_PATH_PREFIXES.some(prefix => normalized.includes(prefix))
}

async function main(args: string[]): Promise<number> {
  const options = parseArgs(args)
  const changedPaths = gitChangedPaths(options.headDir, options.baseSha, options.headSha)
  if (!c0PathChanged(changedPaths)) {
    console.log('fork-c0-diff: no Delivery C0-owned paths changed; differential gates are not required.')
    return 0
  }

  const gates = differentialGates()
  console.log(`fork-c0-diff: running ${gates.length} gate(s) against base and head.`)
  const baseResults = await runGates(gates, 4, gate => runGateAt(gate, options.baseDir))
  const headResults = await runGates(gates, 4, gate => runGateAt(gate, options.headDir))
  const roots = [options.baseDir, options.headDir]
  const failures = newFailureDiagnostics(
    baseResults.map(result => snapshot(result, roots)),
    headResults.map(result => snapshot(result, roots)),
  )
  if (failures.length === 0) {
    console.log('fork-c0-diff: head introduces no static, Knip, documentation, lint, or duplication failure.')
    return 0
  }

  console.error('fork-c0-diff: head introduces new failure diagnostics:')
  for (const failure of failures) {
    console.error(`\n[${failure.gateId}]`)
    for (const diagnostic of failure.diagnostics.slice(0, 200)) console.error(diagnostic)
    if (failure.diagnostics.length > 200) {
      console.error(`... ${failure.diagnostics.length - 200} additional diagnostic(s) omitted`)
    }
  }
  return 1
}

interface Options {
  baseDir: string
  headDir: string
  baseSha: string
  headSha: string
}

export function parseArgs(args: string[]): Options {
  const parameters = args[0] === '--' ? args.slice(1) : args
  const values = new Map<string, string>()
  for (let index = 0; index < parameters.length; index += 2) {
    const name = parameters[index]
    const value = parameters[index + 1]
    if (name === undefined || value === undefined || !name.startsWith('--')) {
      throw new Error('run-fork-c0-diff: expected --base-dir, --head-dir, --base-sha, and --head-sha values.')
    }
    values.set(name, value)
  }
  return {
    baseDir: resolve(required(values, '--base-dir')),
    headDir: resolve(required(values, '--head-dir')),
    baseSha: required(values, '--base-sha'),
    headSha: required(values, '--head-sha'),
  }
}

function required(values: Map<string, string>, name: string): string {
  const value = values.get(name)
  if (value === undefined || value === '') throw new Error(`run-fork-c0-diff: missing ${name}.`)
  return value
}

function gitChangedPaths(cwd: string, baseSha: string, headSha: string): string[] {
  const result = spawnSync('git', ['diff', '--name-only', baseSha, headSha], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`run-fork-c0-diff: git diff failed: ${(result.stderr || result.stdout).trim()}`)
  }
  return result.stdout.split(/\r?\n/gu).filter(Boolean)
}

function differentialGates(): Gate[] {
  const docTypecheck = gatesForMode('ci-consumers').find(gate => gate.id === 'doc-typecheck')
  if (docTypecheck === undefined) throw new Error('run-fork-c0-diff: ci-consumers must define doc-typecheck.')
  return [
    ...gatesForMode('ci-static'),
    ...gatesForMode('ci-lint-contracts-ready'),
    {
      ...docTypecheck,
      needs: [],
      after: [],
      env: { ...docTypecheck.env, DSH_DOC_TYPECHECK_USE_BUILD_OUTPUT: '1' },
    },
  ]
}

export async function runGateAt(gate: Gate, cwd: string): Promise<GateResult> {
  const started = performance.now()
  const output: GateResult['output'] = []
  let spawnError: string | undefined
  const outcome = await new Promise<{ exitCode: number | null; signalCode: NodeJS.Signals | null }>((resolveExit) => {
    const child = spawn(gate.command, gate.args, {
      cwd,
      env: { ...process.env, ...gate.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (text: string) => output.push({ stream: 'stdout', text }))
    child.stderr.on('data', (text: string) => output.push({ stream: 'stderr', text }))
    child.on('error', (error) => {
      spawnError = error.message
      resolveExit({ exitCode: null, signalCode: null })
    })
    child.on('close', (exitCode, signalCode) => {
      resolveExit({ exitCode, signalCode })
    })
    child.stdin.end()
  })
  const status = outcome.exitCode === 0 && outcome.signalCode === null && spawnError === undefined
    ? 'passed'
    : 'failed'
  return {
    gate,
    status,
    durationMs: performance.now() - started,
    output,
    exitCode: outcome.exitCode,
    signalCode: outcome.signalCode,
    ...spawnError === undefined ? {} : { error: spawnError },
  }
}

function snapshot(result: GateResult, roots: string[]): GateSnapshot {
  const lines = result.output.flatMap(chunk => chunk.text.split(/\r?\n/gu))
  if (result.error !== undefined) lines.push(result.error)
  return {
    gateId: result.gate.id,
    status: result.status,
    diagnostics: result.status === 'passed' ? [] : normalizeDiagnostics(lines, roots),
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { chmod, link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'

const MODES = new Set(['native', 'adaptive', 'governed'])
const OUTCOMES = new Set(['completed', 'partial', 'blocked', 'abandoned'])
const EVIDENCE = new Set([
  'not-run', 'implemented', 'source-contract', 'generated',
  'composed', 'runtime-observed', 'behavior-verified',
])
const EFFECTS = new Set(['improved', 'neutral', 'worse', 'unknown'])
const AGENT_ROLES = new Set(['explorer', 'scout', 'worker', 'implementer', 'reviewer', 'architect', 'default'])
const REASONING = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'unknown'])
const ACTION = /^[a-z][a-z0-9-]{0,47}$/u
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/u
const RUN_ID = /^[a-z0-9-]{10,96}$/u
const WINDOWS_ABSOLUTE_PATH = /(?:^|[^A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\)/u
const POSIX_ABSOLUTE_PATH = /(?:^|[=:\s('"`])\/(?!\/)/u
const CREDENTIAL_LIKE = /(?:(?:^|[^A-Za-z0-9])(?:[A-Z][A-Z0-9]*_)*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|SECRET|BEARER)\s*[:=]|\b(?:api[_ -]?key|access[_ -]?token|auth[_ -]?token|password|secret|bearer)\b\s*[:=]|\bbearer\s+[A-Za-z0-9._~+/-]{8,}|\b(?:sk-|github_pat_|gh[pousr]_|AKIA)[A-Za-z0-9_-]{8,})/iu
const PROMPT_LIKE = /(?:^|\s)(?:system prompt|prompt|user message|model output)\s*[:=]/iu
const EXTERNAL_URL = /\b(?:https?|wss?):\/\//iu

const OPTIONS = {
  start: new Set(['mode', 'task']),
  finish: new Set([
    'run', 'outcome', 'highest-evidence', 'effect', 'effect-summary', 'action',
    'escalated-to', 'escalation-reason', 'agent', 'checks', 'subagents',
    'review-findings', 'reused-evidence',
  ]),
  list: new Set(['mode', 'limit']),
}

function fail(message) {
  process.stderr.write(`mode-learning: ${message}\n`)
  process.exitCode = 1
}

function repositoryRoot(start) {
  let current = resolve(start)
  const root = parse(current).root
  while (true) {
    if (existsSync(join(current, '.git')) && existsSync(join(current, 'AGENTS.md'))) return current
    if (current === root) throw new Error('current directory is not inside a DSH repository')
    current = dirname(current)
  }
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token?.startsWith('--')) throw new Error(`unexpected argument ${JSON.stringify(token)}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${token} requires a value`)
    const key = token.slice(2)
    const list = values.get(key) ?? []
    list.push(value)
    values.set(key, list)
    index += 1
  }
  return values
}

function rejectUnknownOptions(args, command) {
  const allowed = OPTIONS[command]
  for (const key of args.keys()) {
    if (!allowed.has(key)) throw new Error(`unknown option --${key} for ${command}`)
  }
}

function one(args, name, { required = false } = {}) {
  const values = args.get(name) ?? []
  if (values.length > 1) throw new Error(`--${name} may be supplied once`)
  if (required && values.length === 0) throw new Error(`--${name} is required`)
  return values[0]
}

function bounded(value, name, max, { required = false } = {}) {
  if (value === undefined) {
    if (required) throw new Error(`--${name} is required`)
    return undefined
  }
  if (value.trim().length === 0 || value.length > max || /[\r\n\u0000]/u.test(value)) {
    throw new Error(`--${name} must be non-blank, single-line, and at most ${max} characters`)
  }
  return value
}

function safeSummary(value, name, max, options) {
  const summary = bounded(value, name, max, options)
  if (summary === undefined) return undefined
  if (WINDOWS_ABSOLUTE_PATH.test(summary) || POSIX_ABSOLUTE_PATH.test(summary)) {
    throw new Error(`--${name} must not contain an absolute path`)
  }
  if (CREDENTIAL_LIKE.test(summary)) {
    throw new Error(`--${name} must not contain credential-like content`)
  }
  if (PROMPT_LIKE.test(summary)) {
    throw new Error(`--${name} must not contain prompt-shaped content`)
  }
  if (EXTERNAL_URL.test(summary)) {
    throw new Error(`--${name} must not contain an external URL`)
  }
  return summary
}

function selected(value, name, allowed) {
  if (value === undefined || !allowed.has(value)) {
    throw new Error(`--${name} must be one of ${[...allowed].join(', ')}`)
  }
  return value
}

function count(args, name) {
  const raw = one(args, name)
  if (raw === undefined) return 0
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative safe integer`)
  return value
}

function agents(args) {
  const values = args.get('agent') ?? []
  if (values.length > 8) throw new Error('--agent may be repeated at most 8 times')
  return values.map((value) => {
    const parts = value.split('|')
    if (parts.length !== 5) throw new Error('--agent must use role|model|reasoning|changed-decision|findings')
    const [role, model, reasoning, changed, findingsRaw] = parts
    if (!AGENT_ROLES.has(role)) throw new Error(`--agent role must be one of ${[...AGENT_ROLES].join(', ')}`)
    if (!MODEL.test(model)) throw new Error('--agent model must be a bounded runtime model id or unknown')
    if (CREDENTIAL_LIKE.test(model)) throw new Error('--agent model must not contain credential-like content')
    if (!REASONING.has(reasoning)) throw new Error(`--agent reasoning must be one of ${[...REASONING].join(', ')}`)
    if (changed !== 'true' && changed !== 'false') throw new Error('--agent changed-decision must be true or false')
    const findings = Number(findingsRaw)
    if (!Number.isSafeInteger(findings) || findings < 0) throw new Error('--agent findings must be a non-negative safe integer')
    return { role, model, reasoning, changedDecision: changed === 'true', findings }
  })
}

async function safeChmod(path) {
  try { await chmod(path, 0o600) } catch (error) {
    if (process.platform !== 'win32') throw error
  }
}

async function unlinkIfPresent(path) {
  try { await unlink(path) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

function terminalIntent(record) {
  return {
    outcome: record.outcome,
    highestEvidence: record.highestEvidence,
    effect: record.effect,
    effectSummary: record.effectSummary,
    actions: record.actions,
    agents: record.agents,
    counts: record.counts,
    escalation: record.escalation,
  }
}

function assertSameIntent(record, intent) {
  if (JSON.stringify(terminalIntent(record)) !== JSON.stringify(intent)) {
    throw new Error('learning run is already finalized with different terminal values')
  }
}

async function readRecord(path) {
  const record = JSON.parse(await readFile(path, 'utf8'))
  if (record?.schemaVersion !== 1 || typeof record.runId !== 'string') {
    throw new Error('learning record is malformed')
  }
  safeSummary(record.task, 'task', 160, { required: true })
  if (record.effectSummary !== undefined) {
    safeSummary(record.effectSummary, 'effect-summary', 400, { required: true })
  }
  if (record.escalation?.reason !== undefined) {
    safeSummary(record.escalation.reason, 'escalation-reason', 240, { required: true })
  }
  for (const agent of record.agents ?? []) {
    if (typeof agent.model !== 'string' || !MODEL.test(agent.model) || CREDENTIAL_LIKE.test(agent.model)) {
      throw new Error('stored agent model is invalid or credential-like')
    }
  }
  return record
}

async function startRun(paths, args) {
  const mode = selected(one(args, 'mode', { required: true }), 'mode', MODES)
  const task = safeSummary(one(args, 'task', { required: true }), 'task', 160, { required: true })
  const startedAt = new Date().toISOString()
  const runId = `${Date.now().toString(36)}-${randomUUID()}`
  const active = { schemaVersion: 1, runId, mode, task, startedAt }
  await mkdir(paths.active, { recursive: true, mode: 0o700 })
  const target = join(paths.active, `${runId}.json`)
  await writeFile(target, `${JSON.stringify(active)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  await safeChmod(target)
  process.stdout.write(`${JSON.stringify(active)}\n`)
}

async function finishRun(paths, args) {
  const runId = bounded(one(args, 'run', { required: true }), 'run', 96, { required: true })
  if (!RUN_ID.test(runId)) throw new Error('--run has an invalid format')
  const outcome = selected(one(args, 'outcome', { required: true }), 'outcome', OUTCOMES)
  const highestEvidence = selected(one(args, 'highest-evidence', { required: true }), 'highest-evidence', EVIDENCE)
  const effect = selected(one(args, 'effect', { required: true }), 'effect', EFFECTS)
  const effectSummary = safeSummary(one(args, 'effect-summary', { required: true }), 'effect-summary', 400, { required: true })
  const actions = [...new Set(args.get('action') ?? [])]
  if (actions.length > 24 || actions.some(action => !ACTION.test(action))) {
    throw new Error('--action must be a stable lowercase token and may be repeated at most 24 times')
  }
  const escalatedToRaw = one(args, 'escalated-to')
  const escalationReasonRaw = one(args, 'escalation-reason')
  if ((escalatedToRaw === undefined) !== (escalationReasonRaw === undefined)) {
    throw new Error('--escalated-to and --escalation-reason must be supplied together')
  }
  const escalation = escalatedToRaw === undefined ? null : {
    to: selected(escalatedToRaw, 'escalated-to', MODES),
    reason: safeSummary(escalationReasonRaw, 'escalation-reason', 240, { required: true }),
  }
  const agentRecords = agents(args)
  const legacySubagents = count(args, 'subagents')
  if (agentRecords.length > 0 && legacySubagents !== 0 && legacySubagents !== agentRecords.length) {
    throw new Error('--subagents must match the number of --agent entries when both are supplied')
  }
  const counts = {
    checks: count(args, 'checks'),
    subagents: agentRecords.length > 0 ? agentRecords.length : legacySubagents,
    reviewFindings: count(args, 'review-findings'),
    reusedEvidence: count(args, 'reused-evidence'),
  }
  const intent = { outcome, highestEvidence, effect, effectSummary, actions, agents: agentRecords, counts, escalation }
  await mkdir(paths.base, { recursive: true, mode: 0o700 })
  await mkdir(paths.finishing, { recursive: true, mode: 0o700 })
  await mkdir(paths.completed, { recursive: true, mode: 0o700 })
  const activePath = join(paths.active, `${runId}.json`)
  const claimPath = join(paths.finishing, `${runId}.json`)
  const completedPath = join(paths.completed, `${runId}.json`)
  if (existsSync(completedPath)) {
    const completed = await readRecord(completedPath)
    assertSameIntent(completed, intent)
    await unlinkIfPresent(activePath)
    process.stdout.write(`${JSON.stringify(completed)}\n`)
    return
  }
  if (existsSync(claimPath)) {
    let claimed
    try {
      claimed = await readRecord(claimPath)
    } catch (error) {
      if (!existsSync(activePath)) throw error
      await unlinkIfPresent(claimPath)
    }
    if (claimed !== undefined) {
      assertSameIntent(claimed, intent)
      try { await rename(claimPath, completedPath) } catch (error) {
        if (!existsSync(completedPath)) throw error
      }
      const completed = await readRecord(completedPath)
      assertSameIntent(completed, intent)
      await unlinkIfPresent(activePath)
      process.stdout.write(`${JSON.stringify(completed)}\n`)
      return
    }
  }
  const active = await readRecord(activePath)
  if (active.runId !== runId || !MODES.has(active.mode)) throw new Error('active learning run is malformed')
  const finishedAt = new Date().toISOString()
  const durationMs = Date.parse(finishedAt) - Date.parse(active.startedAt)
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) throw new Error('active learning run has an invalid start time')
  const record = {
    schemaVersion: 1,
    runId,
    mode: active.mode,
    task: active.task,
    startedAt: active.startedAt,
    finishedAt,
    durationMs,
    ...intent,
  }
  const candidatePath = join(paths.finishing, `${runId}.${randomUUID()}.tmp`)
  await writeFile(candidatePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  await safeChmod(candidatePath)
  try {
    await link(candidatePath, claimPath)
  } catch (error) {
    if (!existsSync(claimPath)) throw error
    const claimed = await readRecord(claimPath)
    assertSameIntent(claimed, intent)
  } finally {
    await unlinkIfPresent(candidatePath)
  }
  try { await rename(claimPath, completedPath) } catch (error) {
    if (!existsSync(completedPath)) throw error
  }
  const completed = await readRecord(completedPath)
  assertSameIntent(completed, intent)
  await unlinkIfPresent(activePath)
  process.stdout.write(`${JSON.stringify(completed)}\n`)
}

async function listRuns(paths, args) {
  const modeRaw = one(args, 'mode')
  const mode = modeRaw === undefined ? undefined : selected(modeRaw, 'mode', MODES)
  const limitRaw = one(args, 'limit') ?? '12'
  const limit = Number(limitRaw)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be an integer from 1 to 100')
  let files
  try { files = await readdir(paths.completed) } catch (error) {
    if (error?.code === 'ENOENT') { process.stdout.write('[]\n'); return }
    throw error
  }
  const records = []
  for (const file of files.filter(file => file.endsWith('.json'))) {
    records.push(await readRecord(join(paths.completed, file)))
  }
  records.sort((left, right) => left.finishedAt.localeCompare(right.finishedAt) || left.runId.localeCompare(right.runId))
  const selectedRecords = records.filter(record => mode === undefined || record.mode === mode).slice(-limit)
  process.stdout.write(`${JSON.stringify(selectedRecords, null, 2)}\n`)
}

async function main() {
  const [command, ...argv] = process.argv.slice(2)
  if (!['start', 'finish', 'list'].includes(command)) {
    throw new Error('usage: mode-learning.mjs <start|finish|list> [options]')
  }
  const root = repositoryRoot(process.cwd())
  const base = join(root, '.artifacts', 'dsh-feature-delivery')
  const paths = {
    base,
    active: join(base, 'active'),
    finishing: join(base, 'finishing'),
    completed: join(base, 'completed'),
  }
  const args = parseArguments(argv)
  rejectUnknownOptions(args, command)
  if (command === 'start') await startRun(paths, args)
  else if (command === 'finish') await finishRun(paths, args)
  else await listRuns(paths, args)
}

main().catch(error => fail(error instanceof Error ? error.message : String(error)))

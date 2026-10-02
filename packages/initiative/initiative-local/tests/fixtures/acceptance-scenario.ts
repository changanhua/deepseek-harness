import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import type { InitiativePage, InitiativeReceipt } from '@changanhua/dsh-initiative'
import { planningBoardSchema } from '@changanhua/dsh-planning'
import { workspaceCandidatesSchema } from '../../src/spec.ts'
import { assessmentRecordSchema } from '../../../../requirement-assessment/requirement-assessment-local/src/spec.ts'
import { candidateReviewSource } from '../../src/assessment.ts'
import type { RunResult } from '@deepseek-ai/dsh-sdk-client'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'

interface OwnerDocument { tables: { workspaces: Record<string, unknown>; boards: Record<string, unknown> } }

export const observation = {
  source: 'Actual fresh-checkout verification performed by external Codex, 2026-10-02',
  checkout: 'f4fb5aa16441ba7aac94b22770d74feb36240943 plus RIR input integration',
  command: 'pnpm exec vitest run packages/initiative/initiative-local/tests/initiative.spec.ts packages/requirement-assessment',
  outcome: 'exit 1; four suites failed during import, twelve other tests passed',
  error: "Cannot find package '@deepseek-ai/node-addon-system/flock' imported from packages/session/session-persistence-jsonl/src/lease.ts",
  followUp: 'The host-addon-only native script exits successfully on Windows but does not build the JavaScript entry. pnpm -C native/system run build:ts created the entry; focused verification then passed 34 tests.',
  limits: 'This is one observed setup failure. It does not establish frequency, a flock runtime defect, or a need for a new capability.',
}

/** External controller drives the shipped SDK profile and checks owner files after process exit. */
export async function runAcceptance(root: string, environment: NodeJS.ProcessEnv, mode: 'keyless' | 'paid') {
  if (mode === 'paid' && (environment.DSH_INITIATIVE_REAL_ACCEPTANCE !== 'approved' || !environment.DEEPSEEK_API_KEY?.trim()))
    throw new Error('Real-provider acceptance requires explicit approval and an available credential')
  const endpoint = environment.DEEPSEEK_BASE_URL?.replace(/\/+$/u, '') ?? 'https://api.deepseek.com'
  if (mode === 'paid' && endpoint !== 'https://api.deepseek.com') throw new Error('Unapproved provider endpoint')
  if (mode === 'keyless' && (environment.DEEPSEEK_API_KEY !== 'keyless-fixture-only' || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(endpoint)))
    throw new Error('Keyless acceptance requires the dummy credential and loopback fixture')
  const sourceFiles = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
    'packages/initiative', 'packages/requirement-assessment'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean).sort()
  const sourceHash = createHash('sha256')
  for (const path of sourceFiles) { sourceHash.update(path).update('\0').update(await readFile(path)).update('\0') }
  const builtFiles = ['apps/cli/lib/bin.js', 'packages/initiative/initiative-local/lib/index.js',
    'packages/initiative/command-initiative/lib/index.js', 'packages/initiative/tool-initiative/lib/index.js',
    'packages/requirement-assessment/requirement-assessment-review/lib/index.js',
    'packages/requirement-assessment/requirement-assessment-local/lib/index.js']
  const builtHashes = Object.fromEntries(await Promise.all(builtFiles.map(async (path): Promise<[string, string]> => [path,
    createHash('sha256').update(await readFile(path)).digest('hex')])))
  const sourceIdentity = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    trackedDiffSha256: createHash('sha256').update(execFileSync('git', ['diff', 'HEAD', '--binary'])).digest('hex'),
    sourceSha256: sourceHash.digest('hex'), builtHashes,
  }
  const cwd = join(root, 'workspace'), home = join(root, 'home'), evidenceRoot = join(root, 'evidence')
  await mkdir(cwd, { recursive: true }); await mkdir(evidenceRoot, { recursive: true })
  const patch = join(root, 'acceptance.patch.yml')
  const observer = pathToFileURL(fileURLToPath(new URL('./acceptance-observer.mjs', import.meta.url))).href
  const moduleUrl = (path: string) => pathToFileURL(resolve(path, 'lib/index.js')).href
  const rows = [
    { id: 'sdk-jsonrpc-server', inject: ['sdkAppStartup', 'loader', 'initiativeAcceptanceReady'] },
    { id: 'typert-loader', disabled: true }, { id: 'typert-gateway', disabled: true },
    { id: 'storage-domain', isolate: { 'storage.backend.json': 'web-storage' }, config: { backend: 'json' } },
    { id: 'session-projection-cache', disabled: true },
    { id: 'agent-instructions', disabled: true }, { id: 'skill-filesystem', disabled: true },
    { id: 'system-prompt', config: { includeRuntimeContext: false,
      personaPrefix: 'You are a coding agent powered by the {{model}} model.',
      personaSuffix: 'This acceptance uses an isolated Workspace. Only initiative_read and initiative_record are available; all other tools are denied.' } },
    { id: 'llm-deepseek', config: { thinking: 'disabled', retryPolicy: { mode: 'normal', maxRetries: 0 } } },
    { id: 'session-title-llm', disabled: true },
    { insert: [
      { name: moduleUrl('packages/workspace/workspace') },
      { name: moduleUrl('packages/planning/planning-local'), config: { ownershipRoot: join(root, 'planning-owner') } },
      { name: moduleUrl('packages/initiative/initiative-local'), config: { ownershipRoot: join(root, 'initiative-owner'), operatorId: 'acceptance-human' } },
      { name: moduleUrl('packages/initiative/command-initiative') }, { name: moduleUrl('packages/initiative/tool-initiative') },
      { name: moduleUrl('packages/requirement-assessment/requirement-assessment-local'), config: { ownershipRoot: join(root, 'assessment-owner') } },
      { name: moduleUrl('packages/requirement-assessment/requirement-assessment-review'), config: {
        provider: 'deepseek-official', model: 'deepseek-flash',
        dshBaseline: JSON.stringify(sourceIdentity), maxInputBytes: 65536, maxOutputBytes: 200000,
        maxOutputTokens: 8000, timeoutMs: 120000 } },
      { name: observer, config: { cwd, evidenceRoot, mode, endpoint, provider: 'deepseek-official', model: 'deepseek-flash',
        maxRequests: 9, maxCandidateRequests: 8, maxInputBytes: 65536, maxOutputTokens: 8000 } },
    ] },
  ]
  await writeFile(patch, JSON.stringify(rows))
  const create = () => new DeepSeekHarness({ dshBin: 'apps/cli/lib/bin.js', profile: 'sdk', patches: [patch], dshHome: home, cwd,
    processCwd: process.cwd(), provider: 'deepseek-official', model: 'deepseek-flash', maxTokens: 4096,
    initializeTimeoutMs: 60000, env: { ...environment, DSH_TELEMETRY_DISABLED: '1' } })
  let harness = create()
  const sessions: RunResult[] = []
  const attempts: Array<{
    sessionId: string
    input: string
    notifications: HarnessNotification[]
    status: string
    failureCode?: string
  }> = []
  const commands: unknown[] = []
  let humanSessionId = 'human-command-session'
  const run = async (input: string, sessionId: string): Promise<RunResult> => {
    const attempt: (typeof attempts)[number] = { sessionId, input, notifications: [], status: 'started' }
    attempts.push(attempt)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        harness.run(input, { sessionId, onNotification: value => attempt.notifications.push(value) }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() =>{  reject(new Error('Acceptance activity timeout')) }, 180000) }),
      ])
      sessions.push(result)
      const end = result.events.findLast(value => value.type === 'turn/end')
      const expected = input.startsWith('/initiative ') ? 'blocked' : 'completed'
      if (end?.type !== 'turn/end' || end.data.reason.kind !== expected)
        throw new Error('Acceptance activity did not reach its expected successful turn boundary')
      attempt.status = 'completed'; return result
    } catch (error) {
      attempt.status = 'failed'; attempt.failureCode = error instanceof Error ? error.name : 'unknown'
      throw error
    }
    finally { if (timer !== undefined) clearTimeout(timer) }
  }
  const human = async <T>(input: unknown): Promise<T> => {
    const line = `/initiative ${JSON.stringify(input)}`
    await run(line, humanSessionId)
    const execution = JSON.parse(await readFile(join(evidenceRoot, 'command-result.json'), 'utf8')) as { input: string; result: { kind: string; text: string } }
    commands.push({ input, execution })
    if (execution.input !== line || execution.result.kind !== 'success')
      throw new Error('Acceptance Human command failed; inspect retained evidence')
    return JSON.parse(execution.result.text) as T
  }
  try {
    const prompt = `Analyse this observed failure and its follow-up result. Explain the cause, existing solution, counter-evidence and smallest useful response. Do not edit files or execute shell commands.\n${JSON.stringify(observation)}`
    await writeFile(join(evidenceRoot, 'observation.json'), JSON.stringify(observation, null, 2))
    const caseB = await run(prompt, 'case-b-session')
    const page = await human<InitiativePage>({ action: 'read', proposer: 'agent' })
    const entry = page.entries[0]
    if (!entry || entry.candidate.proposer.kind !== 'agent')
      throw new Error('Case B did not produce an Agent Candidate; no Human substitute is allowed')
    const candidate = entry.candidate
    const proposeCalls = caseB.events.filter(value => value.type === 'tool/call' && value.data.name === 'initiative_record')
    const proven = proposeCalls.some((call) => {
      if (call.type !== 'tool/call') return false
      const args = JSON.parse(call.data.arguments) as { input_json: string }
      if ((JSON.parse(args.input_json) as { action?: unknown }).action !== 'propose') return false
      return caseB.events.some(event => event.type === 'tool/result' && event.data.message.content.some(block =>
        block.type === 'tool-result' && block.toolCallId === call.data.callId && !block.isError
        && block.content.some(value => value.type === 'text' && (JSON.parse(value.text) as { id?: unknown }).id === candidate.id)))
    })
    if (!proven || candidate.proposer.sessionId !== caseB.sessionId)
      throw new Error('Agent Candidate lacks the matching successful model Tool call and owner receipt')
    const ready = await human<InitiativeReceipt>({ action: 'investigate', key: 'human-r2', id: candidate.id,
      expectedRecordVersion: candidate.recordVersion, expectedVersion: candidate.headVersion,
      facts: entry.revision.facts, completion: 'complete' })
    const assessmentCommand = { action: 'assess', key: 'rir-fixed-r2', id: candidate.id, version: ready.headVersion }
    const assessed = await human<InitiativeReceipt>(assessmentCommand)
    const readAssessments = async () => {
      const document = JSON.parse(await readFile(join(home, 'storages', 'requirement_assessments.json'), 'utf8')) as OwnerDocument
      return Object.values(document.tables.workspaces).map(value => assessmentRecordSchema.parse(value))
    }
    const originalAssessment = (await readAssessments()).flatMap(value => value.assessments)
      .find(value => value.id === assessed.assessmentId)
    if (!originalAssessment) throw new Error('Committed Assessment is missing from owner storage')
    const fresh = await human<InitiativePage>({ action: 'read', id: candidate.id })
    if (fresh.entries[0]?.rir.assessments.find(value => value.id === assessed.assessmentId)?.state !== 'fresh')
      throw new Error('Assessment was not fresh at its exact Candidate revision')
    const refined = await human<InitiativeReceipt>({ action: 'investigate', key: 'human-r3', id: candidate.id,
      expectedRecordVersion: ready.recordVersion, expectedVersion: ready.headVersion,
      facts: { ...entry.revision.facts, uncertainties: [...entry.revision.facts.uncertainties.slice(0, 29), 'Human follow-up: frequency remains unmeasured.'] }, completion: 'complete' })
    const drift = await human<InitiativePage>({ action: 'read', id: candidate.id })
    if (drift.entries[0]?.rir.assessments.find(value => value.id === assessed.assessmentId)?.state !== 'drift')
      throw new Error('Candidate refinement did not expose Assessment drift')
    const promotion = { action: 'promote', key: 'human-selected-promotion', id: candidate.id,
      expectedRecordVersion: refined.recordVersion, expectedVersion: refined.headVersion, assessmentId: assessed.assessmentId,
      rationale: 'Explicit Human selection for pending Proposal review; the older Assessment remains tied to its fixed Candidate revision.' }
    const promoted = await human<InitiativeReceipt>(promotion)
    await harness.close()
    const beforeRestart = JSON.parse(await readFile(join(evidenceRoot, 'requests.json'), 'utf8')) as unknown[]
    const httpBeforeRestart = JSON.parse(await readFile(join(evidenceRoot, 'http-attempts.json'), 'utf8')) as unknown[]
    harness = create()
    humanSessionId = 'human-command-session-restarted'
    const replayedAssessment = await human<InitiativeReceipt>(assessmentCommand)
    const replayedPromotion = await human<InitiativeReceipt>(promotion)
    if (JSON.stringify(replayedAssessment) !== JSON.stringify(assessed) || JSON.stringify(replayedPromotion) !== JSON.stringify(promoted))
      throw new Error('Restart receipts changed')
    await harness.close()
    const requests = JSON.parse(await readFile(join(evidenceRoot, 'requests.json'), 'utf8')) as unknown[]
    const httpAttempts = JSON.parse(await readFile(join(evidenceRoot, 'http-attempts.json'), 'utf8')) as unknown[]
    if (requests.length !== beforeRestart.length) throw new Error('Restart replay consumed another model request')
    if (httpAttempts.length !== httpBeforeRestart.length) throw new Error('Restart replay dispatched another provider HTTP attempt')
    const candidateStore = JSON.parse(await readFile(join(home, 'storages', 'initiative_candidates.json'), 'utf8')) as OwnerDocument
    const assessmentStore = JSON.parse(await readFile(join(home, 'storages', 'requirement_assessments.json'), 'utf8')) as OwnerDocument
    const planningStore = JSON.parse(await readFile(join(home, 'storages', 'planning_boards.json'), 'utf8')) as OwnerDocument
    const storedCandidate = Object.values(candidateStore.tables.workspaces).map(value => workspaceCandidatesSchema.parse(value))
      .flatMap(value => value.candidates).find(value => value.id === candidate.id)
    const storedAssessment = (await readAssessments()).flatMap(value => value.assessments)
      .find(value => value.id === assessed.assessmentId)
    const boards = Object.values(planningStore.tables.boards).map(value => planningBoardSchema.parse(value))
    const board = boards.find(value => value.workspaceId === candidate.workspaceId)
    const proposal = board?.proposals.find(value => value.id === promoted.proposalId)
    if (!storedCandidate || !storedAssessment || !board || !proposal) throw new Error('Independent owner verification is incomplete')
    if (JSON.stringify(storedAssessment) !== JSON.stringify(originalAssessment))
      throw new Error('Fixed Assessment changed after refinement or restart')
    const captured = candidateReviewSource(storedCandidate, ready.headVersion)
    if (JSON.stringify(captured.subject) !== JSON.stringify(storedAssessment.subject)
      || captured.text !== storedAssessment.actualInput.text)
      throw new Error('Stored Assessment does not match immutable owner contents')
    if (storedCandidate.status !== 'PROMOTED' || storedCandidate.promotion?.phase !== 'linked'
      || storedCandidate.promotion.assessment?.id !== storedAssessment.id
      || JSON.stringify(storedCandidate.promotion.assessment.baseline) !== JSON.stringify(storedAssessment.baseline)
      || proposal.status !== 'pending' || board.items.length !== 0 || board.handoffs.length !== 0 || board.reviews.length !== 0)
      throw new Error('Pending-only promotion or selected baseline invariant failed')
    const refs = proposal.generations[0]?.draft.stateEntries?.flatMap(value => value.sourceRefs ?? []) ?? []
    const baselineDigest = createHash('sha256').update(JSON.stringify(storedAssessment.baseline)).digest('hex')
    if (!refs.some(value => value.kind === 'requirement-assessment' && value.id === storedAssessment.id)
      || !refs.some(value => value.kind === 'requirement-assessment-baseline' && value.id === storedAssessment.id && value.revision === baselineDigest))
      throw new Error('Proposal lost selected Assessment provenance')
    const report = { mode, liveModelAcceptance: mode === 'paid' ? 'requires request and tool-event review' : 'not claimed', sourceIdentity, observation, caseB, commands, sessions, requests, httpAttempts,
      ownerReads: { candidateStore, assessmentStore, planningStore }, assessed, promoted, fresh, drift,
      restartRequestCount: requests.length }
    await writeFile(join(evidenceRoot, 'report.json'), JSON.stringify(report, null, 2))
    return report
  } finally {
    try { await harness.close() }
    finally { await writeFile(join(evidenceRoot, 'all-attempts.json'), JSON.stringify({ mode, sourceIdentity, attempts, sessions, commands }, null, 2)) }
  }
}

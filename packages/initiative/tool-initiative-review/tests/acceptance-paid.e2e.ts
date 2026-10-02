import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { it, expect } from 'vitest'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { workspaceSchema } from '../src/spec.ts'
import { workspaceCandidatesSchema } from '../../initiative-local/src/spec.ts'
import { planningBoardSchema } from '@changanhua/dsh-planning'

interface OwnerDocument { tables: { workspaces: Record<string, unknown>; boards: Record<string, unknown> } }

it.skipIf(process.env.DSH_REVIEW_REAL_ACCEPTANCE !== 'approved' || !process.env.DEEPSEEK_API_KEY)(
  'lets a real authorized Agent choose no-op, enrich and create from Planning outcomes', { timeout: 600000, retry: 0 }, async () => {
    const endpoint = process.env.DEEPSEEK_BASE_URL?.replace(/\/+$/u, '') ?? 'https://api.deepseek.com'
    if (endpoint !== 'https://api.deepseek.com') throw new Error('Acceptance permits only the public DeepSeek endpoint')
    const root = await mkdtemp(join(tmpdir(), 'dsh-review-paid-'))
    console.info(`Review real-provider evidence: ${root}`)
    const cwd = join(root, 'workspace'), home = join(root, 'home'), evidenceRoot = join(root, 'evidence')
    await mkdir(cwd); await mkdir(evidenceRoot)
    const moduleUrl = (path: string) => pathToFileURL(resolve(path, 'lib/index.js')).href
    const patch = join(root, 'acceptance.patch.yml')
    await writeFile(patch, JSON.stringify([
      { id: 'sdk-jsonrpc-server', inject: ['sdkAppStartup', 'loader', 'reviewAcceptanceReady'] },
      { id: 'typert-loader', disabled: true }, { id: 'typert-gateway', disabled: true },
      { id: 'storage-domain', isolate: { 'storage.backend.json': 'web-storage' }, config: { backend: 'json' } },
      { id: 'session-projection-cache', disabled: true }, { id: 'session-title-llm', disabled: true },
      { id: 'agent-instructions', disabled: true }, { id: 'skill-filesystem', disabled: true },
      { id: 'llm-deepseek', config: { thinking: 'disabled', retryPolicy: { mode: 'normal', maxRetries: 0 } } },
      { insert: [
        { name: moduleUrl('packages/workspace/workspace') },
        { name: moduleUrl('packages/planning/planning-local'), config: { ownershipRoot: join(root, 'planning-owner') } },
        { name: moduleUrl('packages/initiative/initiative-local'), config: { ownershipRoot: join(root, 'candidate-owner'), operatorId: 'acceptance-human' } },
        { name: moduleUrl('packages/initiative/command-initiative') },
        { name: moduleUrl('packages/initiative/tool-initiative-review'), config: { ownershipRoot: join(root, 'review-owner') } },
        { name: pathToFileURL(fileURLToPath(new URL('./fixtures/observer.mjs', import.meta.url))).href,
          config: { cwd, evidenceRoot, endpoint,
            restrictionUrl: pathToFileURL(resolve('packages/initiative/tool-initiative-review/lib/restrict.js')).href } },
      ] },
    ]))
    const binary = 'packages/initiative/tool-initiative-review/lib/index.js'
    await writeFile(join(evidenceRoot, 'build.json'), JSON.stringify({ binary, sha256: createHash('sha256').update(await readFile(binary)).digest('hex') }))
    const harness = new DeepSeekHarness({ dshBin: 'apps/cli/lib/bin.js', profile: 'sdk', patches: [patch], dshHome: home, cwd,
      processCwd: process.cwd(), provider: 'deepseek-official', model: 'deepseek-flash', maxTokens: 4096,
      initializeTimeoutMs: 60000, env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' } })
    const turns: unknown[] = []
    try {
      await harness.start()
      const input = JSON.parse(await readFile(join(evidenceRoot, 'inputs.json'), 'utf8')) as {
        reviews: Array<{ id: string; expected: string }>
        candidate: { id: string }
        workspaceId: string
      }
      const selected = input.reviews.filter(review => !process.env.DSH_REVIEW_ACCEPTANCE_CASE
        || process.env.DSH_REVIEW_ACCEPTANCE_CASE === review.expected)
      expect(selected.length).toBeGreaterThan(0)
      for (const review of selected) {
        const notifications: HarnessNotification[] = []
        const result = await harness.run(`Read Planning Review ${review.id}. Compare its outcome with existing Candidates and evidence, then decide whether anything deserves action. Save your decision and rationale using the available Review tools. Do not manufacture work to produce an output.`,
          { sessionId: `review-${randomUUID()}`, onNotification: value => notifications.push(value) })
        turns.push({ reviewId: review.id, expected: review.expected, events: result.events, notifications })
        await writeFile(join(evidenceRoot, 'turns.json'), JSON.stringify(turns))
        const end = result.events.findLast(event => event.type === 'turn/end')
        expect(end?.type === 'turn/end' && end.data.reason.kind).toBe('completed')
        expect(result.events.some(event => event.type === 'tool/call' && event.data.name === 'initiative_review_decide')).toBe(true)
        const decisionCalls = result.events.filter(event => event.type === 'tool/call' && event.data.name === 'initiative_review_decide')
        expect(result.events.some(event => event.type === 'tool/result' && event.data.error === undefined
          && event.sourceEventSeqs?.some(seq => decisionCalls.some(call => call.seq === seq)))).toBe(true)
      }
      // Controller reads owner bytes, rather than trusting the model's final answer.
      const decisions = JSON.parse(await readFile(join(home, 'storages', 'initiative_review_decisions.json'), 'utf8')) as OwnerDocument
      const candidates = JSON.parse(await readFile(join(home, 'storages', 'initiative_candidates.json'), 'utf8')) as OwnerDocument
      const planning = JSON.parse(await readFile(join(home, 'storages', 'planning_boards.json'), 'utf8')) as OwnerDocument
      const before: unknown = JSON.parse(await readFile(join(evidenceRoot, 'planning-before.json'), 'utf8'))
      const state = workspaceSchema.parse(decisions.tables.workspaces[input.workspaceId])
      for (const review of selected) expect(state.reviews[review.id]?.at(-1)).toMatchObject({ phase: 'committed', decision: { kind: review.expected } })
      const actual = workspaceCandidatesSchema.parse(candidates.tables.workspaces[input.workspaceId]).candidates
      expect(actual).toHaveLength(selected.some(review => review.expected === 'create') ? 2 : 1)
      expect(actual.find(candidate => candidate.id === input.candidate.id)?.headVersion).toBe(selected.some(review => review.expected === 'enrich') ? 2 : 1)
      const after = planningBoardSchema.parse(planning.tables.boards[input.workspaceId])
      const { receipts: _receipts, ...publicBoard } = after
      expect(publicBoard).toEqual(before)
      await writeFile(join(evidenceRoot, 'result.json'), JSON.stringify({ passed: true, cases: selected.map(review => review.expected), candidateCount: actual.length }))
    } finally { await harness.close() }
  },
)

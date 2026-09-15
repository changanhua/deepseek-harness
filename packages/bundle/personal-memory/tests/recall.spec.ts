import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MemoryMutation, MemoryProposal } from '@changanhua/dsh-memory'
import { createMemoryHarness } from '../../../memory/memory-local/tests/harness.ts'

interface RecallCase {
  id: string
  state: 'usable' | 'changed' | 'expired' | 'conflicted' | 'withdrawn' | 'foreign' | 'foreign-session' | 'escape'
  kind: 'fact' | 'method'
  topicKey: string
  title: string
  statement: string
  tags: string[]
  query: string
  expected: { eligibility?: string; error?: string; recall: boolean }
}

const fixtureBytes = await readFile(new URL('./fixtures/recall-cases.json', import.meta.url), 'utf8')
const cases = JSON.parse(fixtureBytes) as RecallCase[]
const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const observedAt = '2030-01-01T00:00:02.000Z'
const identities = new Map<string, MemoryMutation>()
const admissionErrors = new Map<string, unknown>()
const observations: Array<{ caseId: string; expectedRecall: boolean; found: boolean; returned: string[] }> = []

describe('fixed project memory recall and invalidation evaluation', () => {
  let memory: Awaited<ReturnType<typeof createMemoryHarness>>
  let alpha: Agent
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime('2030-01-01T00:00:00.000Z')
    memory = await createMemoryHarness()
    alpha = memory.agent('alpha')
    const betaRoot = join(memory.root, 'beta')
    await mkdir(betaRoot)
    await memory.ctx.workspaceRegistry.create(betaRoot)
    const beta = memory.agent('beta', betaRoot)
    for (const item of cases) {
      const actor = item.state === 'foreign' ? beta : alpha
      const directory = item.state === 'foreign' ? betaRoot : memory.cwd
      const path = `${item.id}.md`
      const sourceText = `${item.title}\n${item.statement}\n`
      await writeFile(join(directory, path), sourceText)
      let sources: MemoryProposal['sources'] = [{ kind: 'file', path }]
      if (item.state === 'foreign-session') {
        const event = beta.session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: item.statement }], source: { kind: 'user' },
        }), { surfaceOp: 'append' })
        await memory.ctx.sessions.flush(beta.session)
        sources = [{ kind: 'session-event', sessionId: beta.session.id, seq: event.seq }]
      }
      if (item.state === 'escape') {
        await writeFile(join(memory.root, 'outside.md'), item.statement)
        sources = [{ kind: 'file', path: '../outside.md' }]
      }
      const proposal: MemoryProposal = {
        topicKey: item.topicKey, kind: item.kind, title: item.title, statement: item.statement,
        tags: item.tags, conditions: '', sources, idempotencyKey: item.id,
      }
      if (item.state === 'foreign-session' || item.state === 'escape') {
        try { identities.set(item.id, await memory.ctx.projectMemory.propose(actor, proposal)) }
        catch (error) { admissionErrors.set(item.id, (error as { code?: unknown }).code) }
        continue
      }
      const candidate = await memory.ctx.projectMemory.propose(actor, proposal)
      const reviewAfter = item.state === 'expired' ? '2030-01-01T00:00:01.000Z' : undefined
      let accepted = await memory.ctx.projectMemory.decide(actor, {
        id: candidate.id, revision: 1, expectedVersion: 1, action: 'accept',
        commandId: memory.human(actor, `accept ${candidate.id}@1${reviewAfter === undefined ? '' : ` --review-after ${reviewAfter}`}`),
        ...reviewAfter === undefined ? {} : { reviewAfter },
      })
      if (item.state === 'changed') await writeFile(join(directory, path), '该来源已替换，原规则不再成立。')
      if (item.state === 'withdrawn') {
        accepted = await memory.ctx.projectMemory.decide(actor, {
          id: candidate.id, revision: 1, expectedVersion: 2, action: 'retire',
          commandId: memory.human(actor, `retire ${candidate.id}@1`),
        })
      }
      identities.set(item.id, accepted)
    }
    // These valid records share common project vocabulary with target queries,
    // but their facts concern unrelated work. They must not crowd out the targets.
    for (let index = 0; index < 20; index++) {
      const path = `noise-${index}.md`
      const text = `项目历史归档 ${index}：会议纪要的归档编号是 archive-${index}。`
      await writeFile(join(memory.cwd, path), text)
      const candidate = await memory.ctx.projectMemory.propose(alpha, {
        topicKey: `archive.${index}`, kind: 'fact', title: `项目历史归档 ${index}`, statement: text,
        tags: ['归档'], conditions: '', sources: [{ kind: 'file', path }], idempotencyKey: `noise-${index}`,
      })
      await memory.ctx.projectMemory.decide(alpha, {
        id: candidate.id, revision: 1, expectedVersion: 1, action: 'accept',
        commandId: memory.human(alpha, `accept ${candidate.id}@1`),
      })
    }
    vi.setSystemTime(observedAt)
  })

  afterAll(async () => {
    try { await memory?.dispose() }
    finally { vi.useRealTimers() }
  })

  it('keeps the twenty-case requirements and interference set explicit', () => {
    expect(cases).toHaveLength(20)
    expect(new Set(cases.map(item => item.id)).size).toBe(20)
    expect(cases.filter(item => item.state === 'usable')).toHaveLength(10)
    expect(cases.filter(item => ['changed', 'expired'].includes(item.state))).toHaveLength(4)
    expect(cases.filter(item => ['conflicted', 'withdrawn'].includes(item.state))).toHaveLength(3)
    expect(cases.filter(item => ['foreign', 'foreign-session', 'escape'].includes(item.state))).toHaveLength(3)
  })

  it.each(cases)('$id obeys its external eligibility and scope expectation', async (item) => {
    const identity = identities.get(item.id)
    if (item.state === 'foreign-session' || item.state === 'escape') {
      expect(admissionErrors.get(item.id)).toBe(item.expected.error)
      expect(identity).toBeUndefined()
    } else {
      if (identity === undefined) throw new Error(`fixture ${item.id} did not create its record`)
      if (item.expected.error !== undefined) {
        await expect(memory.ctx.projectMemory.read(alpha, identity.id)).rejects.toMatchObject({ code: item.expected.error })
      } else {
        const read = await memory.ctx.projectMemory.read(alpha, identity.id)
        expect(read.eligibility).toBe(item.expected.eligibility)
        if (!item.expected.recall) {
          expect(read).not.toHaveProperty('memory')
          expect(read.sources.every(source => source.preview === undefined)).toBe(true)
        }
      }
    }
    const result = await memory.ctx.projectMemory.search(alpha, { query: item.query, limit: 5 })
    const found = result.items.some(value => value.id === identity?.id)
    observations.push({ caseId: item.id, expectedRecall: item.expected.recall, found, returned: result.items.map(value => value.id) })
    if (!item.expected.recall) {
      expect(found).toBe(false)
      expect(JSON.stringify(result.items)).not.toContain(item.statement)
    }
    for (const returned of result.items) {
      expect(returned).toMatchObject({ eligibility: 'usable', revision: 1, checkedAt: observedAt })
      expect(returned.memory?.revision).toBe(returned.revision)
      expect(returned.sources.length).toBeGreaterThan(0)
      expect(returned.sources.every(source => source.status === 'current' && /^[a-f0-9]{64}$/u.test(source.source.sha256))).toBe(true)
    }
  })

  it('meets Recall@5 and records the measured deterministic result without claiming model benefit', async () => {
    const usable = observations.filter(value => value.expectedRecall)
    const hits = usable.filter(value => value.found).length
    const sourceFiles = ['index', 'scope', 'sources', 'search', 'store', 'ownership'].map(name => `packages/memory/memory-local/src/${name}.ts`)
    sourceFiles.push('packages/memory/memory/src/schema.ts')
    const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (path): Promise<[string, string]> => [
      path, createHash('sha256').update(await readFile(join(repo, path))).digest('hex'),
    ])))
    const directory = join(repo, '.artifacts/project-memory')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'recall-evaluation.json'), JSON.stringify({
      kind: 'deterministic', fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'), sourceHashes,
      controlledClock: observedAt, interferenceRecords: 20, cases: observations,
      recallAt5: hits / usable.length, usableHits: hits, usableCases: usable.length,
      invalidOrForeignReturned: observations.filter(value => !value.expectedRecall && value.found).length,
      modelCalls: 0, liveModelBenefit: 'not evaluated',
    }, null, 2))
    expect(observations).toHaveLength(20)
    expect(usable).toHaveLength(10)
    expect(hits).toBeGreaterThanOrEqual(9)
  })
})

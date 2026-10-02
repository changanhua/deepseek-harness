import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { initiativeCommandSchema } from '@changanhua/dsh-initiative'
import { boot, investigate, promotion, propose } from './harness.ts'
import { acquireInitiativeOwnership } from '../src/ownership.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
async function setup() { const harness = await boot(); cleanup.push(harness.dispose); return harness }

function openTurn(h: Awaited<ReturnType<typeof boot>>) {
  h.session.append('turn/start', { turn: 1 })
}

describe('Initiative real Loader, Commands, Tools and durable owners', () => {
  it('runs Human intake, refinement, exact-version pending promotion and restart retry through Commands', async () => {
    let h = await setup()
    const originalRoot = h.root
    const before = await h.ctx.planning.snapshot(h.access())
    const created = await h.humanOK(propose())
    expect(created.status).toBe('PROPOSED')
    expect(await h.humanOK(propose())).toEqual(created)
    const first = (await h.read(created.id)).entries[0]!
    expect(first.candidate.proposer).toMatchObject({ kind: 'human', id: 'local-human' })
    expect(typeof first.candidate.proposer.commandId).toBe('string')
    expect(first.candidate.origin[0]).toMatchObject({ owner: 'session', revision: String(first.candidate.proposer.eventSeq), verification: 'unverified' })
    const refined = await h.humanOK(investigate(created))
    expect((await h.read(created.id, 1)).entries[0]).toMatchObject({ drift: true, revision: { facts: { claim: 'Reduce manual checks' } }, rir: { availability: 'unavailable', assessments: [] } })
    const current = (await h.read(created.id)).entries[0]!
    expect(current.candidate).not.toHaveProperty('revisions')
    expect(current.revisionCount).toBe(2)
    expect(current.revision.facts.evidenceRefs).toHaveLength(1)
    expect(current.revision.facts.counterEvidenceRefs).toHaveLength(1)
    expect(current.candidate.origin).toEqual(first.candidate.origin)
    expect(await h.ctx.planning.snapshot(h.access())).toEqual(before)
    const command = promotion(refined)
    const promoted = await h.humanOK(command)
    const board = await h.ctx.planning.snapshot(h.access())
    expect(board.proposals).toHaveLength(1)
    expect(board.proposals[0]).toMatchObject({ id: promoted.proposalId, status: 'pending', generations: [{ draft: { stateEntries: [{ sourceRefs: [{ kind: 'initiative-candidate', id: created.id, revision: '2' }] }] } }] })
    expect(board.items).toEqual(before.items)
    expect(board.handoffs).toEqual(before.handoffs)
    expect(board.lanes).toEqual(before.lanes)
    expect(board.version).toBe(before.version + 1)
    await h.close()
    h = await boot(originalRoot)
    cleanup.push(h.close)
    expect(await h.humanOK(command)).toEqual(promoted)
    expect((await h.read(created.id)).entries[0]!.candidate).toMatchObject({ status: 'PROMOTED', promotion: { phase: 'linked', proposalId: promoted.proposalId } })
    expect((await h.ctx.planning.snapshot(h.access())).proposals).toHaveLength(1)
    expect(JSON.parse(await readFile(join(h.root, 'storage', 'initiative_candidates.json'), 'utf8'))).toBeTruthy()
  })

  it('records Agent initiative through scoped tools without granting authority or accepting fake Human identity', async () => {
    const h = await setup(); openTurn(h)
    const tools = h.ctx.tools.schemas(h.agent).map(value => value.name)
    const proposed = await h.tool(propose())
    expect(proposed.isError).toBe(false)
    const candidate = (await h.read()).entries[0]!.candidate
    expect(candidate.proposer).toMatchObject({ kind: 'agent', id: h.agent.id, sessionId: h.session.id })
    expect(h.ctx.tools.schemas(h.agent).map(value => value.name)).toEqual(tools)
    expect(tools.sort()).toEqual(['initiative_read', 'initiative_record'])
    expect((await h.tool({ ...propose('fake'), actor: { kind: 'human' } })).isError).toBe(true)
    const result = { id: candidate.id, recordVersion: candidate.recordVersion,
      headVersion: candidate.headVersion, status: candidate.status }
    await expect(h.ctx.initiative.execute(h.agent, promotion(result))).rejects.toMatchObject({ code: 'unauthorized' })
    for (const status of ['DEFERRED', 'DROPPED']) {
      const command = initiativeCommandSchema.parse({ action: 'disposition', key: status, id: result.id,
        expectedRecordVersion: 1, expectedVersion: 1, status, rationale: 'recommendation cannot settle' })
      await expect(h.ctx.initiative.execute(h.agent, command)).rejects.toMatchObject({ code: 'unauthorized' })
    }
    const blocked = initiativeCommandSchema.parse({ ...investigate(result), completion: 'blocked', blockedReason: 'Existing owner requires approval', recommendation: 'defer' })
    expect((await h.tool(blocked)).isError).toBe(false)
    expect((await h.read(result.id)).entries[0]).toMatchObject({ candidate: { status: 'INVESTIGATING' },
      investigations: [{ completion: 'blocked', recommendation: 'defer' }] })
    expect((await h.ctx.planning.snapshot(h.access())).proposals).toEqual([])
    expect(h.ctx.get('delivery')).toBeUndefined()
  })

  it('checks CAS, append-only history, lineage, lifecycle and idempotency', async () => {
    const h = await setup()
    const a = await h.humanOK(propose())
    expect((await h.human({ ...propose(), trigger: 'changed payload' })).text).toContain('idempotency-conflict')
    const b = await h.humanOK({ ...propose('child'), parents: [a.id] })
    expect((await h.read(b.id)).entries[0]!.candidate.parents).toEqual([a.id])
    const disposition = (status: string, base = a, key = status) => ({ action: 'disposition', key, id: base.id, expectedVersion: base.headVersion, expectedRecordVersion: base.recordVersion, status, rationale: 'Human decision' })
    const deferred = await h.humanOK(disposition('DEFERRED'))
    const reopened = await h.humanOK(disposition('INVESTIGATING', deferred))
    const dropped = await h.humanOK(disposition('DROPPED', reopened))
    expect((await h.human(disposition('INVESTIGATING', dropped, 'reopen-dropped'))).kind).toBe('error')
    expect((await h.human(investigate(a))).kind).toBe('error')
    const update = investigate(b)
    const [one, two] = await Promise.all([h.human(update), h.human({ ...update, key: 'race' })])
    expect([one.kind, two.kind].sort()).toEqual(['error', 'success'])
    expect((await h.read(b.id, 1)).entries[0]!.revision.facts.claim).toBe('Reduce manual checks')
    expect((await h.humanOK(update)).headVersion).toBe(2)
  })

  it('recovers after Planning commit but before Candidate link and reserves the key across failures', async () => {
    let h = await setup()
    const created = await h.humanOK(propose())
    const assessed = await h.humanOK(investigate(created))
    const command = promotion(assessed)
    const table = h.ctx.storageDomain.get('initiative_candidates')!.table('workspaces')
    const put = table.put.bind(table)
    let writes = 0
    vi.spyOn(table, 'put').mockImplementation(async (...args) => {
      if (++writes === 2) throw new Error('injected link crash')
      return put(...args)
    })
    await expect(h.human(command)).rejects.toThrow('injected link crash')
    expect((await h.ctx.planning.snapshot(h.access())).proposals).toHaveLength(1)
    expect((await h.human(propose('promote'))).text).toContain('idempotency-conflict')
    const root = h.root; await h.close(); h = await boot(root); cleanup.push(h.close)
    expect((await h.humanOK(command)).status).toBe('PROMOTED')
    expect((await h.ctx.planning.snapshot(h.access())).proposals).toHaveLength(1)
  })

  it('rejects stale Agent scope and excludes concurrent local writers', async () => {
    const h = await setup(); openTurn(h)
    const original = h.ctx.sessions.flush.bind(h.ctx.sessions)
    vi.spyOn(h.ctx.sessions, 'flush').mockImplementationOnce(async (session) => { h.unregister(); return original(session) })
    await expect(h.ctx.initiative.execute(h.agent, propose())).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(acquireInitiativeOwnership(join(h.root, 'initiative-owner'))).rejects.toMatchObject({ code: 'conflict' })
    await h.close()
    const owner = await acquireInitiativeOwnership(join(h.root, 'initiative-owner')); await owner.release()
  })
})

describe('Initiative failure windows and denied authority', () => {
  it('keeps a failed prepare atomic and recovers a prepared intent after restart', async () => {
    let h = await setup()
    const assessed = await h.humanOK(investigate(await h.humanOK(propose())))
    const command = promotion(assessed)
    const table = h.ctx.storageDomain.get('initiative_candidates')!.table('workspaces')
    vi.spyOn(table, 'put').mockRejectedValueOnce(new Error('prepare failed'))
    await expect(h.human(command)).rejects.toThrow('prepare failed')
    expect((await h.read(assessed.id)).entries[0]!.candidate.promotion).toBeUndefined()
    expect((await h.ctx.planning.snapshot(h.access())).proposals).toHaveLength(0)
    vi.spyOn(h.ctx.planning, 'execute').mockRejectedValueOnce(new Error('before Planning'))
    await expect(h.human(command)).rejects.toThrow('before Planning')
    expect((await h.read(assessed.id)).entries[0]!.candidate.promotion?.phase).toBe('prepared')
    expect((await h.human({ ...command, rationale: 'changed' })).text).toContain('idempotency-conflict')
    expect((await h.human({ ...investigate(assessed), key: 'while-prepared' })).kind).toBe('error')
    const root = h.root; await h.close(); h = await boot(root); cleanup.push(h.close)
    expect((await h.humanOK(command)).status).toBe('PROMOTED')
    expect((await h.ctx.planning.snapshot(h.access())).proposals).toHaveLength(1)
  })

  it('recovers a definite Planning CAS conflict without changing the original Candidate request', async () => {
    const h = await setup()
    const a = await h.humanOK(investigate(await h.humanOK(propose())))
    const command = promotion(a)
    const execute = h.ctx.planning.execute.bind(h.ctx.planning)
    vi.spyOn(h.ctx.planning, 'execute').mockImplementationOnce(async (access, input, signal) => {
      if (input.kind !== 'propose') throw new Error('unexpected Planning action')
      await execute(access, { ...input, requestId: 'concurrent-human', proposalId: 'other-proposal' }, signal)
      return execute(access, input, signal)
    })
    expect((await h.human(command)).text).toContain('retry the same Candidate key')
    expect((await h.humanOK(command)).status).toBe('PROMOTED')
    expect((await h.ctx.planning.snapshot(h.access())).proposals).toHaveLength(2)
  })

  it('links the original Proposal even if Planning dismissed it before recovery', async () => {
    let h = await setup()
    const a = await h.humanOK(investigate(await h.humanOK(propose())))
    const command = promotion(a)
    const table = h.ctx.storageDomain.get('initiative_candidates')!.table('workspaces')
    const put = table.put.bind(table); let writes = 0
    vi.spyOn(table, 'put').mockImplementation(async (...args) => { if (++writes === 2) throw new Error('link lost'); return put(...args) })
    await expect(h.human(command)).rejects.toThrow('link lost')
    const board = await h.ctx.planning.snapshot(h.access())
    await h.ctx.planning.execute(h.access(), { kind: 'dismiss-proposal', requestId: 'dismiss', expectedBoardVersion: board.version, proposalId: board.proposals[0]!.id, expectedProposalVersion: 1 })
    const root = h.root; await h.close(); h = await boot(root); cleanup.push(h.close)
    expect((await h.humanOK(command)).proposalId).toBe(board.proposals[0]!.id)
    expect((await h.ctx.planning.snapshot(h.access())).proposals).toMatchObject([{ status: 'dismissed' }])
  })

  it('admits only one of two concurrent promotions and rejects fake command authority', async () => {
    const h = await setup()
    const a = await h.humanOK(investigate(await h.humanOK(propose())))
    const results = await Promise.all([h.human(promotion(a)), h.human(promotion(a, 'other-key'))])
    expect(results.map(result => result.kind).sort()).toEqual(['error', 'success'])
    expect((await h.ctx.planning.snapshot(h.access())).proposals).toHaveLength(1)
    await expect(h.ctx.initiative.execute(h.agent, propose('fake'), { commandId: 'invented' })).rejects.toMatchObject({ code: 'unauthorized' })
    const finishedId = h.session.events.find(event => event.type === 'command/run')!
    if (finishedId.type !== 'command/run') throw new Error('missing command')
    await expect(h.ctx.initiative.execute(h.agent, propose(), { commandId: finishedId.data.commandId })).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('rejects a changed Workspace, closed turn, malformed locator and forged verified evidence', async () => {
    const h = await setup(); openTurn(h)
    const command = propose()
    expect((await h.tool({ ...command, sourceRefs: [{ owner: 'session', kind: 'event', id: 'fake', verification: 'verified' }] })).isError).toBe(true)
    h.session.append('turn/end', { status: 'completed' } as never)
    await expect(h.ctx.initiative.execute(h.agent, command)).rejects.toMatchObject({ code: 'unauthorized' })
    openTurn(h)
    const flush = h.ctx.sessions.flush.bind(h.ctx.sessions)
    vi.spyOn(h.ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
      await h.ctx.workspaceRegistry.delete(h.workspace.id)
      return flush(session)
    })
    await expect(h.ctx.initiative.execute(h.agent, command)).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('rejects flush failure and a cancelled call before Candidate commit', async () => {
    const h = await setup(); openTurn(h)
    vi.spyOn(h.ctx.sessions, 'flush').mockRejectedValueOnce(new Error('durability unavailable'))
    await expect(h.ctx.initiative.execute(h.agent, propose())).rejects.toThrow('durability unavailable')
    const aborted = AbortSignal.abort(new Error('cancelled'))
    await expect(h.ctx.initiative.execute(h.agent, propose(), {}, aborted)).rejects.toThrow('cancelled')
    expect((await h.read()).total).toBe(0)
  })

  it('bounds the complete persisted record before creating a Planning side effect', async () => {
    let h = await setup()
    const a = await h.humanOK(investigate(await h.humanOK(propose())))
    const bytes = Buffer.byteLength(JSON.stringify(h.ctx.storageDomain.get('initiative_candidates')!.table('workspaces').get(h.workspace.id)))
    const root = h.root; await h.close(); h = await boot(root, bytes + 500); cleanup.push(h.close)
    expect((await h.human(promotion(a))).text).toContain('capacity-exceeded')
    expect((await h.ctx.planning.snapshot(h.access())).proposals).toHaveLength(0)
    expect((await h.read(a.id)).entries[0]!.candidate.promotion).toBeUndefined()
  })
})

describe('Initiative model contract and registration lifecycle', () => {
  it('pins the assembled guidance and schemas and removes both entries on Loader disposal', async () => {
    const h = await setup()
    const assembly = await h.ctx.systemPrompt.assemble({ scope: h.agent })
    await expect(JSON.stringify({ sections: assembly.sections, tools: h.ctx.tools.schemas(h.agent) }, null, 2) + '\n')
      .toMatchFileSnapshot('./expected/model-contract.json')
    const entries = [...h.ctx.loader.entries()].filter(entry => ['@changanhua/dsh-command-initiative', '@changanhua/dsh-tool-initiative'].includes(entry.options.name))
    expect(entries).toHaveLength(2)
    for (const entry of entries) await entry.parent.tree.remove(entry.options.id)
    expect(h.ctx.commands.find(h.agent, 'initiative')).toBeUndefined()
    expect(h.ctx.tools.schemas(h.agent)).toEqual([])
    expect((await h.ctx.systemPrompt.assemble({ scope: h.agent })).sections.some(value => value.name === 'tool:initiative')).toBe(false)
    for (const entry of entries) await h.ctx.loader.create({ name: entry.options.name })
    await h.ctx.loader.await()
    expect(h.ctx.commands.list(h.agent).filter(value => value.name === 'initiative')).toHaveLength(1)
    expect(h.ctx.tools.schemas(h.agent)).toHaveLength(2)
    const a = await h.humanOK(propose())
    const snapshot = await h.read(a.id)
    snapshot.entries[0]!.candidate.trigger = 'tampered caller copy'
    expect((await h.read(a.id)).entries[0]!.candidate.trigger).toBe('Observed repeated work')
  })
})


it('refuses an otherwise valid oversized revision before persistence and keeps accepted single views readable', async () => {
  const h = await setup()
  const large = initiativeCommandSchema.parse({ ...propose('too-big'),
    facts: { claim: 'Valid schema but oversized view', assumptions: Array.from({ length: 30 }, () => 'x'.repeat(4000)) } })
  expect((await h.human(large)).text).toContain('readable view limit')
  expect((await h.read()).total).toBe(0)
  const accepted = await h.humanOK({ ...propose('bounded'), facts: { claim: 'Bounded view', assumptions: ['x'.repeat(4000)] } })
  const result = await h.read(accepted.id)
  expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(64 * 1024)
  expect(result.entries[0]?.revision.facts.assumptions[0]).toHaveLength(4000)
})

import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createTransportGuard } from '../../../initiative-local/tests/fixtures/acceptance-transport.mjs'

export const name = 'review-acceptance-observer'
export const inject = ['llm', 'tools', 'commands', 'sessions', 'agents', 'workspaceRegistry', 'planning', 'initiative']
export async function apply(ctx, config) {
  if (process.env.DSH_REVIEW_REAL_ACCEPTANCE !== 'approved' || !process.env.DEEPSEEK_API_KEY)
    throw new Error('Real Review acceptance requires approval and credentials')
  await mkdir(config.evidenceRoot, { recursive: true })
  const transport = await createTransportGuard({ ...config, maxRequests: 12, maxCandidateRequests: 12, model: 'deepseek-flash' })
  const previousFetch = globalThis.fetch; globalThis.fetch = transport.fetch
  ctx.effect(() => () => { if (globalThis.fetch === transport.fetch) globalThis.fetch = previousFetch })
  let ordinal = 0
  ctx.on('llm/stream', async function* (options, next) {
    if (options.provider !== 'deepseek-official' || options.model !== 'deepseek-flash') throw new Error('Unexpected model route')
    if (JSON.stringify((options.tools ?? []).map(tool => tool.name).sort()) !== JSON.stringify(['initiative_review_decide', 'initiative_review_read']))
      throw new Error('Review acceptance requires exactly two model tools before spending')
    const request = { ordinal: ++ordinal, phase: 'candidate' }
    await writeFile(join(config.evidenceRoot, `model-input-${ordinal}.json`), JSON.stringify({ ...options, signal: undefined }))
    const iterator = next()[Symbol.asyncIterator]()
    try {
      while (true) {
        const part = await transport.withRequest(request, () => iterator.next())
        if (part.done) break
        yield part.value
      }
    } finally { if (iterator.return) await transport.withRequest(request, () => iterator.return()) }
  }, { prepend: true })
  const workspace = await ctx.workspaceRegistry.create(config.cwd)
  const access = { workspaceId: workspace.id, actorId: 'acceptance-controller', kind: 'human', authorize() {} }
  const session = ctx.sessions.create('review-fixture-human', { meta: { cwd: config.cwd } })
  const agent = { id: session.id, session, ctx, status: 'idle', options: {}, reserveTurnAdmission: () => () => {} }
  const unregister = ctx.agents.register(agent)
  let candidate
  try {
    const result = await ctx.commands.execute(agent, '/initiative ' + JSON.stringify({ action: 'propose', key: 'review-existing',
      kind: 'simplify', trigger: 'Repeated manual retry checks', facts: { claim: 'Reduce the repeated manual retry checks for delivery verification.' } }), [], new AbortController().signal)
    if (result?.result.kind !== 'success') throw new Error('Candidate fixture admission failed')
    candidate = JSON.parse(result.result.text)
  } finally { unregister() }
  const reviews = []
  for (const [expected, summary] of [
    ['no-op', 'The obsolete duplicate validation was removed. All acceptance checks passed, users confirm no remaining manual steps, and no follow-up issue remains. This review has no uncovered problem.'],
    ['enrich', `Investigation of the repeated manual retry checks tracked by Candidate ${candidate.id} found new evidence that changes its next step: the existing verify-delivery command already performs all required checks, but the operator guide omits its --resume option. Two controlled retries with --resume completed without manual checks. The Candidate currently has only a broad claim and no evidence. This supports narrowing its investigation to documentation and contradicts adding another retry mechanism. These new findings are not recorded in the Candidate; no separate problem was found.`],
    ['create', 'Three independent completion reviews reported that the recovery guide omits the restore-verification step. Existing Candidates concern delivery retry checks, not recovery documentation. Current documentation search found no restore-verification guidance. Operators had to reconstruct the procedure each time. The evidence supports investigating a small documentation correction, not adding a new runtime.'],
  ]) {
    const board = await ctx.planning.snapshot(access)
    const itemId = `acceptance-${randomUUID()}`
    const item = await ctx.planning.execute(access, { kind: 'create', requestId: itemId, expectedBoardVersion: board.version,
      itemId, title: 'Reported outcome', intent: 'Evaluate a bounded reported outcome', scope: [], acceptance: [],
      sources: [{ kind: 'manual', text: 'Isolated acceptance scenario supplied by the controller; not a claim about production frequency.' }],
      estimate: { value: 1, urgency: 1, reuse: 1, compounding: 1, timeCost: 1, tokenCost: 1, risk: 1, cognitiveCost: 1, rationale: 'fixture' } })
    const result = await ctx.planning.execute(access, { kind: 'review', requestId: `review-${itemId}`, expectedBoardVersion: item.boardVersion,
      itemId, expectedRevisionId: item.revisionId, outcome: 'learned', summary, lessons: [], followUpItemIds: [], acceptanceRef: null })
    reviews.push({ id: result.reviewId, expected })
  }
  await writeFile(join(config.evidenceRoot, 'inputs.json'), JSON.stringify({ reviews, candidate, workspaceId: workspace.id }))
  await writeFile(join(config.evidenceRoot, 'planning-before.json'), JSON.stringify(await ctx.planning.snapshot(access)))
  // SDK creates Host-composed Agents; mount the shipped restriction directly for this isolated profile.
  await ctx.plugin(await import(config.restrictionUrl))
  ctx.provide('reviewAcceptanceReady', true)
}

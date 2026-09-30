import { afterEach, describe, expect, it } from 'vitest'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { createPlanningHarness } from '../../planning-local/tests/harness.ts'
import * as PlanningTools from '../src/index.ts'
import { parseRead } from '../src/input.ts'
import { planningAgentAccess } from '../src/scope.ts'
import LocalDelivery from '@changanhua/dsh-delivery-local'
import PlanningDelivery from '../../planning-delivery-bridge/src/index.ts'
import PlanningRemote from '../../planning-remote/src/index.ts'
import { projectDeliverySnapshot } from '../../../delivery/delivery-remote/src/projection.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})

async function harness() {
  const local = await createPlanningHarness()
  cleanups.push(local.dispose)
  await local.ctx.plugin(AgentRegistry)
  await local.ctx.plugin(SystemPrompt)
  await local.ctx.plugin(ToolRuntime)
  const fiber = await local.ctx.plugin(PlanningTools)
  const caller = { id: local.session.id, session: local.session, ctx: local.ctx } as unknown as Agent
  local.ctx.agents.register(caller)
  local.session.append('turn/start', { turn: 1 })
  local.session.append(
    'user/message',
    createUserMessage({ content: [{ type: 'text', text: 'Please maintain this plan.' }], source: { kind: 'user' } }),
    { surfaceOp: 'append' },
  )
  await local.ctx.sessions.flush(local.session)
  let calls = 0
  const call = (name: string, arguments_: unknown, bound = true) =>
    local.ctx.tools.execute({
      name,
      arguments: arguments_,
      callId: ToolCallId(`planning-tool-${++calls}`),
      signal: new AbortController().signal,

      ...(bound ? { agent: caller } : {}),
    })
  return { ...local, fiber, caller, call }
}

function json(result: { content: readonly { type: string; text?: string }[] }) {
  const text = result.content[0]?.text
  if (text === undefined) throw new Error('tool did not return text')
  return JSON.parse(text) as Record<string, unknown>
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

describe('project planning model tools', () => {
  it('projects the bound subject and original revision into durable prompt context and only permits proposals', async () => {
    const local = await harness()
    const created = await local.ctx.planning.execute(local.access(), local.create('bound-root'))
    await local.ctx.planning.execute(local.access(), { kind: 'bind-session', requestId: 'binding',
      expectedBoardVersion: created.boardVersion, subject: { kind: 'plan', id: created.itemId! },
      baseRevision: created.revisionId!, sessionId: String(local.session.id) })
    const assembly = await local.ctx.systemPrompt.assemble({ scope: local.caller })
    const context = assembly.contexts.find(value => value.name === 'planning-workspace')
    expect(JSON.parse(context!.text)).toMatchObject({ binding: { baseRevision: created.revisionId,
      subject: { kind: 'plan', id: created.itemId } }, current: { accepted: [], open: [] } })
    expect(context!.text).not.toContain('Please maintain this plan')
    const result = await local.call('planning_update', { command: { kind: 'archive', requestId: 'not-allowed',
      expectedBoardVersion: 2, itemId: created.itemId } })
    expect(result.isError).toBe(true)
    const pack = await local.call('planning_context', { kind: 'plan', id: created.itemId })
    expect(pack.isError).toBe(false)
    expect(json(pack)).toMatchObject({ plan: { id: created.itemId, revision: created.revisionId } })
  })
  it('reads execution from the existing Delivery projection without treating handoff as execution', async () => {
    const local = await harness()
    await local.ctx.plugin(LocalDelivery)
    const bridge = await local.ctx.plugin(PlanningDelivery, {
      routes: [{ workspacePath: local.workspace.path, repositoryId: 'planning-repo' }],
    })
    local.ctx.provide('deliveryRemote', {
      snapshot: () => projectDeliverySnapshot(local.ctx.delivery.snapshot(), [], []),
    })
    await local.ctx.plugin(PlanningRemote)
    const created = json(await local.call('planning_update', { command: local.create('execution-read') }))
    await local.call('planning_handoff', { item_id: created.item_id, expected_revision_id: created.revision_id })
    const result = await local.call('planning_execution', { item_id: created.item_id })
    expect(result.isError).toBe(false)
    expect(json(result)).toMatchObject({
      available: true,
      rows: [{ revision_id: created.revision_id, stage: 'shaping', packet_id: null }],
    })
    expect(
      (await local.call('planning_execution', { item_id: created.item_id, packet_id: 'foreign-packet' })).isError,
    ).toBe(true)
    expect(
      (await local.call('planning_execution', { item_id: created.item_id, evidence_id: 'unrelated-evidence' })).isError,
    ).toBe(true)
    expect(local.ctx.delivery.snapshot().dispatchBindings).toEqual([])
    await bridge.dispose()
    expect(local.ctx.tools.get('planning_execution')).toBeUndefined()
  })
  it('reads review provenance and atomically accepts its proposed follow-up', async () => {
    const local = await harness()
    const created = json(await local.call('planning_update', { command: local.create('review-source') }))
    const reviewed = json(
      await local.call('planning_update', {
        command: {
          kind: 'review',
          requestId: 'review-result',
          expectedBoardVersion: created.board_version,
          itemId: created.item_id,
          expectedRevisionId: created.revision_id,
          outcome: 'learned',
          summary: 'Keep the original source',
          lessons: ['Retain exact evidence before handoff'],
          followUpItemIds: [],
          acceptanceRef: null,
        },
      }),
    )
    const reviewPage = json(await local.call('planning_read', { item_id: created.item_id, section: 'reviews' }))
    expect(reviewPage).toMatchObject({
      values: [{ id: reviewed.review_id, source: { kind: 'session-event', sessionId: local.session.id } }],
    })
    const seed = local.create('unused')
    if (seed.kind !== 'create') throw new Error('invalid fixture')
    const { title, intent, scope, acceptance, sources, estimate, reviewAt } = seed
    const proposed = await local.call('planning_update', {
      propose: {
        request_id: 'followup-draft',
        expected_board_version: reviewed.board_version,
        proposal_id: 'followup',
        expected_proposal_version: null,
        target_item_id: null,
        base_revision_id: null,
        from_review_id: reviewed.review_id,
        suggested_lane: 'next',
        assumptions: ['Suggested next step'],
        draft: { title, intent, scope, acceptance, sources, estimate, reviewAt },
      },
    })
    expect(proposed.isError).toBe(false)
    expect(json(await local.call('planning_read', { proposal_id: 'followup' }))).toMatchObject({
      proposal: { from_review_id: reviewed.review_id },
    })
    const accepted = json(
      await local.call('planning_update', {
        accept_proposal: {
          request_id: 'followup-accepted',
          expected_board_version: json(proposed).board_version,
          proposal_id: 'followup',
          expected_proposal_version: 1,
        },
      }),
    )
    const after = await local.ctx.planning.snapshot(local.access())
    expect(after.reviews[0]?.followUpItemIds).toEqual([accepted.item_id])
    expect(after.items).toHaveLength(2)
  })
  it('exposes handoff only with its provider, freezes an exact revision, and unloads reversibly', async () => {
    const local = await harness()
    expect(local.ctx.tools.get('planning_handoff')).toBeUndefined()
    await local.ctx.plugin(LocalDelivery)
    const bridge = await local.ctx.plugin(PlanningDelivery, {
      routes: [{ workspacePath: local.workspace.path, repositoryId: 'planning-repo' }],
    })
    expect(local.ctx.tools.get('planning_handoff')).toBeDefined()
    const created = json(await local.call('planning_update', { command: local.create('handoff-plan') }))
    const input = { item_id: created.item_id, expected_revision_id: created.revision_id }
    const first = await local.call('planning_handoff', input)
    expect(first.isError).toBe(false)
    expect(json(first)).toMatchObject({ item_id: created.item_id, revision_id: created.revision_id, phase: 'linked' })
    expect((await local.call('planning_handoff', input)).content).toEqual(first.content)
    expect(local.ctx.delivery.snapshot().deliveryCases).toHaveLength(1)
    expect(local.ctx.delivery.snapshot().dispatchBindings).toHaveLength(0)
    expect((await local.call('planning_handoff', { ...input, workspace_id: 'foreign' })).isError).toBe(true)
    await bridge.dispose()
    expect(local.ctx.tools.get('planning_handoff')).toBeUndefined()
    expect(
      (await local.ctx.systemPrompt.assemble()).sections.some(section => section.name === 'tool:planning-handoff'),
    ).toBe(false)
  })
  it.each([
    { item_id: 'item', cursor: -1 },
    { item_id: 'item', limit: 51 },
    { item_id: 'item', section: 'assumptions' },
  ])('rejects invalid item read pagination or section', (input) => {
    expect(() => parseRead(input)).toThrow()
  })

  it('admits normal item section pagination', () => {
    expect(parseRead({ item_id: 'item', section: 'scope', cursor: 4, limit: 10 })).toEqual({
      itemId: 'item',
      section: 'scope',
      cursor: 4,
      limit: 10,
    })
  })

  it('expires an Agent access when its open turn ends or changes', async () => {
    const { caller } = await harness()
    const access = await planningAgentAccess(caller.ctx, caller)
    await expect(access.authorize()).resolves.toBeUndefined()
    caller.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await expect(access.authorize()).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('exposes complete proposal commands and proposal list/read selectors to the model', async () => {
    const { ctx } = await harness()
    const list = ctx.tools.get('planning_list')!
    const read = ctx.tools.get('planning_read')!
    const update = ctx.tools.get('planning_update')!
    const listParameters: unknown = list.parameters
    const readParameters: unknown = read.parameters
    const updateParameters: unknown = update.parameters
    if (!record(listParameters) || !record(listParameters.properties)) throw new Error('list schema is unavailable')
    if (!record(readParameters) || !record(readParameters.properties)) throw new Error('read schema is unavailable')
    if (!record(updateParameters) || !record(updateParameters.properties)) throw new Error('update schema is unavailable')
    expect(listParameters.properties.kind).toMatchObject({ enum: ['items', 'proposals'] })
    expect(readParameters.properties.proposal_id).toBeDefined()
    expect(readParameters.properties.proposal_version).toBeDefined()
    expect(updateParameters.properties.propose).toBeDefined()
    expect(updateParameters.properties.accept_proposal).toBeDefined()
    expect(updateParameters.properties.dismiss_proposal).toBeDefined()
    const parameters: unknown = update.parameters
    if (!record(parameters) || !record(parameters.properties)) throw new Error('planning parameters are unavailable')
    const command = parameters.properties.command
    if (!record(command) || !Array.isArray(command.oneOf)) throw new Error('planning command schema lacks oneOf')
    const commands = command.oneOf.filter(record)
    const kind = (branch: Record<string, unknown>) => {
      if (!record(branch.properties) || !record(branch.properties.kind) || typeof branch.properties.kind.const !== 'string') return undefined
      return branch.properties.kind.const
    }
    const revise = commands.find(branch => kind(branch) === 'revise')
    const move = commands.find(branch => kind(branch) === 'move')
    if (!record(revise) || !record(revise.properties) || !Array.isArray(revise.required)) throw new Error('revise schema is unavailable')
    if (!record(move) || !record(move.properties) || !Array.isArray(move.required)) throw new Error('move schema is unavailable')
    const sources = revise.properties.sources
    const estimate = revise.properties.estimate
    if (!record(sources) || !record(estimate)) throw new Error('revise fields are unavailable')
    if (!record(sources.items) || !Array.isArray(sources.items.oneOf) || !Array.isArray(estimate.required)) {
      throw new Error('revise field schemas are unavailable')
    }
    expect(revise.required).toEqual(expect.arrayContaining(['itemId', 'expectedRevisionId', 'sources', 'estimate']))
    expect(sources.items.oneOf).toHaveLength(4)
    expect(estimate.required).toContain('tokenCost')
    expect(move.required).toEqual(expect.arrayContaining(['itemId', 'lane', 'beforeItemId']))
    expect(move.properties.lane).toMatchObject({ enum: ['inbox', 'now', 'next', 'later', 'parking'] })
  })

  it('lists, writes, and reads one current-project card through the real local Provider', async () => {
    const { call, create } = await harness()
    expect(json(await call('planning_list', {}))).toMatchObject({
      board_version: 0,
      items: [],
      current_user_source: { kind: 'session-event', sessionId: 'planning-session' },
    })
    const written = await call('planning_update', { command: create('tool-create') })
    expect(written.isError).toBe(false)
    const receipt = json(written)
    const listed = await call('planning_list', {})
    expect(listed.isError).toBe(false)
    expect(json(listed)).toMatchObject({
      board_version: 1,
      items: [{ item_id: 'provider-plan', lane: 'inbox', source_kinds: ['session-event'] }],
    })
    const read = await call('planning_read', { item_id: 'provider-plan', revision_id: receipt.revision_id })
    expect(read.isError).toBe(false)
    expect(json(read)).toMatchObject({
      board_version: 1,
      item: { item_id: 'provider-plan', revision: { id: receipt.revision_id }, truncated: true },
    })
    expect(
      json(
        await call('planning_read', { item_id: 'provider-plan', revision_id: receipt.revision_id, section: 'sources' }),
      ),
    ).toMatchObject({
      section: 'sources',
      values: [
        { kind: 'session-event', sessionId: 'planning-session', seq: 0, verification: 'verified' },
        { kind: 'session-event', sessionId: 'planning-session', seq: 2, verification: 'verified' },
      ],
    })
    expect(JSON.stringify(read.content)).not.toContain('receipts')
  })

  it('derives workspace and actor only from a live registered Agent', async () => {
    const { call } = await harness()
    expect((await call('planning_list', { workspace_id: 'foreign' })).isError).toBe(true)
    expect((await call('planning_list', {}, false)).isError).toBe(true)
  })

  it('keeps an identical request key idempotent across model retries', async () => {
    const { call, create } = await harness()
    const first = await call('planning_update', { command: create('retry-key') })
    const second = await call('planning_update', { command: create('retry-key') })
    expect(second.content).toEqual(first.content)
    expect(json(await call('planning_list', {}))).toMatchObject({
      board_version: 1,
      items: [{ item_id: 'provider-plan' }],
    })
  })

  it('removes tools and guidance when its fiber unloads', async () => {
    const { ctx, caller, fiber } = await harness()
    expect(
      ctx.tools
        .schemas(caller)
        .map(tool => tool.name)
        .sort(),
    ).toEqual(['planning_context', 'planning_list', 'planning_read', 'planning_update'])
    expect((await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'tool:planning')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas(caller)).toEqual([])
    expect((await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'tool:planning')).toBe(false)
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryRecord } from '@changanhua/dsh-memory'
import { memoryHistory } from '../../memory/tests/fixtures.ts'
import * as Companion from '../src/invariant.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
async function observer() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(Companion)
  return ctx
}
const changed = (value: MemoryRecord, extra: Partial<DomainChanged> = {}): DomainChanged => ({
  domain: 'project_memory', table: 'memories', operation: 'put', key: value.id, value, ...extra,
}) as DomainChanged

describe('durable memory history invariants', () => {
  it('allows append-only decisions and ignores other domains', async () => {
    const ctx = await observer()
    const history = memoryHistory()
    expect(() => { ctx.emit('domain/changed', changed(history[0], { domain: 'another-domain', value: null })) }).not.toThrow()
    for (const record of history) expect(() => { ctx.emit('domain/changed', changed(record)) }).not.toThrow()
  })

  it.each(['wrong-table', 'deleted', 'invalid-value', 'wrong-key'])('refuses malformed domain writes: %s', async (kind) => {
    const ctx = await observer()
    const first = memoryHistory()[0]
    const extra = kind === 'wrong-table' ? { table: 'other' }
      : kind === 'deleted' ? { operation: 'deleted' as const }
        : kind === 'wrong-key' ? { key: 'foreign-key' } : { value: {} }
    expect(() => { ctx.emit('domain/changed', changed(first, extra)) }).toThrow('invariant violated')
  })

  it.each(['workspace', 'topic', 'version-gap', 'claim', 'receipt', 'decision'])('rejects an altered committed prefix: %s', async (kind) => {
    const ctx = await observer()
    const [candidate, accepted, renewed] = memoryHistory()
    const before = kind === 'version-gap' ? candidate : accepted
    const next = structuredClone(renewed)
    if (kind === 'workspace') next.workspaceId = 'another-project'
    if (kind === 'topic') next.topicKey = 'another-topic'
    if (kind === 'claim') next.revisions[0]!.statement = 'silently replaced claim'
    if (kind === 'receipt') next.receipts[0]!.digest = 'b'.repeat(64)
    if (kind === 'decision') next.decisions[0]!.sessionId = 'different-human-session'
    ctx.emit('domain/changed', changed(before))
    expect(() => { ctx.emit('domain/changed', changed(next)) }).toThrow('invariant violated')
  })
})

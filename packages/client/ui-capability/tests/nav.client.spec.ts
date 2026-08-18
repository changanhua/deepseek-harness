// @vitest-environment jsdom
/**
 * CapabilityNavEntry badge behavior: the badge shows the total count of
 * Skills + MCP servers + Tools when a snapshot is ready, and hides when
 * empty or not yet loaded.
 */
import { describe, expect, it } from 'vitest'
import { badgeFor } from '../src/client/CapabilityNavEntry.tsx'
import type { CapabilityStoreSnapshot } from '../src/client/store.ts'

function snapshot(
  status: CapabilityStoreSnapshot['status'],
  data: { skills: unknown[]; mcpServers: unknown[]; tools: unknown[] } | undefined,
): CapabilityStoreSnapshot {
  return {
    status,
    error: null,
    sessionId: 's1' as never,
    snapshot: data === undefined ? undefined : { sessionId: 's1' as never, ...data } as never,
  }
}

describe('CapabilityNavEntry badgeFor', () => {
  it('shows the total count when the snapshot is ready and non-empty', () => {
    const badge = badgeFor(snapshot('ready', { skills: [{}, {}], mcpServers: [{}], tools: [{}, {}, {}] }))
    expect(badge?.text).toBe('6')
  })

  it('hides when the snapshot is ready but empty', () => {
    expect(badgeFor(snapshot('ready', { skills: [], mcpServers: [], tools: [] }))).toBeUndefined()
  })

  it('hides while loading', () => {
    expect(badgeFor(snapshot('loading', undefined))).toBeUndefined()
  })

  it('hides on error', () => {
    expect(badgeFor(snapshot('error', undefined))).toBeUndefined()
  })
})

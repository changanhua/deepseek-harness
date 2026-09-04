// @vitest-environment jsdom
/**
 * CapabilityStore behavior: load/retry/reset cycle, error fallback, and
 * generation guard against stale responses.
 */
import { describe, expect, it, vi } from 'vitest'
import { CapabilityStore, type CapabilityRemoteFace } from '../src/client/store.ts'
import type { CapabilitySnapshot } from '@changanhua/dsh-host-capability-registry/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'

const S1 = 's1' as SessionId
const S2 = 's2' as SessionId

function makeSnapshot(): CapabilitySnapshot {
  return {
    sessionId: S1,
    skills: [{ name: 'skill-a', description: 'A', invocation: { modelInvocable: true, userInvocable: true }, source: 'user-dsh', provider: 'filesystem', selected: true }],
    mcpServers: [{ id: 'mcp-1' as never, serverName: 'github', transport: 'stdio', registeredTools: 2 }],
    tools: [{ name: 'mcp__github__create_issue', description: 'Create issue' }, { name: 'bash', description: 'Run bash' }],
  }
}

function makeRemote(value: CapabilitySnapshot, opts?: { failOnce?: boolean }): CapabilityRemoteFace & { calls: number } {
  let calls = 0
  return {
    calls,
    async list() {
      calls += 1
      if (opts?.failOnce === true && calls === 1) {
        return { ok: false, error: { code: 'boom', message: 'failed', details: {} } }
      }
      return { ok: true, value }
    },
  } as CapabilityRemoteFace & { calls: number }
}

describe('CapabilityStore', () => {
  it('loads a snapshot and reports ready', async () => {
    const remote = makeRemote(makeSnapshot())
    const store = new CapabilityStore(remote)
    await store.load(S1)
    const snap = store.getSnapshot()
    expect(snap.status).toBe('ready')
    expect(snap.snapshot?.skills).toHaveLength(1)
    expect(snap.snapshot?.mcpServers).toHaveLength(1)
    expect(snap.snapshot?.tools).toHaveLength(2)
    store.dispose()
  })

  it('reports error when the remote fails', async () => {
    const remote = makeRemote(makeSnapshot(), { failOnce: true })
    const store = new CapabilityStore(remote)
    await store.load(S1)
    const snap = store.getSnapshot()
    expect(snap.status).toBe('error')
    expect(snap.error).toContain('failed')
    store.dispose()
  })

  it('retry re-reads with the same sessionId after an error', async () => {
    const remote = makeRemote(makeSnapshot(), { failOnce: true })
    const store = new CapabilityStore(remote)
    await store.load(S1)
    expect(store.getSnapshot().status).toBe('error')
    await store.retry()
    expect(store.getSnapshot().status).toBe('ready')
    store.dispose()
  })

  it('reset drops the snapshot and addressing slot', async () => {
    const remote = makeRemote(makeSnapshot())
    const store = new CapabilityStore(remote)
    await store.load(S1)
    store.reset()
    const snap = store.getSnapshot()
    expect(snap.status).toBe('idle')
    expect(snap.snapshot).toBeUndefined()
    expect(snap.sessionId).toBeUndefined()
    store.dispose()
  })

  it('a stale response from a superseded load does not overwrite the current snapshot', async () => {
    let resolveFirst: (v: { ok: true; value: CapabilitySnapshot }) => void = () => {}
    const first = new Promise<{ ok: true; value: CapabilitySnapshot }>((r) => { resolveFirst = r })
    const slowSnapshot: CapabilitySnapshot = { sessionId: S1, skills: [], mcpServers: [], tools: [] }
    const fastSnapshot: CapabilitySnapshot = { sessionId: S2, skills: [{ name: 'x', description: 'x', invocation: { modelInvocable: true, userInvocable: true }, source: 's', provider: 'p', selected: true }], mcpServers: [], tools: [] }
    const remote: CapabilityRemoteFace = {
      async list(req) {
        if (req.sessionId === S1) return first
        return { ok: true, value: fastSnapshot }
      },
    }
    const store = new CapabilityStore(remote)
    void store.load(S1) // starts but does not resolve
    await store.load(S2) // supersedes s1
    expect(store.getSnapshot().sessionId).toBe('s2')
    // Now resolve the stale s1 load 鈥?it must not overwrite s2.
    resolveFirst({ ok: true, value: slowSnapshot })
    await vi.waitFor(() => {})
    expect(store.getSnapshot().sessionId).toBe('s2')
    expect(store.getSnapshot().snapshot?.skills[0]?.name).toBe('x')
    store.dispose()
  })
})

import type { Context } from '@deepseek-ai/cordis'

/** Test-only safe owner: the smoke proves profile composition and CLI authority shaping. */
export function apply(ctx: Context): void {
  const workspace = { id: 'workspace-1' }
  ctx.provide('workspaceRegistry', { get: (id: string) => id === workspace.id ? workspace : undefined } as never)
  ctx.provide('evalRuns', {
    start: async (_access: unknown, input: { requestId: string; plan: { id: string; version: string }; policyId: string }) => ({
      id: 'run-1', requestId: input.requestId, plan: { ...input.plan, digest: 'a'.repeat(64) }, revision: 'b'.repeat(64),
      phase: 'queued', outcome: null, cells: [], controls: [], policy: input.policyId,
    }),
    get: async () => { throw new Error('unexpected get') }, list: async () => [], control: async () => { throw new Error('unexpected control') },
    evidence: async () => { throw new Error('unexpected evidence') },
  } as never)
  ctx.provide('evalGates', {
    evaluate: async (_access: unknown, runId: string, policyId: string) => ({ id: 'gate-1', runId, policyId,
      snapshotRevision: 'b'.repeat(64), decision: { kind: 'pass' }, createdAt: 1 }),
    get: async (id: string) => ({ id, runId: 'run-1', policyId: 'release', snapshotRevision: 'b'.repeat(64),
      decision: { kind: 'pass' }, createdAt: 1 }),
  } as never)
}

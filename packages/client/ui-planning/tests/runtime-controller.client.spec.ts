import { describe, expect, it, vi } from 'vitest'
import {
  createPlanningRuntimeController as makeController,
  type PlanningRuntimeRemoteFace,
  type RemoteResult,
  type PlanningWorkspaceView,
} from '../src/client/runtime-controller.ts'
import type { PlanningExecutionView } from '@changanhua/dsh-planning-remote/types'
import type { DeliveryEvidenceView } from '@changanhua/dsh-delivery-remote'
import type { PlanningCommand } from '@changanhua/dsh-planning/types'
import { EvidenceId, QueueAttemptIdRef, QueueWorkIdRef, Sha256Digest, WorkPacketId } from '@changanhua/dsh-delivery-protocol'

const createPlanningRuntimeController = (
  remote: Omit<PlanningRuntimeRemoteFace, 'handoff' | 'execution' | 'evidence'> &
    Partial<Pick<PlanningRuntimeRemoteFace, 'handoff' | 'execution' | 'evidence'>>,
) =>
  makeController({
    handoff: vi.fn(),
    execution: vi.fn().mockResolvedValue({ ok: true, value: { available: false, handoffs: [] } }),
    ...remote,
    evidence: remote.evidence ?? vi.fn(),
  })

const estimate = {
  value: null,
  urgency: null,
  reuse: null,
  compounding: null,
  timeCost: null,
  tokenCost: null,
  risk: null,
  cognitiveCost: null,
  rationale: '',
}
const board = {
  workspaceId: 'alpha',
  version: 0,
  items: [],
  lanes: { inbox: [], now: [], next: [], later: [], parking: [] },
  dependencies: {},
  reviews: [],
  proposals: [],
  receipts: [],
  handoffs: [],
  events: [],
  executions: [],
}
const createdBoard = {
  ...board,
  version: 1,
  items: [
    {
      id: 'idea',
      headRevisionId: 'r1',
      disposition: 'active',
      createdAt: '2026-09-27T00:00:00.000Z',
      revisions: [
        {
          id: 'r1',
          previousRevisionId: null,
          title: 'Idea',
          intent: 'Make it real',
          scope: [],
          acceptance: [],
          sources: [{ kind: 'manual', text: 'note', verification: 'unverified' }],
          estimate,
          reviewAt: null,
          actorId: 'human',
          actor: { kind: 'human', id: 'human' },
          createdAt: '2026-09-27T00:00:00.000Z',
        },
      ],
    },
  ],
  lanes: { ...board.lanes, inbox: ['idea'] },
}
const proposedBoard = {
  ...board,
  version: 1,
  proposals: [
    {
      id: 'proposal-1',
      targetItemId: null,
      status: 'pending' as const,
      headVersion: 1,
      createdAt: '2026-09-27T00:00:00.000Z',
      generations: [
        {
          version: 1,
          previousVersion: null,
          baseRevisionId: null,
          suggestedLane: 'inbox' as const,
          assumptions: [],
          actor: { kind: 'human' as const, id: 'human' },
          createdAt: '2026-09-27T00:00:00.000Z',
          draft: {
            title: 'Idea',
            intent: 'Idea\nMake it real',
            scope: [],
            acceptance: [],
            sources: [{ kind: 'manual' as const, text: 'Idea\nMake it real', verification: 'unverified' as const }],
            estimate,
            reviewAt: null,
          },
        },
      ],
    },
  ],
}

describe('Planning runtime controller', () => {
  it('ignores execution results for an earlier project or item and cancels owned reads', async () => {
    const old = Promise.withResolvers<RemoteResult<PlanningExecutionView>>()
    const current = Promise.withResolvers<RemoteResult<PlanningExecutionView>>()
    const execution = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const controller = createPlanningRuntimeController({
      workspaces: vi.fn(),
      snapshot: vi.fn().mockResolvedValue({ ok: true, value: createdBoard }),
      execute: vi.fn(),
      execution,
    })
    try {
      controller.selectWorkspace('alpha')
      await vi.waitFor(() => {
        expect(controller.source.getSnapshot().board).toBeDefined()
      })
      controller.selectItem('idea')
      const signal = execution.mock.calls[0]![1] as AbortSignal
      controller.selectItem('second')
      expect(signal.aborted).toBe(true)
      current.resolve({ ok: true, value: { available: true, handoffs: [] } })
      await vi.waitFor(() => {
        expect(controller.source.getSnapshot().execution?.available).toBe(true)
      })
      old.resolve({ ok: true, value: { available: false, handoffs: [] } })
      await Promise.resolve()
      expect(controller.source.getSnapshot().execution?.available).toBe(true)
      controller.selectWorkspace('beta')
      expect(controller.source.getSnapshot().execution).toBeUndefined()
    } finally {
      controller.dispose()
    }
  })

  it('retries an unknown handoff with the original revision even after the displayed head changes', async () => {
    const snapshot = vi.fn().mockResolvedValue({ ok: true, value: createdBoard })
    const handoff = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ ok: true, value: { phase: 'linked' } })
    const controller = createPlanningRuntimeController({
      workspaces: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      snapshot,
      execute: vi.fn(),
      handoff,
    })
    try {
      controller.selectWorkspace('alpha')
      await vi.waitFor(() => {
        expect(controller.source.getSnapshot().board).toBeDefined()
      })
      controller.selectItem('idea')
      await expect(controller.handoff()).resolves.toBe(false)
      const retry = controller.source.getSnapshot().retry!
      const first = createdBoard.items[0]!
      snapshot.mockResolvedValue({
        ok: true,
        value: {
          ...createdBoard,
          items: [
            {
              ...first,
              headRevisionId: 'r2',
              revisions: [...first.revisions, { ...first.revisions[0], id: 'r2', previousRevisionId: 'r1' }],
            },
          ],
        },
      })
      controller.refresh()
      await vi.waitFor(() => {
        expect(controller.source.getSnapshot().board?.items[0]?.headRevisionId).toBe('r2')
      })
      await expect(retry()).resolves.toBe(true)
      expect(handoff).toHaveBeenCalledTimes(2)
      expect([handoff.mock.calls[0]?.[0], handoff.mock.calls[1]?.[0]]).toEqual([
        { workspaceId: 'alpha', itemId: 'idea', expectedRevisionId: 'r1' },
        { workspaceId: 'alpha', itemId: 'idea', expectedRevisionId: 'r1' },
      ])
      controller.selectWorkspace('beta')
      await expect(retry()).resolves.toBe(false)
      expect(handoff).toHaveBeenCalledTimes(2)
    } finally {
      controller.dispose()
    }
  })

  it('refreshes a conflicting handoff without automatically rebasing it', async () => {
    const snapshot = vi.fn().mockResolvedValue({ ok: true, value: createdBoard })
    const handoff = vi.fn().mockResolvedValue({ ok: false, error: { code: 'conflict', message: 'revision changed' } })
    const controller = createPlanningRuntimeController({ workspaces: vi.fn(), snapshot, execute: vi.fn(), handoff })
    try {
      controller.selectWorkspace('alpha')
      await vi.waitFor(() => {
        expect(controller.source.getSnapshot().board).toBeDefined()
      })
      controller.selectItem('idea')
      await expect(controller.handoff()).resolves.toBe(false)
      expect(controller.source.getSnapshot().retry).toBeUndefined()
      expect(handoff).toHaveBeenCalledOnce()
      expect(snapshot).toHaveBeenCalledTimes(2)
    } finally {
      controller.dispose()
    }
  })
  it('loads a workspace, captures an idea as a pending proposal, and refreshes the authoritative board', async () => {
    const snapshot = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: board })
      .mockResolvedValueOnce({ ok: true, value: proposedBoard })
    const submitted: { readonly workspaceId: string; readonly command: PlanningCommand }[] = []
    const execute = vi.fn((input: { readonly workspaceId: string; readonly command: PlanningCommand }) => {
      submitted.push(input)
      return Promise.resolve({
        ok: true as const,
        value: { boardVersion: 1, proposalId: 'proposal-1', proposalVersion: 1 },
      })
    })
    const controller = createPlanningRuntimeController({
      workspaces: vi.fn().mockResolvedValue({ ok: true, value: [{ id: 'alpha', title: 'Alpha' }] }),
      snapshot,
      execute,
    })
    controller.loadWorkspaces()
    await vi.waitFor(() => {
      expect(controller.source.getSnapshot().status).toBe('ready')
    })
    controller.selectWorkspace('alpha')
    await vi.waitFor(() => {
      expect(snapshot).toHaveBeenCalled()
    })
    await expect(controller.create({ idea: 'Idea\nMake it real' })).resolves.toBe(true)
    expect(submitted[0]).toMatchObject({
      workspaceId: 'alpha',
      command: {
        kind: 'propose',
        expectedBoardVersion: 0,
        expectedProposalVersion: null,
        targetItemId: null,
        baseRevisionId: null,
        suggestedLane: 'inbox',
        assumptions: [],
        draft: {
          title: 'Idea',
          intent: 'Idea\nMake it real',
          scope: [],
          acceptance: [],
          sources: [{ kind: 'manual', text: 'Idea\nMake it real' }],
          estimate,
          reviewAt: null,
        },
      },
    })
    expect(typeof submitted[0]?.command.requestId).toBe('string')
    expect(submitted[0]?.command.kind).toBe('propose')
    if (submitted[0]?.command.kind !== 'propose') throw new Error('expected a proposal command')
    expect(typeof submitted[0].command.proposalId).toBe('string')
    await vi.waitFor(() => {
      expect(controller.source.getSnapshot().board?.proposals[0]?.status).toBe('pending')
    })
  })

  it('refreshes a conflict for review without replaying or rebasing its command', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'conflict', message: 'stale board' } })
      .mockResolvedValueOnce({ ok: true, value: { boardVersion: 1, itemId: 'idea' } })
    const snapshot = vi.fn().mockResolvedValue({ ok: true, value: board })
    const controller = createPlanningRuntimeController({
      workspaces: vi.fn().mockResolvedValue({ ok: true, value: [{ id: 'alpha', title: 'Alpha' }] }),
      snapshot,
      execute,
    })
    controller.selectWorkspace('alpha')
    await vi.waitFor(() => {
      expect(controller.source.getSnapshot().board).toBeDefined()
    })
    await expect(controller.create({ idea: 'Idea\nMake it real' })).resolves.toBe(false)
    expect(controller.source.getSnapshot().actionError).toContain('stale board')
    expect(controller.source.getSnapshot().retry).toBeUndefined()
    expect(execute).toHaveBeenCalledOnce()
  })

  it('does not apply a late response after disposal', async () => {
    let settle!: (value: RemoteResult<readonly PlanningWorkspaceView[]>) => void
    const controller = createPlanningRuntimeController({
      workspaces: vi.fn(
        () =>
          new Promise<RemoteResult<readonly PlanningWorkspaceView[]>>((resolve) => {
            settle = resolve
          }),
      ),
      snapshot: vi.fn(),
      execute: vi.fn(),
    })
    controller.loadWorkspaces()
    controller.dispose()
    settle({ ok: true, value: [] })
    await Promise.resolve()
    expect(controller.source.getSnapshot().status).toBe('loading')
  })

  it('drops an evidence response after selection changes to another item', async () => {
    const evidence = Promise.withResolvers<RemoteResult<DeliveryEvidenceView>>()
    const controller = createPlanningRuntimeController({
      workspaces: vi.fn(),
      snapshot: vi.fn().mockResolvedValue({ ok: true, value: createdBoard }),
      execute: vi.fn(),
      evidence: vi.fn().mockReturnValue(evidence.promise),
    })
    try {
      controller.selectWorkspace('alpha')
      await vi.waitFor(() => {
        expect(controller.source.getSnapshot().board).toBeDefined()
      })
      controller.selectItem('idea')
      controller.readEvidence('evidence-1')
      controller.selectItem('other')
      evidence.resolve({
        ok: true,
        value: {
          id: EvidenceId('evidence-1'),
          kind: 'verification-output',
          mediaType: 'text/plain',
          byteLength: 1,
          digest: Sha256Digest(`sha256:${'0'.repeat(64)}`),
          createdAt: '2026-09-27T00:00:00.000Z',
          provenance: {
            kind: 'change-attempt',
            packetId: WorkPacketId('packet-1'),
            queueWorkId: QueueWorkIdRef('work-1'),
            queueAttemptId: QueueAttemptIdRef('attempt-1'),
          },
          contentBase64: 'eA==',
        },
      })
      await Promise.resolve()
      expect(controller.source.getSnapshot().evidence).toBeUndefined()
    } finally {
      controller.dispose()
    }
  })

  it('does not let an older workspace snapshot overwrite a newer selection', async () => {
    const alpha = Promise.withResolvers<{ ok: true; value: typeof board }>()
    const beta = Promise.withResolvers<{ ok: true; value: typeof board }>()
    const controller = createPlanningRuntimeController({
      workspaces: vi.fn(),
      snapshot: vi.fn((workspaceId: string) => (workspaceId === 'alpha' ? alpha.promise : beta.promise)),
      execute: vi.fn(),
    })
    controller.selectWorkspace('alpha')
    controller.selectWorkspace('beta')
    beta.resolve({ ok: true, value: { ...board, workspaceId: 'beta' } })
    await vi.waitFor(() => {
      expect(controller.source.getSnapshot().board?.workspaceId).toBe('beta')
    })
    alpha.resolve({ ok: true, value: board })
    await Promise.resolve()
    expect(controller.source.getSnapshot().board?.workspaceId).toBe('beta')
  })

  it('clears a pending operation when the user changes project', async () => {
    const write = Promise.withResolvers<{ ok: true; value: { boardVersion: number } }>()
    const controller = createPlanningRuntimeController({
      workspaces: vi.fn(),
      snapshot: vi.fn().mockResolvedValue({ ok: true, value: board }),
      execute: vi.fn(() => write.promise),
    })
    controller.selectWorkspace('alpha')
    await vi.waitFor(() => {
      expect(controller.source.getSnapshot().board).toBeDefined()
    })
    void controller.create({ idea: 'Idea\nMake it real' })
    await vi.waitFor(() => {
      expect(controller.source.getSnapshot().pending).toBe(true)
    })
    controller.selectWorkspace('beta')
    expect(controller.source.getSnapshot()).toMatchObject({ workspaceId: 'beta', pending: false, board: undefined })
    write.resolve({ ok: true, value: { boardVersion: 1 } })
  })

  it('refreshes a later-created workspace list and the retained selection board', async () => {
    const workspaces = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: true, value: [{ id: 'alpha', title: 'Alpha' }] })
    const snapshot = vi.fn().mockResolvedValue({ ok: true, value: board })
    const controller = createPlanningRuntimeController({ workspaces, snapshot, execute: vi.fn() })
    controller.loadWorkspaces()
    await vi.waitFor(() => {
      expect(controller.source.getSnapshot().workspaces).toEqual([])
    })
    controller.selectWorkspace('alpha')
    await vi.waitFor(() => {
      expect(controller.source.getSnapshot().board).toBeDefined()
    })
    controller.refresh()
    await vi.waitFor(() => {
      expect(controller.source.getSnapshot().workspaces).toEqual([{ id: 'alpha', title: 'Alpha' }])
    })
    expect(snapshot).toHaveBeenCalledTimes(2)
  })
})

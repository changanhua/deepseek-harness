// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SkillEntryId, SkillManagementSnapshot } from '@deepseek-ai/dsh-host-capability-registry/types'
import { SkillsPopover } from '../src/client/SkillsPopover.tsx'
import type { SkillsPopoverProps } from '../src/client/feature-types.ts'
import type { SkillsSnapshotState } from '../src/client/skills-snapshot.ts'

afterEach(cleanup)

const S1 = 's1' as SessionId
const SUB = 'sub' as SessionId

function readySnapshot(): SkillManagementSnapshot {
  return {
    sessionId: S1,
    fidelity: 'live',
    complete: true,
    entries: [
      {
        id: 'filesystem:project:demo:0' as SkillEntryId,
        summary: { name: 'demo', description: 'demo skill', invocation: { modelInvocable: true, userInvocable: true }, source: 'project-dsh', provider: 'filesystem' },
        selected: true,
        origin: { kind: 'filesystem', provider: 'filesystem', layerLabel: 'Project' },
        actions: { edit: false, remove: false, setInvocation: false },
      },
    ],
    diagnostics: [],
  }
}

function stateOf(status: SkillsSnapshotState['status']): SkillsSnapshotState {
  return {
    status, error: status === 'error' ? 'boom' : null, sessionId: S1,
    snapshot: status === 'ready' ? readySnapshot() : undefined,
  }
}

function mount(options: {
  sessionId?: SessionId
  row?: { id: SessionId; blank?: boolean; origin?: string | undefined }
  snapshot?: SkillsSnapshotState
} = {}) {
  const adopt = vi.fn()
  const load = vi.fn()
  const retry = vi.fn()
  const reset = vi.fn()
  const openManagement = vi.fn()
  const t = vi.fn((key: string) => key) as never
  const sessionId = options.sessionId ?? S1
  const props = {
    sessionId,
    adopt, load, retry, reset, openManagement, t,
    useSessions: (selector: (s: { byId: Record<string, { id: SessionId; blank?: boolean; origin?: string | undefined }> }) => unknown) =>
      selector({ byId: options.row === undefined ? {} : { [String(sessionId)]: options.row } }),
    useSnapshot: (selector: (s: SkillsSnapshotState) => unknown) => selector(options.snapshot ?? stateOf('idle')),
  } as unknown as SkillsPopoverProps
  render(<SkillsPopover {...props} />)
  return { adopt, load, openManagement }
}

describe('SkillsPopover', () => {
  it('shows an ordinary session trigger with the effective count and loads on open', () => {
    const { load } = mount({ row: { id: S1, blank: false }, snapshot: stateOf('ready') })
    const trigger = screen.getByRole('button', { name: 'nav · 1' })
    fireEvent.click(trigger)
    expect(load).toHaveBeenCalledWith(S1)
    expect(screen.getByText('demo')).toBeTruthy()
    expect(screen.getByText('MU')).toBeTruthy()
  })

  it('Manage all adopts the session and opens the section via the navigator callback', () => {
    const { adopt, openManagement } = mount({ row: { id: S1, blank: false }, snapshot: stateOf('ready') })
    fireEvent.click(screen.getByRole('button', { name: 'nav · 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'manageAll' }))
    expect(adopt).toHaveBeenCalledWith(S1)
    expect(openManagement).toHaveBeenCalled()
  })

  it('renders a dormant empty state for a subagent and never loads', () => {
    const { load } = mount({ sessionId: SUB, row: { id: SUB, origin: 'subagent' }, snapshot: stateOf('idle') })
    fireEvent.click(screen.getByRole('button', { name: 'nav' }))
    expect(screen.getByText('emptyState')).toBeTruthy()
    expect(load).not.toHaveBeenCalled()
  })
})

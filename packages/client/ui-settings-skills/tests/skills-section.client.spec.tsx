// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId, SkillEntryId, SkillManagementSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { SkillsSection } from '../src/client/SkillsSection.tsx'
import type { SkillsSectionProps } from '../src/client/feature-types.ts'
import type { SkillsSnapshotState } from '../src/client/skills-snapshot.ts'

afterEach(cleanup)

const S1 = 's1' as SessionId

function snapshotOf(overrides: Partial<SkillManagementSnapshot> = {}): SkillManagementSnapshot {
  return {
    sessionId: S1,
    fidelity: 'live',
    complete: true,
    entries: [
      {
        id: 'filesystem:project:demo:0' as SkillEntryId,
        summary: {
          name: 'demo',
          description: 'demo skill',
          invocation: { modelInvocable: true, userInvocable: false },
          source: 'project-dsh',
          provider: 'filesystem',
        },
        selected: true,
        origin: {
          kind: 'filesystem', provider: 'filesystem', layerLabel: 'Project',
          details: { relativePath: 'project-skill/SKILL.md', rank: 10 },
        },
        actions: { edit: false, remove: false, setInvocation: false },
      },
    ],
    diagnostics: [
      { code: 'registry-validation', severity: 'warning', stage: 'registry-validation', message: 'dropped a bad one', provider: 'filesystem', location: 'x.md' },
    ],
    ...overrides,
  }
}

function stateOf(status: SkillsSnapshotState['status'], overrides: Partial<SkillManagementSnapshot> = {}): SkillsSnapshotState {
  return {
    status, error: status === 'error' ? 'internal: boom' : null,
    sessionId: S1,
    snapshot: status === 'ready' ? snapshotOf(overrides) : undefined,
  }
}

function mount(options: {
  adopted?: SessionId | undefined
  byId?: Record<string, { id: SessionId; blank?: boolean; origin?: string | undefined }>
  current?: SessionId | undefined
  snapshot?: SkillsSnapshotState
} = {}) {
  const actions = { adopt: vi.fn(), followCurrent: vi.fn() }
  const load = vi.fn()
  const retry = vi.fn()
  const reset = vi.fn()
  const openManagement = vi.fn()
  const close = vi.fn()
  const t = vi.fn((key: string) => key) as never
  const props = {
    close,
    actions,
    load,
    retry,
    reset,
    openManagement,
    t,
    useStore: (selector: (s: { adopted?: SessionId | undefined }) => unknown) => selector({ adopted: options.adopted }),
    useSessions: (selector: (s: { byId: typeof options.byId; current: SessionId | undefined }) => unknown) =>
      selector({ byId: options.byId ?? {}, current: options.current }),
    useSnapshot: (selector: (s: SkillsSnapshotState) => unknown) => selector(options.snapshot ?? stateOf('idle')),
  } as unknown as SkillsSectionProps
  render(<SkillsSection {...props} />)
  return { actions, load, retry, reset, close, openManagement }
}

describe('SkillsSection', () => {
  it('renders the empty state when no ordinary session is available and never loads', () => {
    const { load, reset } = mount({ current: undefined })
    expect(screen.getByText('emptyState')).toBeTruthy()
    expect(load).not.toHaveBeenCalled()
    expect(reset).toHaveBeenCalled()
  })

  it('loads the resolved ordinary session and renders the effective list', () => {
    const byId = { [String(S1)]: { id: S1, blank: false } }
    const { load } = mount({ byId, current: S1, snapshot: stateOf('ready') })
    expect(load).toHaveBeenCalledWith(S1)
    const row = screen.getByTestId('skill-demo')
    expect(row.textContent).toContain('demo')
    expect(row.textContent).toContain('[selected]')
    expect(row.textContent).toContain('modelInvocable: ✓')
    expect(row.textContent).toContain('provider: filesystem')
  })

  it('shows shadow winners and diagnostics', () => {
    const byId = { [String(S1)]: { id: S1, blank: false } }
    const snapshot = snapshotOf({
      entries: [
        {
          id: 'user:user:demo:0' as SkillEntryId,
          summary: { name: 'demo', description: 'loses', invocation: { modelInvocable: false, userInvocable: true }, source: 'user-dsh', provider: 'user' },
          selected: false,
          shadow: { by: 'filesystem:project:demo:0' as SkillEntryId, reason: 'cross-layer' },
          origin: { kind: 'filesystem', provider: 'user', layerLabel: 'User' },
          actions: { edit: false, remove: false, setInvocation: false },
        },
      ],
    })
    mount({ byId, current: S1, snapshot: stateOf('ready', snapshot) })
    const row = screen.getByTestId('skill-demo')
    expect(row.textContent).toContain('shadowed: filesystem:project:demo:0 (crossLayer)')
    expect(screen.getByText(/dropped a bad one/)).toBeTruthy()
  })

  it('renders the standing and incomplete banners', () => {
    const byId = { [String(S1)]: { id: S1, blank: false } }
    mount({ byId, current: S1, snapshot: stateOf('ready', { fidelity: 'standing', complete: false }) })
    expect(screen.getAllByText('standing').length).toBeGreaterThan(0)
    expect(screen.getByText('incomplete')).toBeTruthy()
  })

  it('surfaces an error and retries with the same session', () => {
    const byId = { [String(S1)]: { id: S1, blank: false } }
    const { retry } = mount({ byId, current: S1, snapshot: stateOf('error') })
    expect(screen.getByText('failedToLoad: internal: boom')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    expect(retry).toHaveBeenCalled()
  })
})

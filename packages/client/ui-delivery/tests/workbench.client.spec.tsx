// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DispatchBindingId,
  EvidenceId,
  QueueWorkIdRef,
  WorkPacketId,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  DeliverySnapshotView,
  DeliveryWorkbenchCard,
  DeliveryWorkbenchDispatch,
} from '@deepseek-ai/dsh-delivery-remote/types'
import { apply, inject } from '../src/client/index.ts'
import type {
  DeliveryNavEntryProps,
  DeliveryWorkspaceProps,
} from '../src/client/contract.ts'
import type { DeliveryRuntimeState } from '../src/client/runtime-controller.ts'
import {
  acceptedDecisionFixture,
  boundBindingFixture,
  completedClaimFixture,
  contractRevisionFixture,
  passedVerdictFixture,
  readyWorkPacketFixture,
} from './fixtures.client.ts'

const contexts: Context[] = []

afterEach(async () => {
  cleanup()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const copy: Record<string, string> = {
  'nav.delivery': '交付',
  'view.title': '个人交付',
  'view.subtitle': '从采用的 Issue 修订到独立验证与人工决定。',
  'view.refresh': '刷新',
  'view.loading': '正在读取交付台账…',
  'view.retry': '重试',
  'view.cancel': '取消当前操作',
  'view.empty': '还没有已采用的 Issue 修订或工作包。',
  'view.error': '交付台账读取失败：{message}',
  'import.title': '导入 Issue',
  'import.issueUrl': 'GitHub Issue URL',
  'import.repository': '仓库引用',
  'import.submit': '采用当前修订',
  'packet.title': '创建工作包',
  'packet.contract': '合同修订',
  'packet.objective': '工作包目标',
  'packet.allowed': '允许路径（每行一个）',
  'packet.forbidden': '禁止路径（每行一个）',
  'packet.stop': '停止条件（每行一个）',
  'packet.executor': '执行器',
  'packet.submit': '创建工作包',
  'packet.clauses': '验收条款',
  'lane.all': '全部',
  'lane.ready': '就绪',
  'lane.running': '运行中',
  'lane.review': '待审阅',
  'lane.blocked': '已阻塞',
  'lane.accepted': '已接受',
  'ledger.title': '工作包台账',
  'ledger.count': '{count} 个工作包',
  'detail.title': '工作包证据',
  'detail.select': '选择一个工作包查看证据链与允许的操作。',
  'detail.attention': '需要处理',
  'detail.contract': '合同',
  'detail.base': '基础提交',
  'detail.plan': '验证计划',
  'action.startChange': '启动变更',
  'action.startVerification': '开始独立验证',
  'action.executor': '变更执行器',
  'verification.changeBinding': '变更引用',
  'evidence.read': '读取证据 {id}',
  'evidence.content': '证据内容',
  'evidence.none': '当前证据链还没有可读取的对象。',
  'decision.title': '记录人工决定',
  'decision.kind': '决定',
  'decision.reason': '决定原因',
  'decision.nonce': '决定 nonce',
  'decision.accepted': '接受',
  'decision.rejected': '拒绝',
  'decision.waived': '豁免',
  'decision.submit': '记录决定',
  'decision.changeBinding': '变更引用',
  'decision.verificationBinding': '验证引用',
  'spine.scope': '范围',
  'spine.change': '变更',
  'spine.checkpoint': '检查点',
  'spine.verification': '验证',
  'spine.decision': '决定',
  'spine.pending': '待定',
  'queue.succeeded': '已成功',
}

const t = (key: string, params?: Record<string, unknown>): string => {
  const template = copy[key] ?? key
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params?.[name]
    if (value === undefined) return match
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return value.toString()
    }
    return JSON.stringify(value)
  })
}

async function components() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  class RemoteService extends Service {
    constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
  }
  new RemoteService(ctx)
  ctx.provide('remote.delivery', {
    snapshot: vi.fn(async () => ({
      ok: true as const,
      value: { contractsWithoutPacket: [], cards: [] },
    })),
    importIssue: vi.fn(), createPacket: vi.fn(), startChange: vi.fn(),
    startVerification: vi.fn(), readEvidence: vi.fn(), recordDecision: vi.fn(),
  })
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'shell.view': { kind: 'list', scope: 'root' },
      'sidebar.modules': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    Workspace: slots.entries('shell.view')[0]!.component as ComponentType<DeliveryWorkspaceProps>,
    Navigation: slots.entries('sidebar.modules')[0]!.component as ComponentType<DeliveryNavEntryProps & {
      useDelivery: DeliveryWorkspaceProps['useDelivery']
    }>,
  }
}

const standardHooks = {
  useSessions: (() => { throw new Error('unused') }) as DeliveryWorkspaceProps['useSessions'],
  useSessionPendingInteraction: (() => { throw new Error('unused') }) as DeliveryWorkspaceProps['useSessionPendingInteraction'],
  useWorkspaces: (() => { throw new Error('unused') }) as DeliveryWorkspaceProps['useWorkspaces'],
}

function runtime(snapshot?: DeliverySnapshotView, overrides: Partial<DeliveryRuntimeState> = {}): DeliveryRuntimeState {
  return {
    status: snapshot === undefined ? 'idle' : 'ready',
    error: null,
    snapshot,
    pending: null,
    actionError: null,
    lastSucceeded: null,
    evidence: undefined,
    ...overrides,
  }
}

function dispatch(
  binding: ReturnType<typeof boundBindingFixture>,
  status: NonNullable<DeliveryWorkbenchDispatch['queue']>['status'] = 'succeeded',
): DeliveryWorkbenchDispatch {
  return {
    binding: {
      id: binding.id,
      packetId: binding.packetId,
      kind: binding.kind,
      phase: binding.phase,
      queueWorkId: binding.queueWorkId,
      executorId: binding.executorId,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt,
    },
    queue: {
      id: binding.queueWorkId,
      status,
      attemptCount: 1,
      activeAttemptId: null,
      failure: null,
      cancelRequestedAt: null,
      updatedAt: binding.updatedAt,
    },
  }
}

function card(
  name: string,
  lane: DeliveryWorkbenchCard['lane'],
  overrides: Partial<DeliveryWorkbenchCard> = {},
): DeliveryWorkbenchCard {
  const contract = contractRevisionFixture({ id: `contract-${name}` as never })
  const packet = readyWorkPacketFixture({
    id: WorkPacketId(`packet-${name}`),
    contractRevisionId: contract.id,
    objective: `${name} objective`,
  })
  return {
    contractRevision: contract,
    packet,
    lane,
    dispatches: [],
    completionClaim: null,
    verificationVerdict: null,
    acceptanceDecision: null,
    attentionReasons: [],
    ...overrides,
  }
}

function workspaceProps(state: DeliveryRuntimeState) {
  return {
    ...standardHooks,
    useDelivery: (<T,>(selector: (value: DeliveryRuntimeState) => T): T => selector(state)),
    refresh: vi.fn(),
    cancel: vi.fn(),
    importIssue: vi.fn<DeliveryWorkspaceProps['importIssue']>(async () => true),
    createPacket: vi.fn<DeliveryWorkspaceProps['createPacket']>(async () => true),
    startChange: vi.fn<DeliveryWorkspaceProps['startChange']>(async () => true),
    startVerification: vi.fn<DeliveryWorkspaceProps['startVerification']>(async () => true),
    readEvidence: vi.fn<DeliveryWorkspaceProps['readEvidence']>(async () => true),
    recordDecision: vi.fn<DeliveryWorkspaceProps['recordDecision']>(async () => true),
    t: t as DeliveryWorkspaceProps['t'],
  } satisfies DeliveryWorkspaceProps
}

describe('Personal Delivery workbench', () => {
  it('opens from one keyboard-focusable sidebar module entry', async () => {
    const { Navigation } = await components()
    const setActiveModule = vi.fn()
    const rendered = render(<Navigation
      {...standardHooks}
      wide
      activeModule="conversation"
      setActiveModule={setActiveModule}
      useDelivery={selector => selector(runtime({ contractsWithoutPacket: [], cards: [] }))}
      t={t as never}
    />)

    const button = screen.getByRole('button', { name: '交付' })
    fireEvent.click(button)
    expect(setActiveModule).toHaveBeenCalledWith('delivery')

    rendered.rerender(<Navigation
      {...standardHooks}
      wide={false}
      activeModule="delivery"
      setActiveModule={setActiveModule}
      useDelivery={selector => selector(runtime({
        contractsWithoutPacket: [], cards: [card('blocked-nav', 'blocked')],
      }))}
      t={t}
    />)
    const railButton = screen.getByRole('button', { name: '交付' })
    expect(railButton.getAttribute('aria-current')).toBe('page')
    expect(railButton.getAttribute('title')).toBe('交付')
    expect(screen.getByText('nav.blocked')).not.toBeNull()

    rendered.rerender(<Navigation
      {...standardHooks}
      wide
      activeModule="conversation"
      setActiveModule={setActiveModule}
      useDelivery={selector => selector(runtime())}
      t={t}
    />)
  })

  it('renders honest loading, error, and empty states with recovery controls', async () => {
    const { Workspace } = await components()
    const loadingProps = workspaceProps(runtime(undefined, { status: 'loading' }))
    const rendered = render(<Workspace {...loadingProps} />)
    expect(screen.getByText('正在读取交付台账…')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '取消当前操作' }))
    expect(loadingProps.cancel).toHaveBeenCalledOnce()

    const errorProps = workspaceProps(runtime(undefined, { status: 'error', error: 'offline' }))
    rendered.rerender(<Workspace {...errorProps} />)
    expect(screen.getByRole('alert').textContent).toContain('offline')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(errorProps.refresh).toHaveBeenCalledOnce()

    rendered.rerender(<Workspace {...workspaceProps(runtime({ contractsWithoutPacket: [], cards: [] }))} />)
    expect(screen.getByText('还没有已采用的 Issue 修订或工作包。')).not.toBeNull()
    expect(screen.getByRole('form', { name: '导入 Issue' })).not.toBeNull()

    rendered.rerender(<Workspace {...workspaceProps(runtime({ contractsWithoutPacket: [], cards: [] }, {
      status: 'error', error: null, actionError: 'mutation failed', lastSucceeded: 'read-evidence',
    }))} />)
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(screen.getByRole('status')).not.toBeNull()
  })

  it('imports an Issue and creates a bounded Packet without browser-minted authority fields', async () => {
    const { Workspace } = await components()
    const contract = contractRevisionFixture()
    const props = workspaceProps(runtime({ contractsWithoutPacket: [contract], cards: [] }))
    render(<Workspace {...props} />)

    fireEvent.submit(screen.getByRole('form', { name: '导入 Issue' }))
    fireEvent.submit(screen.getByRole('form', { name: '创建工作包' }))
    expect(props.importIssue).not.toHaveBeenCalled()
    expect(props.createPacket).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole('textbox', { name: 'GitHub Issue URL' }), {
      target: { value: contract.sourceRef.canonicalUrl },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '仓库引用' }), {
      target: { value: String(contract.repositoryId) },
    })
    fireEvent.click(within(screen.getByRole('form', { name: '导入 Issue' }))
      .getByRole('button', { name: '采用当前修订' }))
    expect(props.importIssue).toHaveBeenCalledWith({
      issueUrl: contract.sourceRef.canonicalUrl,
      repositoryId: String(contract.repositoryId),
    })

    fireEvent.change(screen.getByRole('textbox', { name: '工作包目标' }), {
      target: { value: 'Implement the bounded UI.' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '允许路径（每行一个）' }), {
      target: { value: 'packages/client/ui-delivery' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '禁止路径（每行一个）' }), {
      target: { value: 'packages/core' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '停止条件（每行一个）' }), {
      target: { value: 'Provider unavailable\n\n Scope changed ' },
    })
    fireEvent.click(within(screen.getByRole('form', { name: '创建工作包' }))
      .getByRole('button', { name: '创建工作包' }))

    expect(props.createPacket).toHaveBeenCalledWith({
      contractRevisionId: String(contract.id),
      packet: {
        objective: 'Implement the bounded UI.',
        allowedPaths: [{ kind: 'subtree', path: 'packages/client/ui-delivery' }],
        forbiddenPaths: [{ kind: 'subtree', path: 'packages/core' }],
        acceptanceClauseIds: contract.acceptanceClauses.map(clause => clause.id),
        stopConditions: ['Provider unavailable', 'Scope changed'],
        executorPreference: { mode: 'preferred', executorId: 'codex' },
      },
    })
    expect(JSON.stringify(props.createPacket.mock.calls[0])).not.toContain('idempotency')
    expect(JSON.stringify(props.createPacket.mock.calls[0])).not.toContain('baseCommit')
  })

  it('updates Contract, clause, and executor selections without minting hidden Packet fields', async () => {
    const { Workspace } = await components()
    const first = contractRevisionFixture({ id: 'contract-first' as never, outcome: null })
    const second = contractRevisionFixture({ id: 'contract-second' as never })
    const initial = workspaceProps(runtime({ contractsWithoutPacket: [first, second], cards: [] }))
    const rendered = render(<Workspace {...initial} />)

    fireEvent.change(screen.getByRole('combobox', { name: '合同修订' }), {
      target: { value: second.id },
    })
    const clause = screen.getAllByRole('checkbox')[0]!
    fireEvent.click(clause)
    fireEvent.click(clause)
    fireEvent.change(screen.getByRole('textbox', { name: '工作包目标' }), {
      target: { value: 'Selected contract objective' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '允许路径（每行一个）' }), {
      target: { value: 'packages/client/ui-delivery' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '执行器' }), { target: { value: '' } })
    fireEvent.submit(screen.getByRole('form', { name: '创建工作包' }))
    const created = initial.createPacket.mock.calls[0]?.[0]
    expect(created?.contractRevisionId).toBe(second.id)
    expect(created?.packet.executorPreference).toEqual({ mode: 'any' })

    rendered.rerender(<Workspace {...workspaceProps(runtime({
      contractsWithoutPacket: [first], cards: [],
    }))} />)
    const contractSelect = screen.getByRole('combobox', { name: '合同修订' })
    expect(contractSelect).toBeInstanceOf(HTMLSelectElement)
    if (!(contractSelect instanceof HTMLSelectElement)) throw new TypeError('Contract selector is not a select')
    expect(contractSelect.value).toBe(first.id)
  })

  it('drives change, verification, evidence, and decision actions from selected existing references', async () => {
    const { Workspace } = await components()
    const ready = card('ready', 'ready')
    const reviewPacket = readyWorkPacketFixture({
      id: WorkPacketId('packet-review'),
      contractRevisionId: 'contract-review' as never,
      objective: 'review objective',
    })
    const changeBinding = boundBindingFixture({
      id: DispatchBindingId('binding-review-change'),
      packetId: reviewPacket.id,
      queueWorkId: QueueWorkIdRef('work-review-change'),
    })
    const claim = completedClaimFixture({
      packetId: reviewPacket.id,
      queueWorkId: changeBinding.queueWorkId,
    })
    const review = card('review', 'review', {
      packet: reviewPacket,
      dispatches: [dispatch(changeBinding)],
      completionClaim: claim,
    })
    const decisionPacket = readyWorkPacketFixture({
      id: WorkPacketId('packet-decision'),
      contractRevisionId: 'contract-decision' as never,
      objective: 'decision objective',
    })
    const decisionChange = boundBindingFixture({
      id: DispatchBindingId('binding-decision-change'),
      packetId: decisionPacket.id,
      queueWorkId: QueueWorkIdRef('work-decision-change'),
    })
    const verifyRaw = boundBindingFixture({
      id: DispatchBindingId('binding-decision-verify-source'),
      packetId: decisionPacket.id,
      queueWorkId: QueueWorkIdRef('work-decision-verify-source'),
    })
    const verifyDispatch: DeliveryWorkbenchDispatch = {
      ...dispatch(verifyRaw),
      binding: {
        ...dispatch(verifyRaw).binding,
        id: DispatchBindingId('binding-decision-verify'),
        kind: 'code.verify@1',
        executorId: null,
      },
    }
    const verdict = passedVerdictFixture({
      packetId: decisionPacket.id,
      verificationPlanDigest: decisionPacket.verificationPlan.digest,
      evidenceIds: [EvidenceId('evidence-z'), EvidenceId('evidence-a')],
    })
    const decisionChangeSecond = boundBindingFixture({
      id: DispatchBindingId('binding-decision-change-2'),
      packetId: decisionPacket.id,
      queueWorkId: QueueWorkIdRef('work-decision-change-2'),
    })
    const verifyDispatchSecond: DeliveryWorkbenchDispatch = {
      ...verifyDispatch,
      binding: {
        ...verifyDispatch.binding,
        id: DispatchBindingId('binding-decision-verify-2'),
        queueWorkId: QueueWorkIdRef('work-decision-verify-2'),
      },
      queue: {
        ...verifyDispatch.queue!,
        id: QueueWorkIdRef('work-decision-verify-2'),
      },
    }
    const decision = card('decision', 'review', {
      packet: decisionPacket,
      dispatches: [dispatch(decisionChange), dispatch(decisionChangeSecond), verifyDispatch, verifyDispatchSecond],
      completionClaim: completedClaimFixture({
        packetId: decisionPacket.id,
        queueWorkId: decisionChange.queueWorkId,
      }),
      verificationVerdict: verdict,
    })
    const blockedVerify = {
      ...verifyDispatch,
      binding: { ...verifyDispatch.binding, packetId: WorkPacketId('packet-blocked') },
    }
    const blocked = card('blocked', 'blocked', {
      dispatches: [blockedVerify], attentionReasons: ['Codex failed'],
    })
    const accepted = card('accepted', 'accepted', {
      acceptanceDecision: acceptedDecisionFixture({ packetId: WorkPacketId('packet-accepted') }),
    })
    const props = workspaceProps(runtime({
      contractsWithoutPacket: [],
      cards: [accepted, blocked, decision, review, ready],
    }, {
      evidence: {
        id: EvidenceId('evidence-a'), kind: 'verification-output', mediaType: 'text/plain',
        byteLength: 1, digest: `sha256:${'1'.repeat(64)}` as never, createdAt: '2026-08-29T00:00:00.000Z',
        provenance: { kind: 'change-attempt', packetId: decisionPacket.id, queueWorkId: QueueWorkIdRef('work-decision-verify'), queueAttemptId: 'attempt-1' as never },
        contentBase64: 'eA==',
      },
    }))
    render(<Workspace {...props} />)

    expect(screen.getByRole('button', { name: '就绪 1' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '已阻塞 1' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '已接受 1' })).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '已阻塞 1' }))
    fireEvent.click(screen.getByRole('button', { name: /blocked objective/ }))
    expect(screen.getByText('Codex failed')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '全部 5' }))

    fireEvent.click(screen.getByRole('button', { name: /ready objective/ }))
    fireEvent.change(screen.getByRole('textbox', { name: '变更执行器' }), { target: { value: 'codex-2' } })
    fireEvent.click(screen.getByRole('button', { name: '启动变更' }))
    expect(props.startChange).toHaveBeenCalledWith({
      packetId: 'packet-ready', executorId: 'codex-2',
    })

    fireEvent.click(screen.getByRole('button', { name: /review objective/ }))
    fireEvent.change(screen.getByRole('combobox', { name: '变更引用' }), {
      target: { value: 'binding-review-change' },
    })
    fireEvent.click(screen.getByRole('button', { name: '开始独立验证' }))
    expect(props.startVerification).toHaveBeenCalledWith({
      packetId: 'packet-review', changeBindingId: 'binding-review-change',
    })

    fireEvent.click(screen.getByRole('button', { name: /decision objective/ }))
    const detail = screen.getByRole('complementary', { name: '工作包证据' })
    for (const label of ['范围', '变更', '检查点', '验证', '决定']) {
      expect(within(detail).getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(within(detail).getByText('eA==')).not.toBeNull()
    fireEvent.click(within(detail).getByRole('button', { name: '读取证据 evidence-a' }))
    expect(props.readEvidence).toHaveBeenCalledWith({ evidenceId: 'evidence-a' })

    const decisionForm = within(detail).getByRole('form', { name: '记录人工决定' })
    fireEvent.submit(decisionForm)
    expect(props.recordDecision).not.toHaveBeenCalled()
    fireEvent.change(within(detail).getByRole('combobox', { name: '变更引用' }), {
      target: { value: 'binding-decision-change-2' },
    })
    fireEvent.change(within(detail).getByRole('combobox', { name: '验证引用' }), {
      target: { value: 'binding-decision-verify-2' },
    })
    fireEvent.change(within(detail).getByRole('combobox', { name: '决定' }), {
      target: { value: 'waived' },
    })

    fireEvent.change(within(detail).getByRole('textbox', { name: '决定原因' }), {
      target: { value: 'Independent evidence is sufficient.' },
    })
    fireEvent.change(within(detail).getByRole('textbox', { name: '决定 nonce' }), {
      target: { value: 'decision-1' },
    })
    fireEvent.click(within(detail).getByRole('button', { name: '记录决定' }))
    expect(props.recordDecision).toHaveBeenCalledWith({
      packetId: 'packet-decision',
      changeBindingId: 'binding-decision-change-2',
      verificationBindingId: 'binding-decision-verify-2',
      decision: 'waived',
      reason: 'Independent evidence is sufficient.',
      decisionNonce: 'decision-1',
    })
  })

  it('selects bindings that arrive on refresh for the same Packet', async () => {
    const { Workspace } = await components()
    const initial = card('progressive', 'ready')
    const change = boundBindingFixture({
      id: DispatchBindingId('binding-progressive-change'),
      packetId: initial.packet.id,
      queueWorkId: QueueWorkIdRef('work-progressive-change'),
    })
    const claim = completedClaimFixture({
      packetId: initial.packet.id,
      queueWorkId: change.queueWorkId,
    })
    const afterChange = card('progressive', 'review', {
      dispatches: [dispatch(change)],
      completionClaim: claim,
    })
    const verifySource = boundBindingFixture({
      id: DispatchBindingId('binding-progressive-verify-source'),
      packetId: initial.packet.id,
      queueWorkId: QueueWorkIdRef('work-progressive-verify'),
    })
    const verification: DeliveryWorkbenchDispatch = {
      ...dispatch(verifySource),
      binding: { ...dispatch(verifySource).binding, kind: 'code.verify@1', executorId: null },
    }
    const afterVerification = card('progressive', 'review', {
      dispatches: [dispatch(change), verification],
      completionClaim: claim,
      verificationVerdict: passedVerdictFixture({ packetId: initial.packet.id }),
    })
    const props = workspaceProps(runtime({ contractsWithoutPacket: [], cards: [initial] }))
    const rendered = render(<Workspace {...props} />)

    rendered.rerender(<Workspace {...props} useDelivery={selector => selector(runtime({
      contractsWithoutPacket: [], cards: [afterChange],
    }))} />)
    fireEvent.click(screen.getByRole('button', { name: '开始独立验证' }))
    expect(props.startVerification).toHaveBeenCalledWith({
      packetId: initial.packet.id,
      changeBindingId: change.id,
    })

    rendered.rerender(<Workspace {...props} useDelivery={selector => selector(runtime({
      contractsWithoutPacket: [], cards: [afterVerification],
    }))} />)
    fireEvent.change(screen.getByRole('textbox', { name: '决定原因' }), {
      target: { value: 'The refreshed evidence is sufficient.' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '决定 nonce' }), {
      target: { value: 'progressive-decision-1' },
    })
    fireEvent.submit(screen.getByRole('form', { name: '记录人工决定' }))
    expect(props.recordDecision).toHaveBeenCalledWith(expect.objectContaining({
      changeBindingId: change.id,
      verificationBindingId: verification.binding.id,
    }))
  })
})

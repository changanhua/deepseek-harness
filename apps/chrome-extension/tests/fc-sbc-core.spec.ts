import { describe, expect, test } from 'vitest'
import {
  assertApprovalCanRun,
  buildSbcPlanVariants,
  createActionLedger,
  createPlanApproval,
  ledgerBalance,
  recordSubmitRequest,
  reservePurchase,
  settlePurchase,
  settleSubmitRequest,
} from '../src/fc-sbc-core.js'

const now = new Date('2026-09-25T06:00:00.000Z').getTime()
const card = (instanceId: string, cardVersionId: string, reserveValue = 0, locked = false) =>
  ({ instanceId, cardVersionId, rating: 80, reserveValue, locked })
const quote = (cardVersionId: string, price: number, validUntil = now + 5 * 60 * 1000) =>
  ({ platform: 'pc', cardVersionId, price, source: 'fixture', observedAt: now, validUntil })

describe('FC SBC 领域核心', () => {
  test('按整组候选生成非支配方案，跨关不复用库存卡并避开锁卡', () => {
    const variants = buildSbcPlanVariants({
      now, fcYear: 'FC27', platform: 'pc', groupId: 'marquee',
      inventory: [card('owned-a', 'gold-a', 900), card('owned-b', 'gold-b', 600), card('locked-c', 'gold-c', 1000, true)],
      quotes: [quote('buy-a', 700), quote('buy-b', 1100)],
      challenges: [
        { challengeId: 'one', slotCount: 2, candidates: [
          { candidateId: 'one-cheap', cards: [{ instanceId: 'owned-a' }, { cardVersionId: 'buy-a', planPurchaseId: 'p-a' }] },
          { candidateId: 'one-locked', cards: [{ instanceId: 'locked-c' }, { cardVersionId: 'buy-a', planPurchaseId: 'p-a' }] },
        ] },
        { challengeId: 'two', slotCount: 2, candidates: [
          { candidateId: 'two-reuse', cards: [{ instanceId: 'owned-a' }, { cardVersionId: 'buy-b', planPurchaseId: 'p-b' }] },
          { candidateId: 'two-valid', cards: [{ instanceId: 'owned-b' }, { cardVersionId: 'buy-b', planPurchaseId: 'p-b' }] },
        ] },
      ],
    })

    expect(variants).toHaveLength(1)
    expect(variants[0]).toMatchObject({ purchaseCount: 2, maxSpend: 1800, opportunityCost: 1500 })
    expect(variants[0].challenges.map(challenge => challenge.candidateId)).toEqual(['one-cheap', 'two-valid'])
    expect(JSON.stringify(variants[0])).not.toContain('locked-c')
  })

  test('未知、零价、过期或超预算报价不会生成可执行采购方案', () => {
    const base = {
      now, fcYear: 'FC27', platform: 'pc', groupId: 'marquee',
      inventory: [card('owned-a', 'gold-a')],
      challenges: [{ challengeId: 'one', slotCount: 2, candidates: [
        { cards: [{ instanceId: 'owned-a' }, { cardVersionId: 'buy-a', planPurchaseId: 'p-a' }] },
      ] }],
    }

    expect(buildSbcPlanVariants({ ...base, quotes: [quote('buy-a', 0)] })).toEqual([])
    expect(buildSbcPlanVariants({ ...base, quotes: [quote('buy-a', 600, now - 1)] })).toEqual([])
    expect(buildSbcPlanVariants({ ...base, quotes: [quote('buy-a', 600)], totalBudget: 500 })).toEqual([])
  })

  test('批准绑定会话、安装、标签页和俱乐部，启动窗口与运行窗口独立失效', () => {
    const [plan] = buildSbcPlanVariants({
      now, fcYear: 'FC27', platform: 'pc', groupId: 'marquee',
      inventory: [card('owned-a', 'gold-a')], quotes: [quote('buy-a', 700)],
      challenges: [{ challengeId: 'one', slotCount: 2, candidates: [
        { cards: [{ instanceId: 'owned-a' }, { cardVersionId: 'buy-a', planPurchaseId: 'p-a' }] },
      ] }],
    })
    const approval = createPlanApproval(plan, {
      approvedAt: now, sessionId: 'session-1', installationId: 'install-1', tabId: 7, clubId: 'club-1',
      startBy: now + 10_000, expiresAt: now + 60_000, submitChallengeIds: ['one'],
    })

    expect(assertApprovalCanRun(approval, { sessionId: 'session-1', installationId: 'install-1', tabId: 7, clubId: 'club-1' }, now + 9000, 'start')).toBe(true)
    expect(() => assertApprovalCanRun(approval, { sessionId: 'session-1', installationId: 'install-1', tabId: 8, clubId: 'club-1' }, now + 9000)).toThrow('approval_scope_changed')
    expect(() => assertApprovalCanRun(approval, { sessionId: 'session-1', installationId: 'install-1', tabId: 7, clubId: 'club-1' }, now + 11_000, 'start')).toThrow('approval_start_expired')
    expect(() => assertApprovalCanRun(approval, { sessionId: 'session-1', installationId: 'install-1', tabId: 7, clubId: 'club-1' }, now + 61_000)).toThrow('approval_expired')
  })

  test('批准提交范围必须属于选中的方案关卡', () => {
    const [plan] = buildSbcPlanVariants({
      now, fcYear: 'FC27', platform: 'pc', groupId: 'marquee',
      inventory: [card('owned-a', 'gold-a')], quotes: [],
      challenges: [{ challengeId: 'one', slotCount: 1, candidates: [
        { cards: [{ instanceId: 'owned-a' }] },
      ] }],
    })

    expect(() => createPlanApproval(plan, {
      approvedAt: now, sessionId: 'session-1', installationId: 'install-1', tabId: 7, clubId: 'club-1',
      submitChallengeIds: ['outside-plan'],
    })).toThrow('submit_scope_invalid')
  })

  test('购买账本先预留单卡上限，确认后只记实付，未知结果保留预留额度', () => {
    const approval = { approvalId: 'approval-1', maxSpend: 1500, purchaseScope: [
      { planPurchaseId: 'p-a', cardVersionId: 'buy-a', maxPrice: 700 },
      { planPurchaseId: 'p-b', cardVersionId: 'buy-b', maxPrice: 800 },
    ] }
    let ledger = createActionLedger(approval)

    ledger = reservePurchase(ledger, approval, { requestId: 'request-a', planPurchaseId: 'p-a', cardVersionId: 'buy-a' })
    expect(ledgerBalance(ledger)).toEqual({ paid: 0, reserved: 700 })
    ledger = settlePurchase(ledger, 'request-a', { status: 'confirmed', actualPrice: 550 })
    expect(ledgerBalance(ledger)).toEqual({ paid: 550, reserved: 0 })
    ledger = reservePurchase(ledger, approval, { requestId: 'request-b', planPurchaseId: 'p-b', cardVersionId: 'buy-b' })
    ledger = settlePurchase(ledger, 'request-b', { status: 'unknown' })
    expect(ledgerBalance(ledger)).toEqual({ paid: 550, reserved: 800 })
    expect(() => reservePurchase(ledger, approval, { requestId: 'request-c', planPurchaseId: 'p-a', cardVersionId: 'buy-a' })).toThrow('budget_exceeded')
  })

  test('只有证明未成交后才释放未知购买额度并允许新挂单请求', () => {
    const approval = { approvalId: 'approval-1', maxSpend: 700, purchaseScope: [
      { planPurchaseId: 'p-a', cardVersionId: 'buy-a', maxPrice: 700 },
    ] }
    let ledger = createActionLedger(approval)
    ledger = reservePurchase(ledger, approval, { requestId: 'request-a', planPurchaseId: 'p-a', cardVersionId: 'buy-a' })
    ledger = settlePurchase(ledger, 'request-a', { status: 'unknown' })
    expect(() => reservePurchase(ledger, approval, { requestId: 'request-b', planPurchaseId: 'p-a', cardVersionId: 'buy-a' })).toThrow('budget_exceeded')

    ledger = settlePurchase(ledger, 'request-a', { status: 'not-acquired' })
    ledger = reservePurchase(ledger, approval, { requestId: 'request-b', planPurchaseId: 'p-a', cardVersionId: 'buy-a' })
    expect(ledgerBalance(ledger)).toEqual({ paid: 0, reserved: 700 })
  })

  test('提交请求的 observed 回执不等于完成，必须等页面读回关卡完成', () => {
    const approval = { approvalId: 'approval-1', maxSpend: 0, purchaseScope: [], submitChallengeIds: ['one'] }
    let ledger = createActionLedger(approval)

    ledger = recordSubmitRequest(ledger, approval, { requestId: 'submit-1', challengeId: 'one' })
    ledger = settleSubmitRequest(ledger, 'submit-1', { status: 'observed' })
    expect(ledger.submits[0]).toMatchObject({ status: 'unknown', pageVerified: false })
    ledger = settleSubmitRequest(ledger, 'submit-1', { status: 'page-completed' })
    expect(ledger.submits[0]).toMatchObject({ status: 'completed', pageVerified: true })
    expect(() => recordSubmitRequest(ledger, approval, { requestId: 'submit-2', challengeId: 'two' })).toThrow('submit_not_approved')
  })
})

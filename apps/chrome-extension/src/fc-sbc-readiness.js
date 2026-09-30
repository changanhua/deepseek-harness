import { sbcObservationBlockers } from './fc-sbc-readiness-facts.js'
import { buildSbcPlanVariants } from './fc-sbc-core.js'
import { createSbcApprovalPreview } from './fc-sbc-approval-preview.js'
import { createSbcExecutionDryRun } from './fc-sbc-execution-dry-run.js'
import { createSbcFieldAudit } from './fc-sbc-field-audit.js'
import { createSbcQuotePreflight } from './fc-sbc-quote-preflight.js'
import { createSbcRiskPreflight } from './fc-sbc-risk-preflight.js'

const codeIssue = (code, source) => ({ code, source })
const first = (items, fallback) => items.length ? items[0] : fallback
const rangeOf = (items, selector) => {
  if (!items.length) return null
  const values = items.map(selector)
  return { min: Math.min(...values), max: Math.max(...values) }
}

const taskTypeOf = probe => probe?.taskType ?? 'unknown'
const marketStatusOf = probe => probe?.marketAccess?.status ?? 'unknown'
const inventoryCoverageOf = (probe, snapshot) => snapshot?.status === 'complete' ? 'complete' : probe?.inventory?.coverage ?? 'unread'
const visibleChallengeCountOf = probe => Number.isSafeInteger(probe?.challengeSet?.visibleChallengeCount)
  ? probe.challengeSet.visibleChallengeCount
  : 0

export const createSbcReadinessReport = (input = {}) => {
  const blockers = []
  const deferred = []
  const warnings = [...new Set(input.probe?.warnings ?? [])]
  const fieldAudit = createSbcFieldAudit({
    probe: input.probe,
    inventorySnapshot: input.inventorySnapshot,
    transactionReadback: input.transactionReadback,
  })
  let variants = []
  let planError = null
  let quotePreflight = null
  let executionDryRun = null
  let riskPreflight = null
  let approvalPreview = null
  const inventoryCoverage = inventoryCoverageOf(input.probe, input.inventorySnapshot)

  if (input.inventorySnapshot?.status === 'invalid') {
    blockers.push(codeIssue('inventory-snapshot-invalid', 'inventory'))
    deferred.push(codeIssue('repair-inventory-snapshot', 'inventory'))
  }

  for (const code of sbcObservationBlockers({ probe: input.probe, inventoryCoverage })) {
    const source = ['page-probe-not-run', 'login-required', 'unsupported-page'].includes(code) ? 'page'
      : ['unsupported-task-type', 'unknown-task-type'].includes(code) ? 'task' : 'inventory'
    blockers.push(codeIssue(code, source))
    const next = { 'page-probe-not-run': 'capture-current-fc-sbc-page',
      'unsupported-task-type': 'item-score-executor-deferred', 'unknown-task-type': 'classify-sbc-task-type',
      'inventory-unread': 'complete-inventory-adapter', 'inventory-visible-only': 'complete-inventory-adapter' }[code]
    if (next) deferred.push(codeIssue(next, source))
  }

  if (!input.planInput) {
    blockers.push(codeIssue('plan-input-missing', 'solver'))
    deferred.push(codeIssue('solver-input-adapter-deferred', 'solver'))
  } else {
    try {
      variants = buildSbcPlanVariants(input.planInput)
    } catch (error) {
      planError = String(error?.code ?? error?.message ?? 'invalid_plan_input').slice(0, 128)
      blockers.push(codeIssue('plan-input-invalid', 'solver'))
    }
    quotePreflight = createSbcQuotePreflight({
      planInput: input.planInput,
      variants,
      maxQuoteAgeMs: input.maxQuoteAgeMs,
      maxMarketSearches: input.maxMarketSearches,
    })
    for (const issue of quotePreflight.issues) blockers.push(codeIssue(issue.code, 'quote'))
    if (quotePreflight.issues.some(issue => ['quote-missing', 'quote-stale', 'quote-invalid', 'quote-platform-mismatch'].includes(issue.code))) {
      deferred.push(codeIssue('refresh-quotes-before-approval', 'quote'))
    }
    if (variants[0]) {
      executionDryRun = createSbcExecutionDryRun({
        plan: variants[0],
        maxMarketSearches: input.maxMarketSearches,
        maxSearchesPerPurchase: input.maxSearchesPerPurchase,
      })
    }
    if (!planError && variants.length === 0) blockers.push(codeIssue('no-executable-plan', 'solver'))
  }

  const purchaseRange = rangeOf(variants, plan => plan.purchaseCount)
  const maxSpendRange = rangeOf(variants, plan => plan.maxSpend)
  const purchaseRequired = input.purchaseRequired === true || purchaseRange !== null && purchaseRange.max > 0
  if (purchaseRequired) {
    if (marketStatusOf(input.probe) === 'blocked') blockers.push(codeIssue('market-access-blocked', 'market'))
    else if (marketStatusOf(input.probe) !== 'visible') blockers.push(codeIssue('market-access-unverified', 'market'))
  }
  riskPreflight = createSbcRiskPreflight({
    executionDryRun,
    transactionReadback: input.transactionReadback,
    marketAccess: marketStatusOf(input.probe),
    maxPurchases: input.maxPurchases,
    maxSubmits: input.maxSubmits,
    maxTotalSearches: input.maxTotalSearches,
  })
  if (executionDryRun?.status === 'blocked') blockers.push(codeIssue('execution-dry-run-blocked', 'execution'))
  if (riskPreflight?.status === 'blocked') blockers.push(codeIssue('risk-preflight-blocked', 'risk'))

  const status = blockers.length === 0
    ? 'ready-for-approval'
    : variants.length ? 'draft-only' : 'blocked'
  if (variants[0]) {
    approvalPreview = createSbcApprovalPreview({
      readiness: { status, canApproveExecution: status === 'ready-for-approval', blockers, variants, executionDryRun, riskPreflight },
      plan: variants[0],
      executionDryRun,
      riskPreflight,
      now: input.now,
      startWithinMs: input.startWithinMs,
      expiresInMs: input.expiresInMs,
      submitChallengeIds: input.submitChallengeIds,
      identity: input.identity,
    })
  }
  const nextAction = first([
    blockers.find(issue => issue.code === 'login-required') && 'sign-in-to-fc-web-app',
    blockers.find(issue => issue.code === 'unsupported-page') && 'open-supported-fc-sbc-page',
    blockers.find(issue => issue.code === 'unsupported-task-type') && 'defer-item-score-sbc',
    blockers.find(issue => issue.code === 'unknown-task-type') && 'classify-sbc-task',
    blockers.find(issue => ['inventory-unread', 'inventory-visible-only'].includes(issue.code)) && 'read-complete-inventory',
    blockers.find(issue => issue.code === 'market-access-blocked') && 'stop-purchase-flow',
    blockers.find(issue => issue.code === 'market-access-unverified') && 'verify-market-access',
    blockers.find(issue => ['quote-missing', 'quote-stale', 'quote-invalid', 'quote-platform-mismatch'].includes(issue.code)) && 'refresh-quotes',
    blockers.find(issue => issue.code === 'market-search-limit') && 'reduce-market-searches',
    blockers.find(issue => issue.code === 'execution-dry-run-blocked') && 'review-execution-preview',
    blockers.find(issue => issue.code === 'risk-preflight-blocked') && 'review-risk-limits',
    blockers.find(issue => issue.code === 'plan-input-missing') && 'build-solver-input',
    blockers.find(issue => issue.code === 'plan-input-invalid') && 'repair-solver-input',
    blockers.find(issue => issue.code === 'no-executable-plan') && 'expand-candidates-or-budget',
  ].filter(Boolean), 'review-plan')

  return {
    status,
    canApproveExecution: status === 'ready-for-approval',
    nextAction,
    blockers,
    deferred: [...new Map(deferred.map(issue => [issue.code, issue])).values()],
    warnings,
    fieldAudit,
    quotePreflight,
    executionDryRun,
    riskPreflight,
    approvalPreview,
    variants,
    summary: {
      taskType: taskTypeOf(input.probe),
      marketAccess: marketStatusOf(input.probe),
      inventoryCoverage,
      visibleChallengeCount: visibleChallengeCountOf(input.probe),
      variantCount: variants.length,
      purchaseRange,
      maxSpendRange,
      planError,
      inventorySnapshot: input.inventorySnapshot?.summary ?? null,
      transactionReadback: input.transactionReadback?.summary
        ? {
            purchase: input.transactionReadback.summary.purchase,
            submission: input.transactionReadback.summary.submission,
            issues: input.transactionReadback.issues.map(issue => issue.code),
          }
        : null,
      riskExposure: riskPreflight
        ? { status: riskPreflight.status, plannedSearches: riskPreflight.summary.plannedSearches,
            purchaseCount: riskPreflight.summary.purchaseCount, submitCount: riskPreflight.summary.submitCount,
            issueCount: riskPreflight.issues.length }
        : null,
      approvalPreview: approvalPreview
        ? { status: approvalPreview.status, reviewDigest: approvalPreview.reviewDigest, maxSpend: approvalPreview.summary.maxSpend,
            reservedIfStarted: approvalPreview.summary.reservedIfStarted, purchaseCount: approvalPreview.summary.purchaseCount,
            submitCount: approvalPreview.summary.submitCount, issueCount: approvalPreview.issues.length }
        : null,
      fieldCoverage: fieldAudit.summary,
      quoteCoverage: quotePreflight?.summary ?? null,
    },
  }
}

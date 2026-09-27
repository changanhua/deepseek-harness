const compact = value => String(value ?? '').replace(/\s+/gu, ' ').trim()
const natural = value => Number.isSafeInteger(value) && value >= 0
const issue = (code, detail) => ({ code, detail: compact(detail).slice(0, 180) })

const statusRank = status => ({ blocked: 3, caution: 2, clear: 1 })[status] ?? 1
const mergeStatus = issues => issues.some(row => row.severity === 'blocked') ? 'blocked'
  : issues.some(row => row.severity === 'caution') ? 'caution' : 'clear'
const publicIssues = rows => rows.map(({ severity: _severity, ...row }) => row)

const transactionUnknownCount = summary => ['purchase', 'submission'].reduce((count, key) =>
  count + (summary?.[key] === 'unknown' || summary?.[key] === 'blocked' ? 1 : 0), 0)

export const createSbcRiskPreflight = (input = {}) => {
  const dryRun = input.executionDryRun ?? null
  const purchaseCount = natural(dryRun?.summary?.purchaseCount) ? dryRun.summary.purchaseCount : 0
  const submitCount = natural(dryRun?.summary?.submitCount) ? dryRun.summary.submitCount : 0
  const maxSearchesPerPurchase = natural(dryRun?.summary?.maxSearchesPerPurchase) ? dryRun.summary.maxSearchesPerPurchase : 0
  const plannedSearches = purchaseCount * maxSearchesPerPurchase
  const maxPurchases = natural(input.maxPurchases) ? input.maxPurchases : 12
  const maxSubmits = natural(input.maxSubmits) ? input.maxSubmits : 4
  const maxTotalSearches = natural(input.maxTotalSearches)
    ? input.maxTotalSearches
    : natural(dryRun?.summary?.maxMarketSearches) ? dryRun.summary.maxMarketSearches : 20
  const marketAccess = compact(input.marketAccess || 'unknown')
  const transactionSummary = input.transactionReadback?.summary ?? null
  const unknownTransactionCount = transactionUnknownCount(transactionSummary)
  const issues = []

  if (purchaseCount > 0 || submitCount > 0) {
    issues.push({ severity: 'caution', ...issue('automation-exposure-nonzero', `${purchaseCount} purchases, ${submitCount} submits`) })
  }
  if (purchaseCount > maxPurchases) {
    issues.push({ severity: 'blocked', ...issue('purchase-count-limit', `${purchaseCount}/${maxPurchases}`) })
  }
  if (plannedSearches > maxTotalSearches) {
    issues.push({ severity: 'blocked', ...issue('market-search-exposure-limit', `${plannedSearches}/${maxTotalSearches}`) })
  }
  if (submitCount > maxSubmits) {
    issues.push({ severity: 'blocked', ...issue('submit-count-limit', `${submitCount}/${maxSubmits}`) })
  }
  if (purchaseCount > 0 && marketAccess === 'blocked') {
    issues.push({ severity: 'blocked', ...issue('market-access-blocked', 'transfer market access is blocked') })
  } else if (purchaseCount > 0 && marketAccess !== 'visible') {
    issues.push({ severity: 'blocked', ...issue('market-access-unverified', 'transfer market access is not verified') })
  }
  if (unknownTransactionCount > 0) {
    issues.push({ severity: 'caution', ...issue('transaction-readback-unknown', String(unknownTransactionCount)) })
  }
  for (const dryRunIssue of dryRun?.issues ?? []) {
    issues.push({ severity: 'blocked', ...issue(dryRunIssue.code, dryRunIssue.detail) })
  }

  issues.sort((left, right) => statusRank(right.severity) - statusRank(left.severity) || left.code.localeCompare(right.code))
  return {
    schemaVersion: 1,
    kind: 'fc-sbc-risk-preflight',
    status: mergeStatus(issues),
    disclaimer: '该预检只统计拟执行的市场搜索、购买和提交；未统计页面读取或内部服务调用风险，不能证明不会封禁。',
    issues: publicIssues(issues),
    summary: {
      purchaseCount,
      submitCount,
      plannedSearches,
      maxSearchesPerPurchase,
      maxPurchases,
      maxSubmits,
      maxTotalSearches,
      marketAccess,
      unknownTransactionCount,
    },
    sideEffects: {
      browserWrites: false,
      purchases: false,
      submits: false,
    },
  }
}

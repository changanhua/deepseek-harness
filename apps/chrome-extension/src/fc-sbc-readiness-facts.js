/** Pure observation readiness shared by the sidebar and the read-only domain owner. */
export const sbcObservationBlockers = ({ probe, inventoryCoverage }) => {
  if (!probe) return ['page-probe-not-run']
  if (probe.loginRequired) return ['login-required']
  const blockers = []
  if (!probe.supported) blockers.push('unsupported-page')
  if (probe.taskType === 'item-score') blockers.push('unsupported-task-type')
  else if (probe.taskType !== 'puzzle') blockers.push('unknown-task-type')
  if (inventoryCoverage === 'unread') blockers.push('inventory-unread')
  else if (inventoryCoverage !== 'complete') blockers.push('inventory-visible-only')
  return blockers
}

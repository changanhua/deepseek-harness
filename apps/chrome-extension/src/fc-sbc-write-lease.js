const compact = value => String(value ?? '').replace(/\s+/gu, ' ').trim()
const boundedText = value => typeof value === 'string' && value.length > 0 && value.length <= 256
const positiveTime = value => Number.isSafeInteger(value) && value > 0

const issue = (code, detail) => ({ code, detail: compact(detail).slice(0, 180) })

const canonical = value => {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return 'null'
}

const fingerprint = value => {
  let hash = 2166136261
  for (const char of canonical(value)) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const identityFields = [
  'sessionId',
  'installationId',
  'grantEpoch',
  'tabId',
  'frameId',
  'documentId',
  'clubId',
  'pageCapturedAt',
  'inventoryCapturedAt',
]

const sideEffects = {
  browserWrites: false,
  purchases: false,
  squadFill: false,
  submits: false,
}

const identityOf = identity => ({
  sessionId: boundedText(identity?.sessionId) ? compact(identity.sessionId) : '',
  installationId: boundedText(identity?.installationId) ? compact(identity.installationId) : '',
  grantEpoch: Number.isSafeInteger(identity?.grantEpoch) ? identity.grantEpoch : null,
  tabId: Number.isSafeInteger(identity?.tabId) ? identity.tabId : null,
  frameId: Number.isSafeInteger(identity?.frameId) ? identity.frameId : null,
  documentId: boundedText(identity?.documentId) ? compact(identity.documentId) : '',
  clubId: boundedText(identity?.clubId) ? compact(identity.clubId) : '',
  pageCapturedAt: boundedText(identity?.pageCapturedAt) ? compact(identity.pageCapturedAt) : '',
  inventoryCapturedAt: boundedText(identity?.inventoryCapturedAt) ? compact(identity.inventoryCapturedAt) : '',
})

const differs = (left, right) => identityFields.some(field => left?.[field] !== right?.[field])

export const createSbcWriteLease = (input = {}) => {
  const preview = input.approvalPreview ?? null
  const now = Number.isSafeInteger(input.now) ? input.now : Date.now()
  const ttlMs = Number.isSafeInteger(input.ttlMs) ? input.ttlMs : 2 * 60 * 1000
  const purpose = boundedText(input.purpose) ? compact(input.purpose) : 'fc-sbc-execution'
  const issues = []
  if (!preview || preview.kind !== 'fc-sbc-approval-preview') issues.push(issue('write-lease-preview-missing', 'no approval preview'))
  if (preview && preview.status !== 'ready') issues.push(issue('write-lease-preview-not-ready', preview.status))
  if (!boundedText(preview?.reviewDigest)) issues.push(issue('write-lease-digest-missing', 'approval digest missing'))
  if (!positiveTime(ttlMs)) issues.push(issue('write-lease-ttl-invalid', ttlMs))
  const identity = identityOf(preview?.identity)
  const expiresAt = now + Math.max(0, ttlMs)
  return {
    schemaVersion: 1,
    kind: 'fc-sbc-write-lease',
    status: issues.length ? 'blocked' : 'active',
    issues,
    leaseId: fingerprint({ reviewDigest: preview?.reviewDigest ?? '', identity, acquiredAt: now, purpose }),
    reviewDigest: compact(preview?.reviewDigest),
    identity,
    acquiredAt: now,
    expiresAt,
    purpose,
    sideEffects,
  }
}

export const validateSbcWriteLease = (input = {}) => {
  const lease = input.lease ?? null
  const now = Number.isSafeInteger(input.now) ? input.now : Date.now()
  const issues = []
  if (!lease || lease.kind !== 'fc-sbc-write-lease') {
    issues.push(issue('write-lease-missing', 'no lease'))
  } else if (lease.status === 'released') {
    issues.push(issue('write-lease-released', lease.releaseReason ?? 'released'))
  } else {
    if (lease.status !== 'active') issues.push(issue('write-lease-not-active', lease.status))
    if (!boundedText(input.expectedReviewDigest) || input.expectedReviewDigest !== lease.reviewDigest) {
      issues.push(issue('write-lease-digest-mismatch', input.expectedReviewDigest))
    }
    if (differs(lease.identity, input.currentIdentity)) {
      issues.push(issue('write-lease-identity-mismatch', 'current identity differs from lease'))
    }
    if (boundedText(input.purpose) && input.purpose !== lease.purpose) {
      issues.push(issue('write-lease-purpose-mismatch', input.purpose))
    }
    if (!positiveTime(lease.expiresAt) || now > lease.expiresAt) {
      issues.push(issue('write-lease-expired', lease.expiresAt))
    }
  }
  return {
    schemaVersion: 1,
    kind: 'fc-sbc-write-lease-validation',
    status: issues.length ? 'blocked' : 'valid',
    issues,
    sideEffects,
  }
}

export const releaseSbcWriteLease = (input = {}) => {
  const lease = input.lease ?? {}
  const now = Number.isSafeInteger(input.now) ? input.now : Date.now()
  return {
    ...lease,
    status: 'released',
    releasedAt: now,
    releaseReason: boundedText(input.reason) ? compact(input.reason) : 'released',
    sideEffects,
  }
}

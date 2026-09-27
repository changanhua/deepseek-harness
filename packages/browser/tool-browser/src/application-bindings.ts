import type { BrowserActionResult, BrowserPage } from '@changanhua/dsh-browser'
import type { ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { BrowserBindingRequest, BrowserControlMatch, BrowserSnapshotBindings } from './types.ts'

const string = { type: 'string' } as const
export const bindingRequestsSchema = { type: 'array',
  description: 'Up to 16 application control names, at most 16 KiB total. Only bound selects a unique match in this complete fresh snapshot. Ambiguous candidates are unselected diagnostics requiring explicit disambiguation; incomplete requires another read. Descriptors are hints, not authorization.',
  items: { type: 'object', additionalProperties: false, properties: {
    key: { ...string, required: true, description: 'Unique application control name, up to 64 characters.' },
    pageUrl: { ...string, required: true, description: 'Exact expected page URL for these application meanings.' },
    alternatives: { type: 'array', required: true, description: 'One to four alternative descriptors. Fields match exactly; label, role, tag and context ignore case and repeated whitespace.',
      items: { type: 'object', additionalProperties: false, properties: {
        role: { ...string, required: true }, label: string, tag: string, context: string,
        name: string, type: string, href: string,
      } } },
  } },
} as const satisfies ValueSchemaSpec

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function pageOf(value: unknown): BrowserPage | undefined {
  const page = record(value)
  if (!page || !Number.isSafeInteger(page.tabId) || !Number.isSafeInteger(page.frameId)
    || typeof page.documentId !== 'string' || !page.documentId || typeof page.url !== 'string') return
  return { tabId: page.tabId as number, frameId: page.frameId as number, documentId: page.documentId, url: page.url }
}

const normalized = (value: unknown): string => typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase() : ''

function matches(element: Record<string, unknown>, match: BrowserControlMatch, page: BrowserPage): boolean {
  if (normalized(element.role) !== normalized(match.role)) return false
  for (const field of ['label', 'tag', 'context'] as const) {
    if (match[field] !== undefined && normalized(element[field]) !== normalized(match[field])) return false
  }
  const attributes = record(element.attributes)
  for (const field of ['name', 'type'] as const) {
    if (match[field] !== undefined && attributes?.[field] !== match[field]) return false
  }
  if (match.href !== undefined) {
    if (typeof attributes?.href !== 'string') return false
    try {
      if (new URL(attributes.href, page.url).href !== new URL(match.href, page.url).href) return false
    } catch { return false }
  }
  return true
}

/** Bound the optional read annotation before asking the provider for a snapshot. */
export function validateBindingRequests(requests: readonly BrowserBindingRequest[]): void {
  if (requests.length < 1 || requests.length > 16 || Buffer.byteLength(JSON.stringify(requests)) > 16_384
    || new Set(requests.map(request => request.key)).size !== requests.length
    || requests.some(request => !request.key || request.key.length > 64 || !request.pageUrl || request.pageUrl.length > 8192
      || request.alternatives.length < 1 || request.alternatives.length > 4
      || request.alternatives.some(match => !match.role || Object.entries(match).some(([key, value]) => typeof value !== 'string'
        || !value.trim() || value.length > (key === 'href' ? 8192 : 256))))) {
    throw new Error('Invalid browser binding descriptors')
  }
}

/** Bind only observations from this receipt; never cache element references or infer missing controls. */
export function bindSnapshotControls(receipt: Pick<BrowserActionResult, 'outcome' | 'requestId' | 'installationId' | 'value'>,
  requests: readonly BrowserBindingRequest[]): BrowserSnapshotBindings {
  validateBindingRequests(requests)
  const snapshot = record(receipt.value), page = pageOf(snapshot?.page)
  const snapshotId = snapshot?.snapshotId
  const elements = Array.isArray(snapshot?.elements) ? snapshot.elements.map(record) : undefined
  const valid = receipt.outcome === 'observed' && page !== undefined && typeof snapshotId === 'string' && snapshotId.length > 0
    && elements !== undefined && elements.length <= 128 && elements.every(element => element !== undefined
      && element.snapshotId === snapshotId && typeof element.elementId === 'string' && element.elementId.length > 0)
    && new Set(elements.map(element => element?.elementId)).size === elements.length
  const source = valid ? { requestId: receipt.requestId, installationId: receipt.installationId, page, snapshotId } : null
  const complete = snapshot?.offset === 0 && snapshot?.nextOffset === null && snapshot?.elementsTruncated === false
    && snapshot?.scanTruncated === false && snapshot?.textScope === 'page'
  return { source, results: requests.map((request) => {
    if (!source || !elements) return { key: request.key, status: 'unavailable', matchCount: 0, candidates: [] }
    if (request.pageUrl !== source.page.url) return { key: request.key, status: 'page-mismatch', matchCount: 0, candidates: [] }
    const found = elements.filter((element): element is Record<string, unknown> => {
      const state = record(element?.state)
      return element !== undefined && state?.disabled !== true && state?.readOnly !== true
        && request.alternatives.some(match => matches(element, match, source.page))
    })
    return { key: request.key,
      status: !complete ? 'incomplete' : found.length === 1 ? 'bound' : found.length > 1 ? 'ambiguous' : 'missing',
      matchCount: found.length,
      candidates: found.slice(0, 4).map(element => ({
        page: source.page, snapshotId: source.snapshotId, elementId: element.elementId as string,
      })),
    }
  }) }
}

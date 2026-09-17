import type { BrowserAction } from '@changanhua/dsh-browser'
import type { BrowserPageMapEvidence, BrowserTaskSnapshot } from './types.ts'

export const BROWSER_PAGE_MAP_REGION_LIMIT = 64

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined

/** Extract only bounded recovery facts from an untrusted page-map result. */
export function browserPageMapEvidence(value: unknown): BrowserPageMapEvidence | undefined {
  const regions = object(value)?.regions
  if (!Array.isArray(regions) || regions.length > BROWSER_PAGE_MAP_REGION_LIMIT) return undefined
  const facts: BrowserPageMapEvidence['regions'][number][] = []
  const refs = new Set<string>()
  for (const candidate of regions) {
    const region = object(candidate)
    if (region === undefined || typeof region.regionRef !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(region.regionRef)
      || typeof region.disposable !== 'boolean' || typeof region.protected !== 'boolean' || refs.has(region.regionRef)) return undefined
    refs.add(region.regionRef)
    facts.push({ regionRef: region.regionRef, disposable: region.disposable, protected: region.protected })
  }
  return { regions: facts }
}

/** Decide whether evidence newer than one failure materially changes that exact precondition. */
export function browserPageMapRecoversFailure(task: BrowserTaskSnapshot, action: BrowserAction,
  code: string, failureSeq: number): boolean {
  if (action.kind !== 'region_render' || task.target === undefined) return false
  const target = task.target
  const grantEpoch = task.capability?.grantEpoch
  return task.evidence.some((evidence) => {
    if (evidence.state !== 'current' || evidence.pageMap === undefined
      || evidence.source.kind !== 'browser-task-receipt' || evidence.source.sessionSeq <= failureSeq
      || evidence.target.installationId !== target.installationId
      || evidence.target.page.tabId !== target.page.tabId
      || evidence.target.page.frameId !== target.page.frameId
      || evidence.target.page.documentId !== target.page.documentId
      || evidence.target.page.url !== target.page.url
      || evidence.grantEpoch !== grantEpoch) return false
    const region = evidence.pageMap.regions.find(candidate => candidate.regionRef === action.regionRef)
    if (region === undefined) return false
    if (code === 'REGION_REPLACE_NOT_PERMITTED') return region.disposable && !region.protected
    if (code === 'REGION_REF_NOT_CURRENT' || code === 'PAGE_MAP_REQUIRED') {
      return action.mode !== 'replace' || region.disposable && !region.protected
    }
    return false
  })
}

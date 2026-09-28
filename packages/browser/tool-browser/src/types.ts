import type { BrowserPage } from '@changanhua/dsh-browser'

type BindingPage = { [Key in keyof BrowserPage]: BrowserPage[Key] }

/** Reusable application knowledge. These descriptors carry no live reference or authority. */
export type BrowserControlMatch = {
  role: string
  label?: string
  tag?: string
  context?: string
  name?: string
  type?: string
  href?: string
}

export type BrowserBindingRequest = {
  key: string
  pageUrl: string
  alternatives: BrowserControlMatch[]
}

/** A derivation of one read receipt, never permission to dispatch or evidence of business success. */
export type BrowserBindingResult = {
  key: string
  status: 'bound' | 'ambiguous' | 'missing' | 'incomplete' | 'page-mismatch' | 'unavailable'
  matchCount: number
  candidates: { page: BindingPage; snapshotId: string; elementId: string }[]
}

export type BrowserSnapshotBindings = {
  source: { requestId: string; installationId: string; page: BindingPage; snapshotId: string } | null
  results: BrowserBindingResult[]
}

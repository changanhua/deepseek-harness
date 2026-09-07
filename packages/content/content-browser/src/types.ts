import type { ContentReceipt } from '@changanhua/dsh-content'

/** One pending browser-installation authorization request. */
export interface BrowserConnectRequest {
  readonly requestId: string
  readonly installationId: string
  readonly extensionId: string
  readonly expiresAt: string
  readonly status: 'pending' | 'approved' | 'rejected'
}

/** A durable browser-installation grant visible to the signed-in owner. */
export interface BrowserGrantSummary {
  readonly installationId: string
  readonly extensionId: string
  readonly createdAt: string
  readonly scope: 'content:import'
}

/** Browser wire response after a durable content import. */
export interface ContentBrowserImportResponse {
  readonly receipt: ContentReceipt
}

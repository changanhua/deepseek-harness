import { Browser } from '@changanhua/dsh-browser'
import type { BrowserActionResult, BrowserInstance, BrowserObservation, BrowserOperation, BrowserPreparedAction, BrowserPreparedTicket } from '@changanhua/dsh-browser'

/** Test-only external boundary: every observation reads one deterministic visible document. */
export default class MockBrowser extends Browser {
  private readonly installationId = '00000000-0000-4000-8000-000000000001'
  isAuthorized(instance: BrowserInstance): boolean { return instance.installationId === this.installationId && instance.grantEpoch === 1 }
  async instances(): Promise<readonly BrowserInstance[]> { return [{ installationId: this.installationId, extensionId: 'a'.repeat(32), online: true, grantEpoch: 1, origins: ['https://example.test'], scopes: ['browser:read', 'browser:observe'] }] }
  async observe(operation: BrowserObservation): Promise<BrowserActionResult> {
    const value = operation.action.kind === 'tabs' ? { tabs: [{ tabId: 1, url: 'https://example.test/page' }] }
      : { text: 'PRIVATE_MONITOR_TEXT_SHOULD_NOT_PERSIST', textTruncated: false, page: { tabId: 1, frameId: 0, documentId: 'document', url: 'https://example.test/page' } }
    return { requestId: 'observe', sessionId: operation.sessionId, installationId: operation.installationId, outcome: 'observed', delivery: 'sent', value }
  }
  execute(_operation: BrowserOperation): Promise<BrowserActionResult> { throw new Error('not used') }
  prepare(): Promise<BrowserPreparedAction> { throw new Error('not used') }
  executePrepared(_ticket: BrowserPreparedTicket): Promise<BrowserActionResult> { throw new Error('not used') }
}

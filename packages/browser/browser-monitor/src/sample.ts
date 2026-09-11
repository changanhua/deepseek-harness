import { createHash } from 'node:crypto'
import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Browser, BrowserInstance } from '@changanhua/dsh-browser'
import type { MonitorRecord, MonitorSample } from './types.ts'

const tabsSchema = z.object({ tabs: z.array(z.object({ tabId: z.number().int().nonnegative(), url: z.string() })).max(128) })
const snapshotSchema = z.object({
  text: z.string().max(50000), textTruncated: z.boolean(),
  page: z.object({ tabId: z.number().int().nonnegative(), frameId: z.number().int().nonnegative(),
    documentId: z.string().min(1).max(128), url: z.string() }),
})

/** Payload-free failures keep website content and provider diagnostics out of notifications. */
export class MonitorError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'MonitorError' }
}

/** True only for the separately granted observation scope and the monitor's exact origin. */
export function permitsObservation(instance: BrowserInstance, url: string): boolean {
  return instance.scopes.includes('browser:read') && instance.scopes.includes('browser:observe')
    && (instance.origins.includes('*') || instance.origins.includes(new URL(url).origin))
}

/** Resolve current authority; an offline installation may retain its explicit plan. */
export async function observationGrant(browser: Pick<Browser, 'instances'>, installationId: string, url: string): Promise<BrowserInstance> {
  const instance = (await browser.instances()).find(item => item.installationId === installationId)
  if (!instance || !permitsObservation(instance, url)) throw new MonitorError('observation_not_authorized')
  return instance
}

/** Read one exact-URL top-level document. Ambiguous tabs and partial text never become an unchanged sample. */
export async function readSample(
  browser: Pick<Browser, 'observe'>, record: MonitorRecord, signal: AbortSignal, now: () => number,
): Promise<MonitorSample> {
  const read = async (action: Parameters<Browser['observe']>[0]['action']) => {
    signal.throwIfAborted()
    const result = await browser.observe({ sessionId: SessionId(record.sessionId), installationId: record.installationId,
      grantEpoch: record.grantEpoch, action }, signal)
    signal.throwIfAborted()
    if (result.outcome !== 'observed') {
      const code = ['authorization_changed', 'observation_not_authorized', 'site_not_authorized'].includes(result.reason ?? '')
        ? 'authorization_changed' : 'browser_unavailable'
      throw new MonitorError(code)
    }
    return result.value
  }
  const tabs = tabsSchema.safeParse(await read({ kind: 'tabs' }))
  if (!tabs.success) throw new MonitorError('invalid_observation')
  const matches = tabs.data.tabs.filter(tab => tab.url === record.url)
  const tab = matches[0]
  if (matches.length !== 1 || !tab) throw new MonitorError(matches.length ? 'target_ambiguous' : 'target_unavailable')
  const snapshot = snapshotSchema.safeParse(await read({ kind: 'snapshot', tabId: tab.tabId, frameId: 0 }))
  if (!snapshot.success) throw new MonitorError('invalid_observation')
  const { text, textTruncated, page } = snapshot.data
  if (page.tabId !== tab.tabId || page.frameId !== 0 || page.url !== record.url) throw new MonitorError('target_changed')
  if (textTruncated) throw new MonitorError('observation_truncated')
  return { digest: createHash('sha256').update(text).digest('hex'),
    matched: record.match.kind === 'changed' || text.includes(record.match.text), sampledAt: now(), page }
}

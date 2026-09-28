import type { Branded } from '@deepseek-ai/dsh-brand'
import type { BrowserAction } from '@changanhua/dsh-browser/types'
import type { BrowserTargetBinding, BrowserTaskSnapshot, BrowserActionAttempt } from './types.ts'
export const BROWSER_TASK_CHANGE_VERSION = 6 as const
export const BrowserTaskId = (value: string): Branded<'BrowserTaskId'> => value as Branded<'BrowserTaskId'>
export class BrowserTaskError extends Error { constructor(message: string, readonly code: string) { super(message); this.name = 'BrowserTaskError' } }

/** Recognizes an exact owned resource in the current document, including its pre-route URL. */
export function isOwnedBrowserResourceTarget(
  task: BrowserTaskSnapshot, value: BrowserTargetBinding, resourceId: string | undefined,
): boolean {
  const current = task.target
  const resource = task.resources.find(item => item.id === resourceId)
  return current !== undefined && resource !== undefined && resource.state !== 'retained'
    && value.installationId === current.installationId && value.page.tabId === current.page.tabId
    && value.page.frameId === current.page.frameId && value.page.documentId === current.page.documentId
    && resource.target.installationId === value.installationId
    && resource.target.page.tabId === value.page.tabId && resource.target.page.frameId === value.page.frameId
    && resource.target.page.documentId === value.page.documentId && resource.target.page.url === value.page.url
}
/** Recognizes an exact non-transferred lease by its durable page identity for cleanup only. */
export function isExactOwnedBrowserResourceCleanupTarget(
  task: BrowserTaskSnapshot, value: BrowserTargetBinding, resourceId: string | undefined,
): boolean {
  const resource = task.resources.find(item => item.id === resourceId)
  return resource !== undefined && resource.state !== 'retained'
    && resource.target.installationId === value.installationId
    && resource.target.page.tabId === value.page.tabId && resource.target.page.frameId === value.page.frameId
    && resource.target.page.documentId === value.page.documentId && resource.target.page.url === value.page.url
}

/** Match the fixed read planned for a scoped selection; extra snapshot arguments change its identity. */
export function isBrowserTaskSelectionAction(attempt: BrowserActionAttempt, action: BrowserAction): boolean {
  const selected = attempt.selection
  if (selected === undefined || action.kind !== 'snapshot' || Object.keys(action).length !== 4
    || action.tabId !== selected.tab.tabId || action.frameId !== 0 || action.expectedTab === undefined
    || Object.keys(action.expectedTab).length !== 3) return false
  return action.expectedTab.tabId === selected.tab.tabId && action.expectedTab.windowId === selected.tab.windowId
    && action.expectedTab.browserSessionId === selected.tab.browserSessionId
}

/** Keep a resource action tied to its original lease and exact page through dispatch and settlement. */
export function isBrowserTaskResourceAction(attempt: BrowserActionAttempt, action: BrowserAction): boolean {
  if (attempt.resourceId === undefined || attempt.target === undefined || !('mountId' in action) || !('page' in action)
    || action.page === undefined || action.kind !== attempt.actionKind || action.mountId !== attempt.resourceId) return false
  const page = attempt.target.page
  return action.page.tabId === page.tabId && action.page.frameId === page.frameId
    && action.page.documentId === page.documentId && action.page.url === page.url
}

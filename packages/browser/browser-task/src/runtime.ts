import type { Branded } from '@deepseek-ai/dsh-brand'
export const BROWSER_TASK_CHANGE_VERSION = 3 as const
export const BrowserTaskId = (value: string): Branded<'BrowserTaskId'> => value as Branded<'BrowserTaskId'>
export class BrowserTaskError extends Error { constructor(message: string, readonly code: string) { super(message); this.name = 'BrowserTaskError' } }

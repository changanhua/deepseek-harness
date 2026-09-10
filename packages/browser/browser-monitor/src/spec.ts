import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { MonitorRecordSchema } from './schemas.ts'
import type { MonitorRecord } from './types.ts'

/** Monitor definitions and their comparison/outbox changes commit under one key. */
export const monitorDomainSpec = defineDomain({
  name: 'browser_monitors', version: 1, layout: 'single',
  requires: ['single-writer', 'commit-sync', 'private-root'] as const,
  tables: { monitors: domainTable<string, MonitorRecord>(MonitorRecordSchema) },
})

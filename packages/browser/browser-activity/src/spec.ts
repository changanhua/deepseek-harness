import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { ActivityRecordSchema } from './schemas.ts'
import type { ActivityRecord } from './types.ts'

/** Raw activity stays in its own private Host domain, separate from curated knowledge. */
export const activityDomainSpec = defineDomain({ name: 'browser_activity', version: 1, layout: 'single',
  requires: ['single-writer', 'commit-sync', 'private-root'] as const,
  tables: { installations: domainTable<string, ActivityRecord>(ActivityRecordSchema) },
})

/** Durable Content aggregate declaration. */

import { domainTable, defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { ContentEntrySchema } from '@changanhua/dsh-content'
import type { ContentEntry } from '@changanhua/dsh-content'

/** The one-record-per-entry Content library persisted by this provider. */
export const contentDomainSpec = defineDomain({
  name: 'content_library',
  version: 1,
  layout: 'single',
  requires: ['single-writer', 'commit-sync', 'private-root'] as const,
  tables: { entries: domainTable<string, ContentEntry>(ContentEntrySchema) },
})

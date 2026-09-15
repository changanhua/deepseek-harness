/** Authoritative project-memory Storage Domain declaration. @module @changanhua/dsh-memory-local/spec */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { memoryRecordSchema } from '@changanhua/dsh-memory'

/** Single-version durable data rejects incompatible formats without discarding records. */
export const projectMemoryDomain = defineDomain({
  name: 'project_memory',
  version: 1,
  layout: 'single',
  tables: { memories: domainTable(memoryRecordSchema) },
})

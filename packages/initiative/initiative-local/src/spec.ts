import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { candidateSchema, initiativeReceiptSchema } from '@changanhua/dsh-initiative'

/** Atomic Workspace record including Candidate histories and actor-bound operation receipts. */
export const workspaceCandidatesSchema = z.strictObject({
  candidates: z.array(candidateSchema),
  receipts: z.array(z.strictObject({ key: z.string(), digest: z.string(), result: initiativeReceiptSchema })),
})
/** Local durable domain; invalid records fail closed instead of being silently discarded. */
export const initiativeDomain = defineDomain({
  name: 'initiative_candidates', version: 1, layout: 'single',
  tables: { workspaces: domainTable(workspaceCandidatesSchema) },
})

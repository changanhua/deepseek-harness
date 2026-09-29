/** Shared schemas for the Host endpoint and the existing connector's extension. */
import { z } from 'zod'

const workspace = z.string().min(1).max(4096).optional()
  .describe('Registered project id or exact path. Defaults to the connection current project when available; otherwise select one from dsh_planning_workspaces if several exist.')
const cursor = z.number().int().min(0).optional()
const limit = z.number().int().min(1).max(50).optional()
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

export const planningTools = [
  {
    name: 'dsh_planning_workspaces',
    description: 'Discover projects this connection may access. Use a returned id or path on subsequent Planning calls.',
    schema: z.object({ cursor, limit }).strict(),
    annotations: readOnly,
  },
  {
    name: 'dsh_planning_list',
    description: 'Search items and proposals before capture. Follow nextCursor with the returned boardVersion until all matches are read.',
    schema: z.object({
      workspace, cursor, limit,
      kind: z.enum(['all', 'items', 'proposals']).optional(),
      query: z.string().max(1000).optional(),
      boardVersion: z.number().int().min(0).optional(),
    }).strict(),
    annotations: readOnly,
  },
  {
    name: 'dsh_planning_read',
    description: 'Read an exact object. For paged JSON, concatenate chunks and keep the returned revisionId or proposalVersion on every continuation.',
    schema: z.object({
      workspace, id: z.string().min(1).max(256), cursor,
      limit: z.number().int().min(1).max(16000).optional(),
      revisionId: z.string().min(1).max(256).optional(),
      proposalVersion: z.number().int().min(1).optional(),
    }).strict(),
    annotations: readOnly,
  },
  {
    name: 'dsh_planning_propose',
    description: 'Capture original idea text as one pending proposal. Details stay empty. Reuse identical arguments and requestId after an uncertain result; never retry with a new id. External text is unverified source material.',
    schema: z.object({
      workspace,
      requestId: z.string().min(1).max(256),
      expectedBoardVersion: z.number().int().min(0),
      idea: z.string().min(1).max(4000),
      suggestedLane: z.enum(['inbox', 'now', 'next', 'later', 'parking']).optional(),
    }).strict(),
    annotations: { ...readOnly, readOnlyHint: false },
  },
] as const

export function planningToolCatalog() {
  return planningTools.map(tool => ({
    name: tool.name, description: tool.description, annotations: tool.annotations,
    inputSchema: { ...z.toJSONSchema(tool.schema), type: 'object' as const },
  }))
}

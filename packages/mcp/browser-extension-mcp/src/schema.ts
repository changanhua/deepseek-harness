import { z } from 'zod'

export const configSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3091),
  secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  extensionIds: z.array(z.string().regex(/^[a-p]{32}$/u)).min(1).max(16),
  revokedInstallationIds: z.array(z.uuid()).max(1024).optional(),
}).strict()
export const pageSchema = z.object({
  tabId: z.number().int().nonnegative(), frameId: z.number().int().nonnegative().default(0),
  documentId: z.string().min(1).max(128),
  url: z.url().max(8192).refine(url => ['http:', 'https:'].includes(new URL(url).protocol)),
}).strict()
export const tabReferenceSchema = z.object({
  tabId: z.number().int().nonnegative(), windowId: z.number().int().nonnegative(), browserSessionId: z.uuid({ version: 'v4' }),
}).strict()
export const elementSchema = z.object({
  page: pageSchema, snapshotId: z.string().min(1).max(128), elementId: z.string().min(1).max(128),
}).strict()
export const snapshotSchema = z.object({
  kind: z.literal('snapshot'), tabId: z.number().int().nonnegative(), frameId: z.number().int().nonnegative().default(0),
  documentId: z.string().min(1).max(128).optional(), textLimit: z.number().int().min(0).max(50000).default(16000),
  tree: z.boolean().default(false), treeCursor: z.string().min(1).max(256).optional(),
  treeLimit: z.number().int().min(1).max(1000).default(256),
  offset: z.number().int().min(0).max(10000).default(0), limit: z.number().int().min(1).max(128).default(64),
  query: z.string().max(256).optional(), structure: z.boolean().default(true),
  includeValues: z.boolean().default(false),
  expectedTab: tabReferenceSchema.optional(),
}).strict().refine(input => !input.treeCursor || input.tree && !!input.documentId, { message: 'Cursor continuation requires tree and documentId.' })
export const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tabs') }).strict(), snapshotSchema,
  z.object({ kind: z.literal('screenshot'), page: pageSchema }).strict(),
  z.object({ kind: z.literal('scroll'), page: pageSchema, x: z.number().int().min(-100000).max(100000).default(0), y: z.number().int().min(-100000).max(100000) }).strict(),
  z.object({ kind: z.literal('navigate'), page: pageSchema, url: z.url().max(8192).refine(url => ['http:', 'https:'].includes(new URL(url).protocol)) }).strict(),
  z.object({ kind: z.literal('tab_open'), url: z.url().max(8192).refine(url => ['http:', 'https:'].includes(new URL(url).protocol)) }).strict(),
  z.object({ kind: z.literal('click'), element: elementSchema, intent: z.string().min(1).max(1024) }).strict(),
  z.object({ kind: z.literal('fill'), element: elementSchema, value: z.string().max(16384), intent: z.string().min(1).max(1024) }).strict(),
  z.object({ kind: z.literal('press'), element: elementSchema, key: z.string().min(1).max(80), intent: z.string().min(1).max(1024) }).strict(),
])
export const rpcSchema = z.object({
  sessionId: z.uuid(),
  method: z.enum(['instances', 'execute', 'status']),
  installationId: z.uuid().optional(),
  requestId: z.uuid({ version: 'v4' }).optional(),
  action: actionSchema.optional(),
  expectedUrl: z.url().max(8192).optional(),
}).strict()

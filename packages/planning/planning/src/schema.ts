import { z } from 'zod'

const id = z.string().trim().min(1).max(256)
const text = z.string().trim().min(1).max(4000)
const timestamp = z.iso.datetime()
const httpUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol
  return protocol === 'http:' || protocol === 'https:'
}, 'link URL must use http or https')
export const planningLaneSchema = z.enum(['inbox', 'now', 'next', 'later', 'parking'])
/** Immutable image facts captured from a Workspace-owned Session event. */
export const planningImageSchema = z.strictObject({
  attachmentId: id,
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  bytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  name: z.string().max(1024).optional(),
  originalDimensions: z.strictObject({
    width: z.number().int().positive(), height: z.number().int().positive(),
  }).optional(),
})
export const planningSourceInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('manual'), text }),
  z.strictObject({ kind: z.literal('session-event'), sessionId: id, seq: z.number().int().nonnegative() }),

  z.strictObject({ kind: z.literal('content'), entryId: id, version: id }),
  z.strictObject({ kind: z.literal('link'), url: httpUrl, label: z.string().trim().min(1).max(500) }),
])
export const planningSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('manual'), text, verification: z.literal('unverified') }),

  z.strictObject({
    kind: z.literal('link'),
    url: httpUrl,
    label: z.string().trim().min(1).max(500),
    verification: z.literal('unverified'),
  }),
  z.strictObject({
    kind: z.literal('session-event'),
    sessionId: id,
    seq: z.number().int().nonnegative(),
    eventType: id,
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    excerpt: z.string().max(1024),
    images: z.array(planningImageSchema).max(20).optional(),
    verification: z.literal('verified'),
  }),
  z.strictObject({
    kind: z.literal('content'),
    entryId: id,
    version: id,
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    verification: z.literal('captured'),
  }),
])
export const planningEstimateSchema = z.strictObject({
  value: z.number().int().min(0).max(5).nullable(),
  urgency: z.number().int().min(0).max(5).nullable(),
  reuse: z.number().int().min(0).max(5).nullable(),
  compounding: z.number().int().min(0).max(5).nullable(),

  timeCost: z.number().int().min(0).max(5).nullable(),
  tokenCost: z.number().int().min(0).max(5).nullable(),
  risk: z.number().int().min(0).max(5).nullable(),
  cognitiveCost: z.number().int().min(0).max(5).nullable(),
  rationale: z.string().trim().max(2000),
})
/** Untrusted proposal input: source locators carry no observed proof. */
export const planningDraftSchema = z.strictObject({
  title: text,
  intent: text,
  scope: z.array(text).max(100),
  acceptance: z.array(text).max(100),
  sources: z.array(planningSourceInputSchema).min(1).max(20),
  estimate: planningEstimateSchema,
  reviewAt: timestamp.nullable(),
})
/** Durable generation content after the Provider captured every source. */
export const planningCapturedDraftSchema = z.strictObject({
  title: text,
  intent: text,
  scope: z.array(text).max(100),
  acceptance: z.array(text).max(100),
  sources: z.array(planningSourceSchema).min(1).max(20),
  estimate: planningEstimateSchema,
  reviewAt: timestamp.nullable(),
})
export const planningActorSchema = z.strictObject({
  kind: z.enum(['human', 'agent', 'bridge']),
  id,
  userMessage: z.strictObject({ sessionId: id, seq: z.number().int().nonnegative() }).optional(),
})
export const planningProposalGenerationSchema = z.strictObject({
  version: z.number().int().positive(),
  previousVersion: z.number().int().positive().nullable(),
  baseRevisionId: id.nullable(),
  draft: planningCapturedDraftSchema,
  suggestedLane: planningLaneSchema,
  assumptions: z.array(text).max(100),
  actor: planningActorSchema,
  createdAt: timestamp,
})
export const planningProposalSchema = z.strictObject({
  id,
  targetItemId: id.nullable(),
  fromReviewId: id.optional(),
  status: z.enum(['pending', 'accepted', 'dismissed']),
  headVersion: z.number().int().positive(),
  generations: z.array(planningProposalGenerationSchema).min(1),
  createdAt: timestamp,
  settlement: z
    .strictObject({ actor: planningActorSchema, at: timestamp, itemId: id.optional(), revisionId: id.optional() })
    .optional(),
})
export const planningRevisionSchema = z.strictObject({
  id,
  previousRevisionId: id.nullable(),
  title: text,
  intent: text,
  scope: z.array(text).max(100),
  acceptance: z.array(text).max(100),
  sources: z.array(planningSourceSchema).min(1).max(20),
  estimate: planningEstimateSchema,
  reviewAt: timestamp.nullable(),
  actorId: id,
  actor: planningActorSchema,
  createdAt: timestamp,
})
export const planningItemSchema = z.strictObject({
  id,
  headRevisionId: id,
  disposition: z.enum(['active', 'archived']),
  createdAt: timestamp,
  revisions: z.array(planningRevisionSchema).min(1),
})
export const planningReviewSchema = z.strictObject({
  id,
  itemId: id,
  revisionId: id,
  outcome: z.enum(['completed', 'abandoned', 'learned']),
  summary: text,
  lessons: z.array(text).max(100),
  followUpItemIds: z.array(id).max(100),
  acceptanceRef: id.nullable(),
  createdAt: timestamp,
})
export const planningReceiptSchema = z.strictObject({
  requestId: id,
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  result: z.strictObject({
    boardVersion: z.number().int().nonnegative(),
    itemId: id.optional(),
    revisionId: id.optional(),
    reviewId: id.optional(),
    proposalId: id.optional(),
    proposalVersion: z.number().int().positive().optional(),
  }),
  at: timestamp,
})
export const planningHandoffSourceSchema = z.strictObject({
  title: text,
  intent: text,
  scope: z.array(text).max(100),
  acceptance: z.array(text).max(100),
  sources: z.array(planningSourceSchema).min(1).max(20),
})
export const planningPrepareHandoffSchema = z.strictObject({
  itemId: id,
  expectedRevisionId: id,
  repositoryId: id,
  key: z.string().regex(/^[a-f0-9]{16,64}$/u),
  mapperVersion: z.literal(1),
  operatorId: id,
  deliveryRequestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
})
export const planningLinkHandoffSchema = z.strictObject({
  key: z.string().regex(/^[a-f0-9]{16,64}$/u),
  caseId: id,
  contractRevisionId: id,
})
export const planningHandoffSchema = z
  .strictObject({
    itemId: id,
    revisionId: id,
    repositoryId: id,
    key: z.string().regex(/^[a-f0-9]{16,64}$/u),
    mapperVersion: z.literal(1),
    operatorId: id,
    source: planningHandoffSourceSchema,
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    deliveryRequestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    phase: z.enum(['prepared', 'linked']),
    caseId: id.optional(),
    contractRevisionId: id.optional(),
    preparedAt: timestamp,
    linkedAt: timestamp.optional(),
  })
  .superRefine((value, ctx) => {
    const linkedFields = [value.caseId, value.contractRevisionId, value.linkedAt]
    const present = linkedFields.filter(field => field !== undefined).length
    if (value.phase === 'linked' && present !== linkedFields.length)
      ctx.addIssue({ code: 'custom', message: 'linked handoff requires exact target references and time' })
    if (value.phase === 'prepared' && present !== 0)
      ctx.addIssue({ code: 'custom', message: 'prepared handoff cannot contain delivery target references' })
  })
export const planningEventSchema = z.strictObject({
  id,
  kind: z.enum([
    'created',
    'revised',
    'moved',
    'dependencies-changed',
    'archived',
    'reviewed',
    'follow-up-linked',
    'proposed',
    'proposal-accepted',
    'proposal-dismissed',
    'handoff-prepared',
    'handoff-linked',
  ]),
  itemId: id.optional(),
  revisionId: id.optional(),
  reviewId: id.optional(),
  proposalId: id.optional(),
  at: timestamp,
  actorId: id,
  actor: planningActorSchema,
})
export const planningBoardSchema = z.strictObject({
  workspaceId: id,
  version: z.number().int().nonnegative(),
  items: z.array(planningItemSchema),
  lanes: z.record(planningLaneSchema, z.array(id)),
  dependencies: z.record(id, z.array(id)),
  reviews: z.array(planningReviewSchema),
  proposals: z.array(planningProposalSchema),
  receipts: z.array(planningReceiptSchema),
  handoffs: z.array(planningHandoffSchema),
  events: z.array(planningEventSchema),
})
export const planningCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('create'),
    requestId: id,
    expectedBoardVersion: z.number().int().nonnegative(),
    itemId: id.optional(),
    fromReviewId: id.optional(),
    lane: planningLaneSchema.default('inbox'),
    title: text,
    intent: text,
    scope: z.array(text).max(100).default([]),
    acceptance: z.array(text).max(100).default([]),
    sources: z.array(planningSourceInputSchema).min(1).max(20),
    estimate: planningEstimateSchema,
    reviewAt: timestamp.nullable().default(null),
  }),
  z.strictObject({
    kind: z.literal('revise'),
    requestId: id,
    expectedBoardVersion: z.number().int().nonnegative(),
    itemId: id,
    expectedRevisionId: id,
    title: text,
    intent: text,
    scope: z.array(text).max(100),
    acceptance: z.array(text).max(100),
    sources: z.array(planningSourceInputSchema).min(1).max(20),
    estimate: planningEstimateSchema,
    reviewAt: timestamp.nullable(),
  }),
  z.strictObject({
    kind: z.literal('move'),
    requestId: id,
    expectedBoardVersion: z.number().int().nonnegative(),
    itemId: id,
    lane: planningLaneSchema,
    beforeItemId: id.nullable(),
  }),
  z.strictObject({
    kind: z.literal('dependencies'),
    requestId: id,
    expectedBoardVersion: z.number().int().nonnegative(),
    itemId: id,
    dependsOnItemIds: z.array(id).max(100),
  }),
  z.strictObject({
    kind: z.literal('archive'),
    requestId: id,
    expectedBoardVersion: z.number().int().nonnegative(),
    itemId: id,
  }),
  z.strictObject({
    kind: z.literal('review'),
    requestId: id,
    expectedBoardVersion: z.number().int().nonnegative(),
    itemId: id,
    expectedRevisionId: id,
    outcome: z.enum(['completed', 'abandoned', 'learned']),
    summary: text,
    lessons: z.array(text).max(100),
    followUpItemIds: z.array(id).max(100).default([]),
    acceptanceRef: id.nullable().default(null),
  }),
  z.strictObject({
    kind: z.literal('follow-up'),
    requestId: id,
    expectedBoardVersion: z.number().int().nonnegative(),
    reviewId: id,
    itemId: id,
  }),
  z.strictObject({
    kind: z.literal('propose'),
    requestId: id,
    expectedBoardVersion: z.number().int().nonnegative(),
    proposalId: id,
    expectedProposalVersion: z.number().int().positive().nullable(),
    targetItemId: id.nullable(),
    baseRevisionId: id.nullable(),
    fromReviewId: id.optional(),
    draft: planningDraftSchema,
    suggestedLane: planningLaneSchema,
    assumptions: z.array(text).max(100),
  }),
  z.strictObject({
    kind: z.literal('accept-proposal'),
    requestId: id,
    expectedBoardVersion: z.number().int().nonnegative(),
    proposalId: id,
    expectedProposalVersion: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal('dismiss-proposal'),
    requestId: id,
    expectedBoardVersion: z.number().int().nonnegative(),
    proposalId: id,
    expectedProposalVersion: z.number().int().positive(),
  }),
])

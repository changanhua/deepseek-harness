/** FC-owner allowlists for supplied read observations and durable artifact inputs. */
import { z } from 'zod'
import { domainArtifactRefSchema, domainSourceRefSchema } from '@changanhua/dsh-domain-runtime'
const text = z.string().min(1).max(256)
const maybeText = text.nullable().optional()
const nonnegative = z.number().int().nonnegative().safe()
const maybeNumber = nonnegative.nullable().optional()
const time = z.iso.datetime({ offset: true })
/** Existing main-read card fields; undeclared data is discarded at admission. */
export const cardSchema = z.object({
  instanceId: maybeText, cardVersionId: maybeText, source: maybeText,
  locked: z.boolean().optional(), tradeable: z.boolean().optional(), reserveValue: maybeNumber,
  rating: maybeNumber, quality: maybeText, nationId: maybeText, leagueId: maybeText,
  clubId: maybeText, position: maybeText,
})
const constraintSchema = z.object({
  type: text, attribute: maybeText, field: maybeText, quality: maybeText, model: maybeText,
  values: z.array(text).max(32).optional(), minimum: maybeNumber, maximum: maybeNumber,
  min: maybeNumber, max: maybeNumber, exact: maybeNumber, count: maybeNumber,
})
/** Existing main-read challenge representation, including incomplete requirement evidence. */
export const challengeSchema = z.object({
  challengeId: maybeText, title: text, completed: z.boolean().optional(), formationName: maybeText,
  requirements: z.object({ status: z.enum(['complete', 'partial', 'unknown']).optional(), slotCount: maybeNumber,
    constraints: z.array(constraintSchema).max(64) }),
  rewards: z.array(z.object({ name: text })).max(32).optional(),
})
const pageSchema = z.object({ tabId: nonnegative, frameId: nonnegative, documentId: text, url: z.string().url().max(4096) })
const traversalSchema = z.object({ status: z.enum(['complete', 'partial', 'unknown']), pageCount: nonnegative, retrievedAll: z.boolean() })
/** Typed existing MAIN-world read result; no MAIN-world evaluation occurs in this package. */
export const mainReadSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('fc-sbc-main-read'), url: z.string().url().max(4096), capturedAt: time,
  platform: maybeText, status: z.enum(['complete', 'partial', 'unknown']),
  issues: z.array(z.object({ code: text, detail: z.string().max(512).optional() })).max(256),
  group: z.object({ status: z.enum(['complete', 'partial', 'unknown']), selectedSetId: maybeText,
    sets: z.array(z.object({ setId: text, title: text, challenges: z.array(challengeSchema).max(24) })).max(24) }),
  inventory: z.object({ coverage: z.enum(['complete', 'partial', 'visible-only', 'unread']),
    club: traversalSchema.optional(), sbcStorage: traversalSchema.optional(), cards: z.array(cardSchema).max(4000) }),
})
/** Bounded semantic page-probe fields used by the existing page model. */
export const probeSchema = z.object({
  url: z.string().url().max(4096), capturedAt: time, supported: z.boolean(), loginRequired: z.boolean().optional(),
  taskType: z.enum(['puzzle', 'item-score', 'unknown']).optional(),
  view: z.object({ kind: text, selectedChallenge: z.object({ title: text, visibleIndex: nonnegative }).nullable().optional() }).optional(),
  challengeSet: z.object({ title: maybeText, visibleChallengeCount: nonnegative.optional(),
    challenges: z.array(z.object({ title: text, completed: z.boolean().optional(),
      requirementLines: z.array(text).max(64).optional(), rewardLines: z.array(text).max(32).optional() })).max(24) }).optional(),
  inventory: z.object({ coverage: z.enum(['complete', 'partial', 'visible-only', 'unread']).optional(),
    sbcStorageVisible: z.boolean().optional(),
    visibleCards: z.array(cardSchema).max(2000).optional() }).optional(),
  marketAccess: z.object({ status: z.enum(['visible', 'blocked', 'unknown']) }).optional(),
})
/** One explicit observation envelope, not a browser command or generic invocation. */
export const captureRealitySchema = z.strictObject({
  requestId: text, page: pageSchema, installationId: text.optional(), clubId: text.optional(),
  read: mainReadSchema.optional(), probe: probeSchema.optional(),
  expiresAt: time.optional(), sourceRefs: z.array(domainSourceRefSchema).min(1).max(32),
}).refine(value => value.read !== undefined || value.probe !== undefined, 'a main read or semantic probe is required')
/** Exact immutable Reality reference plus explicit bounded solver choices. */
export const buildPlanSchema = z.strictObject({ requestId: text, realityRef: domainArtifactRefSchema,
  searchLimit: z.number().int().min(1).max(25000).optional(), candidateLimit: z.number().int().min(1).max(12).optional() })

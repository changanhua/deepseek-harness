/** Content data and commands share strict schemas; parsing never normalizes original text. */
import { z } from 'zod'

// Lone UTF-16 surrogates cannot round-trip through UTF-8. Reject, never replace them.
const text = z.string().refine(value => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value), 'Invalid Unicode text')
const id = text.refine(value => value.length > 0 && value.length <= 512, 'Invalid identity')
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const versionRef = id.nullable()

/** Stable outcome of a committed command; a retry returns the original revisions. */
export const ContentReceiptSchema = z.strictObject({
  operationId: id, entryId: id, entryRevision: revision,
  draftRevision: revision.nullable(), versionId: versionRef,
})

/** Request identity and outcome are stored atomically with the content they changed. */
export const OperationRecordSchema = z.strictObject({
  operationId: id, requestDigest: digest, result: ContentReceiptSchema,
}).refine(value => value.operationId === value.result.operationId, 'Receipt identity mismatch')

/** A trusted Session bridge resolves this source; user-supplied text cannot assert it. */
export const SessionSourceSchema = z.strictObject({
  type: z.literal('session-message'), sessionId: id, messageId: id, captureId: id,
  scope: z.literal('full-message'), verification: z.literal('host-verified'), boundary: z.literal('completed-text'),
})

/** Manually supplied text has no assertion about the completeness of an external conversation. */
export const ProvidedSourceSchema = z.strictObject({
  type: z.literal('user-provided'), scope: z.literal('provided-text'), verification: z.literal('unverified'),
})

/** An external page reports its own metadata and cannot claim Host verification. */
export const WebSourceSchema = z.strictObject({
  type: z.literal('web-page'), scope: z.enum(['selection', 'single-reply']), verification: z.literal('unverified'),
  url: z.url().refine((value) => {
    try {
      const parsed = new URL(value)
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && parsed.username.length === 0 && parsed.password.length === 0
    } catch {
      return false
    }
  }, 'Expected credential-free HTTP(S) URL'),
  pageTitle: text, site: text, capturedAt: z.iso.datetime(), externalMessageId: id.optional(),
})

/** Immutable text revision. Providers verify bodySha256 over the exact UTF-8 body on open. */
export const ContentVersionSchema = z.strictObject({
  id, number: revision, title: text, body: text, bodySha256: digest,
  createdAt: z.iso.datetime(), operation: OperationRecordSchema,
})

/** A draft can change; its base must remain the current immutable head. */
export const ContentDraftSchema = z.strictObject({
  title: text, body: text, draftRevision: revision, basedOnVersionId: versionRef,
})

/** Complete per-entry atomic record. Revisions, references and receipt history fail closed. */
export const ContentEntrySchema = z.strictObject({
  id, kind: z.enum(['idea', 'original']), createdAt: z.iso.datetime(), entryRevision: revision,
  source: z.union([SessionSourceSchema, ProvidedSourceSchema, WebSourceSchema]).nullable(),
  versions: z.array(ContentVersionSchema), headVersionId: versionRef, draft: ContentDraftSchema.nullable(),
  projectRefs: z.array(id), favorite: z.boolean(), archived: z.boolean(),
  creation: OperationRecordSchema, receipts: z.array(OperationRecordSchema).min(1).max(256),
}).superRefine((entry, ctx) => {
  const fail = () => { ctx.addIssue({ code: 'custom', message: 'Inconsistent content record' }) }
  const versions = entry.versions
  if (entry.headVersionId !== (versions.at(-1)?.id ?? null)) fail()
  if ((entry.kind === 'original') !== (entry.source !== null)) fail()
  if (entry.kind === 'original' && versions.length === 0) fail()
  if (versions.length === 0 && entry.draft === null) fail()
  if (entry.draft && (entry.draft.basedOnVersionId !== entry.headVersionId
    || entry.draft.draftRevision > entry.entryRevision)) fail()
  if (new Set(entry.projectRefs).size !== entry.projectRefs.length) fail()
  if (new Set(versions.map(value => value.id)).size !== versions.length) fail()
  if (new Set(versions.map(value => value.operation.operationId)).size !== versions.length) fail()
  if (new Set(entry.receipts.map(value => value.operationId)).size !== entry.receipts.length) fail()
  const byOperation = new Map<string, string>()
  const versionIds = new Set(versions.map(value => value.id))
  const operations = [entry.creation, ...entry.receipts, ...versions.map(value => value.operation)]
  for (const operation of operations) {
    const result = operation.result
    if (result.entryId !== entry.id || result.entryRevision > entry.entryRevision
      || (result.draftRevision !== null && result.draftRevision > result.entryRevision)
      || (result.versionId !== null && !versionIds.has(result.versionId))) fail()
    const serialized = JSON.stringify(operation)
    const previous = byOperation.get(operation.operationId)
    if (previous !== undefined && previous !== serialized) fail()
    byOperation.set(operation.operationId, serialized)
  }
  if (entry.creation.result.entryRevision !== 1) fail()
  if (entry.receipts.at(-1)?.result.entryRevision !== entry.entryRevision) fail()
  for (const [index, version] of versions.entries()) {
    if (version.number !== index + 1 || version.operation.result.versionId !== version.id
      || version.operation.result.draftRevision !== null) fail()
  }
})

const commandIdentity = { entryId: id, operationId: id }
const draftGuard = { expectedDraftRevision: revision, basedOnVersionId: versionRef }

/** Only the named changes are permitted; save-text accepts only unverified provided or web sources. */
export const ContentCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('create'), ...commandIdentity, title: text, body: text }),
  z.strictObject({
    type: z.literal('save-text'), ...commandIdentity, title: text, body: text,
    source: z.union([ProvidedSourceSchema, WebSourceSchema]).optional(),
  }),
  z.strictObject({ type: z.literal('start-draft'), ...commandIdentity, expectedEntryRevision: revision }),
  z.strictObject({ type: z.literal('save-draft'), ...commandIdentity, ...draftGuard, title: text, body: text }),
  z.strictObject({ type: z.literal('commit-version'), ...commandIdentity, ...draftGuard, expectedHeadVersionId: versionRef }),
  z.strictObject({
    type: z.literal('metadata'), ...commandIdentity, expectedEntryRevision: revision,
    favorite: z.boolean().optional(), archived: z.boolean().optional(),
    addProjectRef: id.optional(), removeProjectRef: id.optional(),
  }).refine(value => value.favorite !== undefined || value.archived !== undefined
    || value.addProjectRef !== undefined || value.removeProjectRef !== undefined, 'Empty metadata command'),
])

/** Capture requests carry source references only; content comes from the trusted resolver. */
export const CaptureCommandSchema = z.strictObject({ operationId: id, sessionId: id, messageId: id })

/** Completed text prepared by a trusted in-process source resolver. */
export const ResolvedCaptureSchema = z.strictObject({ source: SessionSourceSchema, title: text, body: text })

/** Provider-owned UTF-8 byte budgets; parsing imposes no policy defaults. */
export const ContentLimitsSchema = z.strictObject({ bodyBytes: revision, entryBytes: revision, libraryBytes: revision })

/** Complete logical export at a committed point; not a database-file backup. */
export const ContentSnapshotSchema = z.strictObject({ formatVersion: z.literal(1), entries: z.array(ContentEntrySchema) })

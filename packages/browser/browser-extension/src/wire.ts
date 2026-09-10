import { z } from 'zod'

export const BROWSER_EXTENSION_PATH = '/api/browser-extension/v1'
export const extensionIdSchema = z.string().regex(/^[a-p]{32}$/u)
export const jsonValueSchema = z.json()
const id = z.string().min(1).max(128)
const page = z.object({ tabId: z.number().int().nonnegative(), frameId: z.number().int().nonnegative(),
  documentId: id, url: z.url().max(8192).refine(value => ['http:', 'https:'].includes(new URL(value).protocol)) }).strict()
const element = z.object({ page, snapshotId: id, elementId: id }).strict()
/** Bounded browser-observed facts presented for approval, never a page-owned form value. */
export const browserActionDescriptionSchema = z.object({
  kind: z.enum(['navigate', 'click', 'fill', 'submit', 'scroll', 'wait', 'double_click', 'right_click', 'hover', 'press', 'select', 'check', 'drag', 'upload', 'back', 'forward', 'reload', 'tab_open', 'tab_close', 'tab_focus', 'screenshot']), page,
  title: z.string().max(256),
  target: z.object({ tag: z.string().max(128), label: z.string().max(256), type: z.string().max(256) }).strict().optional(),
  effect: z.enum(['local-disclosure', 'navigation', 'form-submit', 'input-change', 'unknown', 'scroll', 'wait']),
  destination: z.url().max(8192).optional(), valuePreview: z.string().max(180).optional(),
}).strict()
/** Extension observation after page-local prepare; its opaque id never leaves the Host ticket table. */
export const browserPreparationSchema = z.object({
  preparationId: z.uuid({ version: 'v4' }), expiresAt: z.number().int().positive(), description: browserActionDescriptionSchema,
}).strict()

/** Domain actions accepted by every entry into the provider, including direct callers. */
export const browserActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tabs') }).strict(),
  z.object({ kind: z.literal('snapshot'), tabId: z.number().int().nonnegative(), frameId: z.number().int().nonnegative(), documentId: id.optional(),
    query: z.string().max(256).optional(), offset: z.number().int().min(0).max(10000).optional(),
    limit: z.number().int().min(1).max(128).optional(), textLimit: z.number().int().min(0).max(50000).optional(),
    tree: z.boolean().optional(), treeCursor: z.string().min(1).max(256).optional(),
    treeLimit: z.number().int().min(1).max(1000).optional(), includeOptions: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('entry_inspect'), page, regionSelector: z.string().min(1).max(256),
    selector: z.string().min(1).max(256), titleSelector: z.string().max(256).optional(),
    linkSelector: z.string().max(256).optional(), sampleLimit: z.number().int().min(1).max(12).optional() }).strict(),
  z.object({ kind: z.literal('navigate'), page, url: z.url().max(8192).refine(value => ['http:', 'https:'].includes(new URL(value).protocol)) }).strict(),
  z.object({ kind: z.literal('click'), element, intent: z.string().min(1).max(1024) }).strict(),
  z.object({ kind: z.literal('fill'), element, intent: z.string().min(1).max(1024), value: z.string().max(16384) }).strict(),
  z.object({ kind: z.literal('submit'), element, intent: z.string().min(1).max(1024) }).strict(),
  ...(['double_click', 'right_click', 'hover'] as const).map(kind => z.object({ kind: z.literal(kind), element, intent: z.string().min(1).max(1024) }).strict()),
  z.object({ kind: z.literal('press'), element, intent: z.string().min(1).max(1024), key: z.string().min(1).max(80) }).strict(),
  z.object({ kind: z.literal('select'), element, intent: z.string().min(1).max(1024), values: z.array(z.string().max(1024)).max(128) }).strict(),
  z.object({ kind: z.literal('check'), element, intent: z.string().min(1).max(1024), checked: z.boolean() }).strict(),
  z.object({ kind: z.literal('drag'), element, intent: z.string().min(1).max(1024), target: element }).strict(),
  z.object({ kind: z.literal('upload'), element, intent: z.string().min(1).max(1024), files: z.array(z.string().max(8192).regex(/^(?:[a-z]:[\\/]|\/|\\\\)/iu)).max(16) }).strict(),
  ...(['back', 'forward', 'reload', 'tab_close', 'tab_focus', 'screenshot'] as const).map(kind => z.object({ kind: z.literal(kind), page }).strict()),
  z.object({ kind: z.literal('tab_open'), page, url: z.url().max(8192).refine(value => ['http:', 'https:'].includes(new URL(value).protocol)) }).strict(),
  z.object({ kind: z.literal('scroll'), page, x: z.number().int().min(-100000).max(100000), y: z.number().int().min(-100000).max(100000) }).strict(),
  z.object({ kind: z.literal('wait'), page, milliseconds: z.number().int().min(0).max(15000) }).strict(),
  z.object({ kind: z.literal('entry_mount'), page, mountId: id, regionSelector: z.string().min(1).max(256).optional(), selector: z.string().min(1).max(256),
    label: z.string().min(1).max(64), titleSelector: z.string().max(256).optional(),
    linkSelector: z.string().max(256).optional(),
    collected: z.array(z.string().max(8192)).max(512).optional() }).strict(),
  z.object({ kind: z.literal('entry_unmount'), page, mountId: id, forgetCollected: z.boolean().optional() }).strict(),
])
const identity = z.object({
  protocolVersion: z.literal(1), grantEpoch: z.number().int().positive(), requestId: z.uuid({ version: 'v4' }),
  installationId: z.uuid({ version: 'v4' }), sessionId: id, deadline: z.number().int().positive(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
})
const receipt = identity.extend({
  outcome: z.enum(['observed', 'failed', 'cancelled', 'unknown']), value: jsonValueSchema.optional(),
  reason: z.string().max(1024).optional(), quiescent: z.boolean().optional(),
}).strict()
/** Authentication is a bounded first frame, never a credential in the URL. */
export const extensionFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), protocolVersion: z.literal(1), installationId: z.uuid({ version: 'v4' }), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict(),
  z.object({ type: z.literal('result'), receipt }).strict(),
  z.object({ type: z.literal('pong') }).strict(),
  z.object({ type: z.literal('request'), requestId: z.uuid({ version: 'v4' }), method: z.enum(['instances',
    'reading.models', 'reading.model', 'reading.generate', 'reading.stop',
    'session.list', 'session.create', 'session.prompt', 'session.cancel', 'session.follow', 'session.unfollow', 'session.page', 'session.attachment',
    'approval.presence', 'approval.decide', 'browser.acknowledge', 'browser.entryEvent', 'monitor.list', 'monitor.create', 'monitor.pause', 'monitor.resume',
    'monitor.acknowledge', 'activity.state', 'activity.configure', 'activity.append', 'activity.query']), params: z.json().optional() }).strict(),
])
export const connectSchema = z.object({
  extensionId: extensionIdSchema, installationId: z.uuid({ version: 'v4' }), challenge: z.string().max(128),
  scopes: z.array(z.string().max(32)).max(4), origins: z.array(z.string().max(512)).max(64),
}).strict()
export const exchangeSchema = z.object({ installationId: z.uuid({ version: 'v4' }), verifier: z.string().max(128) }).strict()
export const approveSchema = z.object({ requestId: z.uuid({ version: 'v4' }), scopes: z.array(z.string().max(32)).max(4), origins: z.array(z.string().max(512)).max(64) }).strict()
export const revokeSchema = z.object({ installationId: z.uuid({ version: 'v4' }) }).strict()
export const requestSchema = z.object({ requestId: z.uuid({ version: 'v4' }) }).strict()
export const approvalPresenceSchema = z.object({ sessionId: z.string().min(1).max(128).nullable() }).strict()
export const approvalDecideSchema = z.object({ sessionId: z.string().min(1).max(128), id: z.uuid({ version: 'v4' }), decision: z.enum(['allowed-once', 'rejected']) }).strict()
export const browserAcknowledgeSchema = z.object({ receipt: identity.extend({
  outcome: z.enum(['observed', 'failed', 'cancelled', 'unknown']), quiescent: z.literal(true),
}).strict() }).strict()

/** One mounted page entry reporting a user click; the Host gate checks it against the mount table. */
export const entryEventSchema = z.object({
  mountId: id, tabId: z.number().int().nonnegative(), frameId: z.number().int().nonnegative(),
  documentId: id, url: z.url().max(8192), title: z.string().max(512), link: z.string().max(8192),
}).strict()
export type EntryEventInput = z.infer<typeof entryEventSchema>

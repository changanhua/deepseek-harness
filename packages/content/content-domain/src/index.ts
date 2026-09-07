/** Durable content provider. Preparations never hold the Domain's write chain. */
import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import {
  CaptureCommandSchema, Content, ContentCommandSchema, ContentEntrySchema, ContentError,
  ContentLimitsSchema, ResolvedCaptureSchema,
} from '@changanhua/dsh-content'
import type {
  CaptureCommand, ContentAccess, ContentCommand, ContentEntry, ContentErrorCode, ContentLimits,
  ContentReceipt, ContentSnapshot, ContentSourceResolver, ContentStatus, OperationRecord, ResolvedCapture,
} from '@changanhua/dsh-content'
import type { Domain, DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { contentDomainSpec } from './spec.ts'
import { createEntry, mutateEntry } from './mutations.ts'

export { contentDomainSpec } from './spec.ts'

/** Provider-owned UTF-8 byte budgets. */
export const DEFAULT_CONTENT_LIMITS: ContentLimits = Object.freeze({
  bodyBytes: 1_048_576, entryBytes: 8_388_608, libraryBytes: 134_217_728,
})

/** Byte limits count all retained data; lowering them never prevents reading existing valid data. */
export interface Config {
  /** Maximum UTF-8 bytes in one retained body. */
  bodyBytes?: number
  /** Maximum JSON UTF-8 bytes in one entry, including versions and receipts. */
  entryBytes?: number
  /** Maximum JSON UTF-8 bytes in the complete logical Domain envelope. */
  libraryBytes?: number
}

/** Loader configuration; constructor validation also covers direct service composition. */
export const Config: Schema<Config> = Schema.object({
  bodyBytes: Schema.number().step(1).min(1).default(DEFAULT_CONTENT_LIMITS.bodyBytes),
  entryBytes: Schema.number().step(1).min(1).default(DEFAULT_CONTENT_LIMITS.entryBytes),
  libraryBytes: Schema.number().step(1).min(1).default(DEFAULT_CONTENT_LIMITS.libraryBytes),
})

/** One dependency activation owns admission, preparations, writes and the Domain lifetime. */
interface Activation {
  accepting: boolean
  stopping: boolean
  domain?: Domain<typeof contentDomainSpec>
  table?: KvTable<string, ContentEntry>
  chain: Promise<void>
  pending: Set<Promise<unknown>>
  overCapacity: boolean
}

const settled = () => {}

/** Implements atomic editing without registering model tools or a transport endpoint. */
export class ContentDomain extends Content {
  private readonly limits: ContentLimits
  private state: ContentStatus
  private activation?: Activation

  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.limits = Object.freeze(parse(ContentLimitsSchema, {
      bodyBytes: config.bodyBytes ?? DEFAULT_CONTENT_LIMITS.bodyBytes,
      entryBytes: config.entryBytes ?? DEFAULT_CONTENT_LIMITS.entryBytes,
      libraryBytes: config.libraryBytes ?? DEFAULT_CONTENT_LIMITS.libraryBytes,
    }))
    this.state = { phase: 'unavailable', reason: 'unavailable', limits: this.limits }
  }

  protected [Service.init](): void {
    this.ctx.inject(['storageDomain'], async (ctx) => {
      const active: Activation = {
        accepting: false, stopping: false, chain: Promise.resolve(), pending: new Set(), overCapacity: false,
      }
      this.activation = active
      this.setState('opening', null)
      const opening = this.open(active, ctx.storageDomain)
      ctx.effect(() => async () => {
        active.accepting = false
        active.stopping = true
        await opening
        // Preparations admitted before shutdown may still enqueue their commit.
        await Promise.allSettled([...active.pending])
        await active.chain
        delete active.table
        await active.domain?.close()
        // Cordis settles this dependency activation before starting its successor.
        delete this.activation
        this.setState('closed', 'closed')
      })
      await opening
    })
  }

  status(): ContentStatus { return structuredClone(this.state) }

  get(id: string, authorize: ContentAccess): ContentEntry | undefined {
    authorize()
    return structuredClone(this.table(this.admit()).get(id))
  }

  snapshot(authorize: ContentAccess): ContentSnapshot {
    authorize()
    return { formatVersion: 1, entries: [...this.table(this.admit()).entries()].map(([, value]) => structuredClone(value)) }
  }

  receipt(entryId: string, operationId: string, authorize: ContentAccess): ContentReceipt | undefined {
    authorize()
    return structuredClone(findOperation(this.table(this.admit()).get(entryId), operationId)?.result)
  }

  async execute(command: ContentCommand, authorize: ContentAccess): Promise<ContentReceipt> {
    authorize()
    const active = this.admit()
    const parsed = parse(ContentCommandSchema, command)
    return this.track(active, this.enqueue(active, async () => {
      authorize()
      const previous = this.table(active).get(parsed.entryId)
      const requestDigest = hash(parsed)
      const known = findOperation(previous, parsed.operationId)
      if (known) return replay(known, requestDigest)
      if (parsed.type === 'create' || parsed.type === 'save-text') {
        if (previous) throw new ContentError('operation_conflict')
        return this.write(active, createEntry(parsed, requestDigest, parsed.type === 'save-text' ? parsed.source : undefined))
      }
      if (!previous) throw new ContentError('not_found')
      return this.write(active, mutateEntry(previous, parsed, requestDigest))
    }))
  }

  async capture(
    command: CaptureCommand, resolveSource: ContentSourceResolver, authorize: ContentAccess,
  ): Promise<ContentReceipt> {
    authorize()
    const active = this.admit()
    const request = parse(CaptureCommandSchema, command)
    const prepare = async () => {
      // Resolver code cannot mutate the retained request identity.
      const resolved = parse(ResolvedCaptureSchema, await resolveSource(structuredClone(request)))
      if (resolved.source.sessionId !== request.sessionId || resolved.source.messageId !== request.messageId) {
        throw new ContentError('source_conflict')
      }
      return this.enqueue(active, async () => {
        authorize()
        return this.commitCapture(active, request, resolved)
      })
    }
    return this.track(active, prepare())
  }

  private async open(active: Activation, facility: DomainFacility): Promise<void> {
    try {
      const domain = await facility.open(contentDomainSpec)
      active.domain = domain
      const table = domain.table('entries')
      for (const [key, entry] of table.entries()) {
        if (key !== entry.id) throw new ContentError('invalid_library')
        verifyDigest(entry)
      }
      active.table = table
      active.overCapacity = !this.fits([...table.entries()])
      active.accepting = !active.stopping
      this.setState('ready', active.overCapacity ? 'capacity_exceeded' : null)
    } catch (error) {
      delete active.table
      try { await active.domain?.close() } catch { this.ctx.logger.warn('Content Domain close failed after rejected open') }
      this.setState('unavailable', classifyOpenError(error))
    }
  }

  private async commitCapture(
    active: Activation, request: CaptureCommand, resolved: ResolvedCapture,
  ): Promise<ContentReceipt> {
    const { sessionId, messageId, captureId } = resolved.source
    const entryId = `source_${hash({ sessionId, messageId, captureId })}`
    const requestDigest = hash({ type: 'capture', request, resolved })
    const previous = this.table(active).get(entryId)
    const known = findOperation(previous, request.operationId)
    if (known) return replay(known, requestDigest)
    if (previous) {
      const source = previous.source
      if (source?.type !== 'session-message' || source.sessionId !== sessionId
        || source.messageId !== messageId || source.captureId !== captureId
        || previous.versions[0]?.body !== resolved.body) throw new ContentError('source_conflict')
      return structuredClone(previous.creation.result)
    }
    return this.write(active, createEntry({
      type: 'save-text', entryId, operationId: request.operationId, title: resolved.title, body: resolved.body,
    }, requestDigest, resolved.source))
  }

  private async write(active: Activation, next: ContentEntry): Promise<ContentReceipt> {
    const record = parse(ContentEntrySchema, next)
    verifyDigest(record)
    const table = this.table(active)
    const entries = new Map(table.entries())
    entries.set(record.id, record)
    if (active.overCapacity || !this.fits([...entries])) throw new ContentError('capacity_exceeded')
    // ContentEntrySchema requires a non-empty receipt list ending at the current revision.
    const receipt = record.receipts.at(-1) as OperationRecord
    try {
      if (table.get(record.id)) await table.update(record.id, () => record)
      else await table.put(record.id, record)
    } catch {
      // KV rejects do not universally prove rollback. Drop the cache and require a complete reopen.
      active.accepting = false
      delete active.table
      this.setState('unavailable', 'storage_failed')
      try { await active.domain?.close() } catch { this.ctx.logger.warn('Content Domain close failed after uncertain write') }
      throw new ContentError('storage_failed')
    }
    return structuredClone(receipt.result)
  }

  private fits(entries: Array<[string, ContentEntry]>): boolean {
    for (const [, entry] of entries) {
      if (jsonBytes(entry) > this.limits.entryBytes) return false
      const bodies = entry.versions.map(version => version.body)
      if (entry.draft) bodies.push(entry.draft.body)
      if (bodies.some(body => Buffer.byteLength(body, 'utf8') > this.limits.bodyBytes)) return false
    }
    return jsonBytes({ tables: { entries: Object.fromEntries(entries) }, global: null }) <= this.limits.libraryBytes
  }

  private admit(): Activation {
    const active = this.activation
    if (active?.stopping) throw new ContentError('closed')
    if (!active?.accepting) throw new ContentError(this.state.reason ?? 'unavailable')
    return active
  }

  private table(active: Activation): KvTable<string, ContentEntry> {
    if (!active.table) throw new ContentError('storage_failed')
    return active.table
  }

  private enqueue<T>(active: Activation, job: () => Promise<T>): Promise<T> {
    const result = active.chain.then(job)
    active.chain = result.then(settled, settled)
    return result
  }

  private track<T>(active: Activation, promise: Promise<T>): Promise<T> {
    active.pending.add(promise)
    void promise.then(() => active.pending.delete(promise), () => active.pending.delete(promise))
    return promise
  }

  private setState(phase: ContentStatus['phase'], reason: ContentErrorCode | null): void {
    this.state = { phase, reason, limits: this.limits }
  }
}

/** Validator details may contain input; only a payload-free classification crosses the service. */
function parse<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try { return schema.parse(value) } catch { throw new ContentError('invalid_request') }
}

function classifyOpenError(error: unknown): ContentErrorCode {
  if (error instanceof ContentError) return error.code
  if (error && typeof error === 'object') {
    if ('errcode' in error && error.errcode === 5) return 'library_in_use'
    if ('code' in error && ['invalid-record', 'version-mismatch', 'malformed-medium'].includes(String(error.code))) {
      return 'invalid_library'
    }
  }
  return 'storage_failed'
}

/** The recent window may expire; creation and version operations remain permanently queryable. */
function findOperation(entry: ContentEntry | undefined, operationId: string): OperationRecord | undefined {
  if (!entry) return undefined
  return [entry.creation, ...entry.receipts, ...entry.versions.map(version => version.operation)]
    .find(operation => operation.operationId === operationId)
}

function replay(operation: OperationRecord, requestDigest: string): ContentReceipt {
  if (operation.requestDigest !== requestDigest) throw new ContentError('operation_conflict')
  return structuredClone(operation.result)
}

function verifyDigest(entry: ContentEntry): void {
  for (const version of entry.versions) {
    if (version.bodySha256 !== hash(version.body)) throw new ContentError('invalid_library')
  }
}

/** Request digests ignore property insertion order, but retain every supplied semantic field. */
function canonical(value: unknown): string {
  // Every caller passes a parsed command/source object; these schemas contain no arrays or undefined roots.
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).filter(key => object[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
}

function hash(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value), 'utf8').digest('hex')
}

function jsonBytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8') }

export default ContentDomain

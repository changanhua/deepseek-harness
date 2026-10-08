/** Fixed-file role transport. The Host retains its original handles, so worker path replacement cannot redirect Host reads. */
import { createHash, timingSafeEqual } from 'node:crypto'
import { open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** One bounded request or response. Sequence ownership stays with the Host controller. */
export interface RoleFrame { readonly sequence: number
  readonly kind: string
  readonly value: unknown }

/** Duplex files owned for the complete role lifetime, with separate write directions. */
export class RoleChannel {
  private closed = false
  private constructor(private readonly incoming: FileHandle, private readonly outgoing: FileHandle,
    private readonly maxBytes: number, private readonly cancellation: FileHandle, private readonly host: boolean) {}

  /**
   * Create fresh files before granting the role access. Existing entries are never adopted by the Host.
   * @param directory New Host-owned directory for exactly one role execution.
   * @param maxBytes Complete JSON frame bound, excluding the fixed length and digest framing.
   * @returns Host channel retaining original handles until process quiescence.
   */
  static async create(directory: string, maxBytes: number): Promise<RoleChannel> {
    RoleChannel.checkBound(maxBytes)
    const incoming = await open(join(directory, 'request'), 'wx+')
    try {
      const outgoing = await open(join(directory, 'response'), 'wx+')
      try { return new RoleChannel(incoming, outgoing, maxBytes, await open(join(directory, 'cancel'), 'wx+'), true) }
      catch (error) { await outgoing.close(); throw error }
    } catch (error) { await incoming.close(); throw error }
  }

  /**
   * Open the worker's opposite ends inside its own writable directory.
   * @param directory Role-specific path carried in the sealed launch configuration.
   * @param maxBytes Same finite frame bound selected by the Host.
   * @returns Worker channel; it has no references to another execution's channel.
   */
  static async connect(directory: string, maxBytes: number): Promise<RoleChannel> {
    RoleChannel.checkBound(maxBytes)
    const incoming = await open(join(directory, 'response'), 'r')
    try {
      const outgoing = await open(join(directory, 'request'), 'r+')
      try { return new RoleChannel(incoming, outgoing, maxBytes, await open(join(directory, 'cancel'), 'r'), false) }
      catch (error) { await outgoing.close(); throw error }
    }
    catch (error) { await incoming.close(); throw error }
  }

  /**
   * Publish a complete checksummed frame. An interrupted write is not a request to dispatch.
   * @param frame New sequence and bounded JSON value; model requests must not be retried after uncertain dispatch.
   */
  async send(frame: RoleFrame): Promise<void> {
    this.assertOpen()
    RoleChannel.validate(frame)
    const bytes = Buffer.from(JSON.stringify(frame))
    if (bytes.byteLength > this.maxBytes) throw new Error('eval-channel-capacity')
    const digest = createHash('sha256').update(bytes).digest()
    const header = Buffer.alloc(4)
    await this.writeAll(header, 0)
    await this.writeAll(Buffer.concat([bytes, digest]), 4)
    header.writeUInt32LE(bytes.length)
    await this.outgoing.truncate(bytes.length + 36)
    await this.writeAll(header, 0)
  }

  /**
   * Read through the original handle, never by reopening a worker-supplied path.
   * @returns A fully validated frame, or undefined while a writer has not committed a complete frame.
   */
  async read(): Promise<RoleFrame | undefined> {
    this.assertOpen()
    const size = (await this.incoming.stat()).size
    if (size > this.maxBytes + 36) throw new Error('eval-channel-capacity')
    const header = Buffer.alloc(4)
    if ((await this.incoming.read(header, 0, 4, 0)).bytesRead !== 4) return undefined
    const length = header.readUInt32LE()
    if (length === 0) return undefined
    if (length > this.maxBytes) throw new Error('eval-channel-capacity')
    const body = Buffer.alloc(length + 32)
    if ((await this.incoming.read(body, 0, body.length, 4)).bytesRead !== body.length) return undefined
    const confirmed = Buffer.alloc(4)
    if ((await this.incoming.read(confirmed, 0, 4, 0)).bytesRead !== 4 || !confirmed.equals(header)) return undefined
    const payload = body.subarray(0, length)
    if (!timingSafeEqual(createHash('sha256').update(payload).digest(), body.subarray(length))) return undefined
    const value: unknown = JSON.parse(payload.toString('utf8'))
    RoleChannel.validate(value)
    return value
  }

  /**
   * Wait for one exact response with caller-owned cancellation. This retries reads, never model dispatch.
   * @param sequence Exact outstanding operation sequence.
   * @param signal Execution deadline and cancellation owned by the controller.
   * @returns Matching response; an unsolicited future sequence fails the protocol.
   */
  async receive(sequence: number, signal: AbortSignal): Promise<RoleFrame> {
    while (true) {
      signal.throwIfAborted()
      const frame = await this.read()
      if (frame?.sequence === sequence) return frame
      if (frame && frame.sequence > sequence) throw new Error('eval-channel-sequence-mismatch')
      await delay(20, undefined, { signal })
    }
  }

  /** Publish a monotonic cancellation byte without overwriting an outstanding model response. */
  async requestCancellation(): Promise<void> {
    this.assertOpen()
    if (!this.host) throw new Error('eval-channel-role-cannot-cancel')
    if ((await this.cancellation.write(Buffer.from([1]), 0, 1, 0)).bytesWritten !== 1) throw new Error('eval-channel-write-uncertain')
  }

  /** Wait on the originally opened control handle; the caller must abort and join this wait before close. */
  async waitForCancellation(signal: AbortSignal): Promise<void> {
    const byte = Buffer.alloc(1)
    while (true) {
      signal.throwIfAborted()
      this.assertOpen()
      if ((await this.cancellation.read(byte, 0, 1, 0)).bytesRead === 1 && byte[0] === 1) return
      await delay(20, undefined, { signal })
    }
  }

  /** Close handles after the role and any broker operation have quiesced. */
  async close(): Promise<void> {
    if (this.closed) return
    const result = await Promise.allSettled([this.incoming.close(), this.outgoing.close(), this.cancellation.close()])
    this.closed = true
    const failed = result.filter(item => item.status === 'rejected')
    if (failed.length) throw new AggregateError(failed.map(item => item.reason as unknown), 'eval-channel-close-uncertain')
  }

  private assertOpen(): void { if (this.closed) throw new Error('eval-channel-closed') }
  private static checkBound(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1 || value > 0xffff_ffff - 36) throw new Error('eval-channel-invalid-bound')
  }
  private static validate(value: unknown): asserts value is RoleFrame {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('sequence' in value)
      || typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) || value.sequence < 1
      || !('kind' in value) || typeof value.kind !== 'string' || !value.kind || !('value' in value)
      || Object.keys(value).some(key => !['sequence', 'kind', 'value'].includes(key))) throw new Error('eval-channel-invalid-frame')
  }
  private async writeAll(bytes: Buffer, position: number): Promise<void> {
    let offset = 0
    while (offset < bytes.length) {
      const { bytesWritten } = await this.outgoing.write(bytes, offset, bytes.length - offset, position + offset)
      if (!bytesWritten) throw new Error('eval-channel-write-uncertain')
      offset += bytesWritten
    }
  }
}

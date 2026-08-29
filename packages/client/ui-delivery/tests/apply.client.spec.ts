// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyHost } from '../src/index.ts'
import * as DeliveryInvariant from '../src/invariant.ts'
import { apply, inject } from '../src/client/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function bench(snapshot = { contractsWithoutPacket: [], cards: [] }) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  const registerLocale = vi.spyOn(locale, 'register')
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
  }
  new RemoteService(ctx)
  const snapshotCall = vi.fn(async (_signal?: AbortSignal) => ({
    ok: true as const,
    value: snapshot,
  }))
  const remote = {
    snapshot: snapshotCall,
    importIssue: vi.fn(),
    createPacket: vi.fn(),
    startChange: vi.fn(),
    startVerification: vi.fn(),
    readEvidence: vi.fn(),
    recordDecision: vi.fn(),
  }
  ctx.provide('remote.delivery', remote)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'shell.view': { kind: 'list', scope: 'root' },
      'sidebar.modules': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return { ctx, slots, snapshotCall, registerLocale, remote }
}

describe('ui-delivery client composition', () => {
  it('keeps the node half inert and registers its package invariant companion', async () => {
    applyHost()
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(DeliveryInvariant).await()).resolves.toBeDefined()
  })
  it('declares only the Remote, locale, and two existing slot services it consumes', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.delivery'])
  })

  it('registers one Delivery module and one shared host-backed workspace projection', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const workspace = b.slots.entries('shell.view')
    const navigation = b.slots.entries('sidebar.modules')
    expect(workspace).toHaveLength(1)
    expect(workspace[0]!.options.id).toBe('delivery')
    expect(navigation).toHaveLength(1)
    expect(navigation[0]!.options).toMatchObject({ id: 'delivery-module', order: 8 })
    expect(b.registerLocale).toHaveBeenCalledWith('delivery', expect.any(Object))
    expect(b.snapshotCall).toHaveBeenCalledOnce()

    const face = (workspace[0]!.inject as unknown as () => {
      hooks: { delivery: { getSnapshot(): { status: string; snapshot?: unknown } } }
      refresh(): void
      cancel(): void
    })()
    await vi.waitFor(() => {
      expect(face.hooks.delivery.getSnapshot()).toMatchObject({
        status: 'ready',
        snapshot: { contractsWithoutPacket: [], cards: [] },
      })
    })

    await fiber.dispose()
    expect(b.slots.entries('shell.view')).toHaveLength(0)
    expect(b.slots.entries('sidebar.modules')).toHaveLength(0)
  })

  it('aborts the active snapshot read when the plugin is disposed', async () => {
    let observedSignal: AbortSignal | undefined
    let settle!: (value: { ok: true; value: { contractsWithoutPacket: never[]; cards: never[] } }) => void
    const b = await bench()
    const remote = b.ctx.get('remote.delivery') as unknown as {
      snapshot(signal?: AbortSignal): Promise<unknown>
    }
    vi.spyOn(remote, 'snapshot').mockImplementation((signal?: AbortSignal) => {
      observedSignal = signal
      return new Promise((resolve) => { settle = resolve })
    })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await vi.waitFor(() => { expect(observedSignal).toBeInstanceOf(AbortSignal) })

    await fiber.dispose()

    expect(observedSignal?.aborted).toBe(true)
    settle({ ok: true, value: { contractsWithoutPacket: [], cards: [] } })
  })

  it('runs an explicit operation with a cancellable signal and refreshes after success', async () => {
    const b = await bench()
    b.remote.importIssue.mockResolvedValue({
      ok: true,
      value: { id: 'contract-1' },
    })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = (b.slots.entries('shell.view')[0]!.inject as unknown as () => {
      hooks: { delivery: { getSnapshot(): { pending: string | null; status: string } } }
      importIssue(input: { issueUrl: string; repositoryId: string }): Promise<boolean>
    })()
    await vi.waitFor(() => { expect(face.hooks.delivery.getSnapshot().status).toBe('ready') })

    await expect(face.importIssue({
      issueUrl: 'https://github.com/deepseek-ai/deepseek-harness/issues/1',
      repositoryId: 'repository-1',
    })).resolves.toBe(true)

    expect(b.remote.importIssue).toHaveBeenCalledWith(
      {
        issueUrl: 'https://github.com/deepseek-ai/deepseek-harness/issues/1',
        repositoryId: 'repository-1',
      },
      expect.any(AbortSignal),
    )
    expect(b.snapshotCall).toHaveBeenCalledTimes(2)
  })

  it('wires every workspace action and the navigation projection to the shared controller', async () => {
    const b = await bench()
    for (const operation of [
      b.remote.createPacket,
      b.remote.startVerification,
      b.remote.readEvidence,
      b.remote.recordDecision,
    ]) operation.mockResolvedValue({ ok: true, value: {} })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const workspace = (b.slots.entries('shell.view')[0]!.inject as unknown as () => {
      hooks: { delivery: unknown }
      refresh(): void
      cancel(): void
      createPacket(input: unknown): Promise<boolean>
      startVerification(input: unknown): Promise<boolean>
      readEvidence(input: unknown): Promise<boolean>
      recordDecision(input: unknown): Promise<boolean>
    })()
    const navigation = (b.slots.entries('sidebar.modules')[0]!.inject as unknown as () => {
      hooks: { delivery: unknown }
    })()

    expect(navigation.hooks.delivery).toBe(workspace.hooks.delivery)
    workspace.refresh()
    workspace.cancel()
    await expect(workspace.createPacket({ contractRevisionId: 'contract-1' })).resolves.toBe(true)
    await vi.waitFor(() => { expect(b.snapshotCall.mock.calls.length).toBeGreaterThan(1) })
    await expect(workspace.startVerification({ packetId: 'packet-1' })).resolves.toBe(true)
    await vi.waitFor(() => { expect(b.snapshotCall.mock.calls.length).toBeGreaterThan(2) })
    await expect(workspace.readEvidence({ evidenceId: 'evidence-1' })).resolves.toBe(true)
    await expect(workspace.recordDecision({ packetId: 'packet-1' })).resolves.toBe(true)

    expect(b.remote.createPacket).toHaveBeenCalled()
    expect(b.remote.startVerification).toHaveBeenCalled()
    expect(b.remote.readEvidence).toHaveBeenCalled()
    expect(b.remote.recordDecision).toHaveBeenCalled()
  })

  it('aborts an in-flight explicit operation from the injected cancel action', async () => {
    const b = await bench()
    let signal: AbortSignal | undefined
    b.remote.startChange.mockImplementation((_input: unknown, operationSignal?: AbortSignal) => {
      if (operationSignal === undefined) throw new Error('operation signal is required')
      signal = operationSignal
      return new Promise<RemoteResult<unknown>>((resolve) => {
        operationSignal.addEventListener('abort', () => {
          resolve({
            ok: false,
            error: { code: 'cancelled', message: 'cancelled', details: {} },
          })
        }, { once: true })
      })
    })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = (b.slots.entries('shell.view')[0]!.inject as unknown as () => {
      hooks: { delivery: { getSnapshot(): { pending: string | null; actionError: string | null } } }
      startChange(input: { packetId: string; executorId: string }): Promise<boolean>
      cancel(): void
    })()
    const operation = face.startChange({ packetId: 'packet-1', executorId: 'codex' })
    await vi.waitFor(() => {
      expect(face.hooks.delivery.getSnapshot().pending).toBe('start-change')
    })

    face.cancel()

    await expect(operation).resolves.toBe(false)
    expect(signal?.aborted).toBe(true)
    expect(face.hooks.delivery.getSnapshot()).toMatchObject({
      pending: null,
      actionError: 'cancelled: cancelled',
    })
  })
})

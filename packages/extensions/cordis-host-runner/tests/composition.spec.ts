import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CordisDynamicPackageId, CordisDynamicPluginId } from '../src/types.ts'
import { missingServices } from '../src/lifecycle.ts'
import {
  AGENT_A, call, CONSUMER_CODE, CONTENT_OUTPUT_CODE, dummyTool, LISTENER_CODE, mount,
  PROVIDER_CODE, REVERSE_TOOL_CODE, setup, text,
  running,
} from './helpers.ts'

/**
 * Cross-package composition through ordinary cordis provide/inject semantics:
 * one package's host half provides a service, another injects it, and definition
 * ids stay the lifecycle handles across stop and run again. Every assertion is
 * against the WORLD — the registry, the service store, real tool dispatch — not
 * a rendered summary (that is the tool package's job).
 */

afterEach(() => {
  vi.restoreAllMocks()
})

function latestPackage(harness: Awaited<ReturnType<typeof setup>>, pluginId: CordisDynamicPluginId): CordisDynamicPackageId {
  const row = harness.runner.inventory().find(candidate => candidate.pluginId === pluginId)
  const packageId = row?.packages.at(-1)?.packageId
  if (packageId === undefined) throw new Error(`missing package for ${pluginId}`)
  return packageId
}

describe('cross-package provide/inject', () => {
  it('provider first: the consumer activates immediately and its tool reaches the provided service', async () => {
    const harness = await setup()
    await mount(harness, PROVIDER_CODE)
    await mount(harness, CONSUMER_CODE)

    // The vm-realm service value is callable across packages, and the result
    // normalizes into the host realm like any dynamic tool result.
    const greeted = await call(harness.ctx, 'greet', { name: 'harness' })
    expect(greeted.isError).toBe(false)
    expect(text(greeted)).toBe('hi harness')
  })

  it('consumer first: runs but stays parked on the missing service, then activates when the provider runs', async () => {
    const harness = await setup()
    const consumer = await mount(harness, CONSUMER_CODE)

    // A settled-but-pending host half is a successful run in legal cordis
    // semantics; the fiber names what it waits for.
    const [row] = harness.runner.snapshot(AGENT_A)
    expect(row?.activeRun?.fiber).toBeDefined()
    expect(missingServices(harness.ctx, row?.activeRun?.fiber as never)).toEqual(['greeter'])
    expect(harness.ctx.tools.get('greet')).toBeUndefined()
    expect(running(harness.runner, AGENT_A)).toEqual([{ id: consumer, running: true }])

    await mount(harness, PROVIDER_CODE)
    expect(harness.ctx.tools.get('greet')).toBeDefined()
    expect(text(await call(harness.ctx, 'greet', { name: 'late' }))).toBe('hi late')
  })

  it('stopping the provider sends the consumer back to pending and unwinds its registrations', async () => {
    const harness = await setup()
    const provider = await mount(harness, PROVIDER_CODE)
    await mount(harness, CONSUMER_CODE)
    expect(harness.ctx.tools.get('greet')).toBeDefined()

    await expect(harness.runner.stop(AGENT_A, provider)).resolves.toEqual({ ok: true })

    expect(harness.ctx.tools.get('greet')).toBeUndefined()
    expect(harness.ctx.get('greeter')).toBeUndefined()
  })

  it('running the provider again re-runs the consumer through a fresh guard (tool back)', async () => {
    const harness = await setup()
    const provider = await mount(harness, PROVIDER_CODE)
    await mount(harness, CONSUMER_CODE)
    await harness.runner.stop(AGENT_A, provider)
    expect(harness.ctx.tools.get('greet')).toBeUndefined()

    // The same definition, a new dispatch: the consumer's apply re-runs through
    // a new façade rather than needing its own re-definition.
    await expect(harness.runner.run(
      AGENT_A, provider, latestPackage(harness, provider), 'run',
    )).resolves.toMatchObject({ ok: true })
    expect(harness.ctx.tools.get('greet')).toBeDefined()
    expect(text(await call(harness.ctx, 'greet', { name: 'again' }))).toBe('hi again')
  })

  it('a duplicate provide fails loud and leaves the second package not running', async () => {
    const harness = await setup()
    await mount(harness, PROVIDER_CODE)

    await expect(mount(harness, PROVIDER_CODE)).rejects.toThrow('has been registered')

    const rows = harness.runner.snapshot(AGENT_A)
    expect(rows.map(row => row.activeRun !== undefined)).toEqual([true, false])
    // The service still belongs to the first package's fiber.
    expect(harness.ctx.get('greeter')).toBeDefined()
  })

  it('a primitive (or null) provided value passes through the façade unwrapped, on both read paths', async () => {
    const harness = await setup()
    await mount(harness, `
      return {
        name: 'answer-provider',
        apply(ctx) {
          ctx.provide('answer', 42)
          ctx.provide('nothing', null)
        },
      }
    `)
    await mount(harness, `
      return {
        name: 'answer-consumer',
        inject: ['answer', 'nothing', 'tools'],
        apply(ctx) {
          harness.registerTool(ctx, harness.defineTool({
            name: 'answer',
            description: 'Read the provided primitive services.',
            parameters: {},
            ${CONTENT_OUTPUT_CODE}
            async execute() {
              return [{ type: 'text', text: ctx.answer + '/' + ctx.get('answer') + '/' + ctx.nothing }]
            },
          }))
        },
      }
    `)

    expect(text(await call(harness.ctx, 'answer', {}))).toBe('42/42/null')
  })

  it('stopping the consumer leaves the provider and its service intact', async () => {
    const harness = await setup()
    await mount(harness, PROVIDER_CODE)
    const consumer = await mount(harness, CONSUMER_CODE)

    await harness.runner.stop(AGENT_A, consumer)

    expect(harness.ctx.tools.get('greet')).toBeUndefined()
    expect(harness.ctx.get('greeter')).toBeDefined()
  })
})

describe('stop reaches quiescence', () => {
  it('cleans browser resources through the owner scope before the Agent detaches', async () => {
    const harness = await setup()
    const ownerId = SessionId('S-scoped-cleanup')
    const ownerCtx = new Context()
    const owner = { ...AGENT_A, id: ownerId, session: { id: ownerId }, ctx: ownerCtx } as Agent
    const detach = harness.ctx.agents.register(owner)
    const cleanup = Promise.withResolvers<undefined>()
    const browser = {
      execute: vi.fn(async (operation: { action: { kind: string } }) => {
        expect(harness.ctx.agents.get(owner.id)).toBe(owner)
        expect(harness.ctx.agents.currentInitiator()).toBe(owner)
        if (operation.action.kind === 'region_clear') cleanup.resolve(undefined)
        return {
          requestId: `browser-${operation.action.kind}`, sessionId: owner.id, installationId: 'install-1',
          outcome: 'observed', delivery: 'sent', value: operation.action.kind === 'page_map'
            ? { regions: [{ regionRef: '11111111-1111-4111-8111-111111111111', disposable: true, protected: false }] }
            : operation.action.kind === 'region_clear'
              ? { cleared: true, restored: 1 } : { kind: operation.action.kind },
        }
      }),
    }
    harness.ctx.provide('browser', browser)
    const { pluginId, packageId } = harness.runner.define(owner, {
      plugin: { kind: 'new', idPrefix: 'scope' }, name: 'scope-cleanup', purpose: 'test cleanup ordering',
      code: { host: `
        return { name: 'scope-cleanup', inject: ['browser', 'tools'], apply(ctx) {
          harness.registerTool(ctx, harness.defineTool({
            name: 'scope_cleanup_browser', description: 'Render a temporary page region.', parameters: {},
            output: { schema: { type: 'json' }, render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] } },
            async execute() { const page = { tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/feed' }; const map = await harness.browser.pageMap({ installationId: 'install-1', page }); return harness.browser.render({ installationId: 'install-1', page, slot: 'owner', regionRef: map.value.regions[0].regionRef, presentation: { summary: 'owned' } }) },
          }))
        }}
      ` },
    })
    await harness.runner.run(owner, pluginId, packageId, 'run')
    await call(harness.ctx, 'scope_cleanup_browser', {})

    await ownerCtx.fiber.dispose()
    await cleanup.promise
    expect(harness.runner.inventory()).not.toEqual(expect.arrayContaining([expect.objectContaining({ pluginId })]))
    detach()
  })

  it('attributes browser dispatch and stop cleanup to the exact live defining Agent', async () => {
    const harness = await setup()
    const initiators: Array<Agent | undefined> = []
    const browser = {
      execute: vi.fn(async (operation: { action: { kind: string } }) => {
        initiators.push(harness.ctx.agents.currentInitiator())
        return {
          requestId: `browser-${operation.action.kind}`, sessionId: AGENT_A.id, installationId: 'install-1',
          outcome: 'observed', delivery: 'sent', value: operation.action.kind === 'page_map'
            ? { regions: [{ regionRef: '11111111-1111-4111-8111-111111111111', disposable: true, protected: false }] }
            : operation.action.kind === 'region_clear'
              ? { cleared: true, restored: 1 } : { kind: operation.action.kind },
        }
      }),
    }
    harness.ctx.provide('browser', browser)
    const { pluginId, packageId } = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'owner' }, name: 'owner-bound', purpose: 'test browser ownership',
      code: { host: `
        return { name: 'owner-bound', inject: ['browser', 'tools'], apply(ctx) {
          harness.registerTool(ctx, harness.defineTool({
            name: 'owner_bound_browser', description: 'Render a temporary page region.', parameters: {},
            output: { schema: { type: 'json' }, render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] } },
            async execute() { const page = { tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/feed' }; const map = await harness.browser.pageMap({ installationId: 'install-1', page }); return harness.browser.render({ installationId: 'install-1', page, slot: 'owner', regionRef: map.value.regions[0].regionRef, presentation: { summary: 'owned' } }) },
          }))
        }}
      ` },
    })

    await harness.runner.run(AGENT_A, pluginId, packageId, 'run')
    await call(harness.ctx, 'owner_bound_browser', {})
    await harness.runner.stop(AGENT_A, pluginId)

    expect(initiators).toEqual([AGENT_A, AGENT_A, AGENT_A])
    expect(JSON.parse(JSON.stringify(harness.runner.inventory()))).not.toHaveProperty('ownerAgent')
  })

  it('refuses a forged defining Agent even when its session id matches a live owner', async () => {
    const harness = await setup()
    expect(() => harness.runner.define({ ...AGENT_A }, {
      plugin: { kind: 'new', idPrefix: 'forge' }, name: 'forged', purpose: 'must fail', code: { host: 'return () => {}' },
    })).toThrow('live Agent')
  })

  it('does not revive the disposed owner while it clears that owner\'s rendered region', async () => {
    const harness = await setup()
    const cleanup = Promise.withResolvers<undefined>()
    const initiators: Array<Agent | undefined> = []
    harness.ctx.provide('browser', {
      execute: vi.fn(async (operation: { action: { kind: string } }) => {
        initiators.push(harness.ctx.agents.currentInitiator())
        if (operation.action.kind === 'region_clear') cleanup.resolve(undefined)
        return {
          requestId: `browser-${operation.action.kind}`, sessionId: AGENT_A.id, installationId: 'install-1',
          outcome: 'observed', delivery: 'sent', value: operation.action.kind === 'page_map'
            ? { regions: [{ regionRef: '11111111-1111-4111-8111-111111111111', disposable: true, protected: false }] }
            : operation.action.kind === 'region_clear'
              ? { cleared: true, restored: 1 } : { kind: operation.action.kind },
        }
      }),
    })
    const { pluginId, packageId } = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'gone' }, name: 'dispose-bound', purpose: 'test owner disposal',
      code: { host: `
        return { name: 'dispose-bound', inject: ['browser', 'tools'], apply(ctx) {
          harness.registerTool(ctx, harness.defineTool({
            name: 'dispose_bound_browser', description: 'Render a temporary page region.', parameters: {},
            output: { schema: { type: 'json' }, render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] } },
            async execute() { const page = { tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/feed' }; const map = await harness.browser.pageMap({ installationId: 'install-1', page }); return harness.browser.render({ installationId: 'install-1', page, slot: 'dispose', regionRef: map.value.regions[0].regionRef, presentation: { summary: 'owned' } }) },
          }))
        }}
      ` },
    })

    await harness.runner.run(AGENT_A, pluginId, packageId, 'run')
    await call(harness.ctx, 'dispose_bound_browser', {})
    harness.disposeAgent(AGENT_A)
    await cleanup.promise

    expect(initiators).toEqual([AGENT_A, AGENT_A, undefined])
  })

  it('retries unresolved owner cleanup after detachment without reviving the disposed Agent', async () => {
    const harness = await setup()
    const completed = Promise.withResolvers<undefined>()
    const initiators: Array<Agent | undefined> = []
    let clears = 0
    const statusRequests: string[] = []
    harness.ctx.provide('browser', {
      execute: vi.fn(async (operation: { action: { kind: string } }) => {
        initiators.push(harness.ctx.agents.currentInitiator())
        if (operation.action.kind === 'region_clear') {
          clears++
          if (clears === 1) return { outcome: 'unknown', delivery: 'sent' }
          completed.resolve(undefined)
          return { outcome: 'observed', delivery: 'sent', value: { cleared: true, restored: 1 } }
        }
        return {
          requestId: `browser-${operation.action.kind}`, sessionId: AGENT_A.id, installationId: 'install-1',
          outcome: 'observed', delivery: 'sent', value: operation.action.kind === 'page_map'
            ? { regions: [{ regionRef: '11111111-1111-4111-8111-111111111111', disposable: true, protected: false }] }
            : { rendered: 1 },
        }
      }),
      requestStatus: vi.fn(async (query: { requestId: string }) => {
        statusRequests.push(query.requestId)
        completed.resolve(undefined)
        return { requestId: query.requestId, sessionId: AGENT_A.id, installationId: 'install-1',
          outcome: 'observed', delivery: 'sent', value: { cleared: true, restored: 1 } }
      }),
    })
    const { pluginId, packageId } = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'orphan' }, name: 'orphan-cleanup', purpose: 'recover page cleanup after owner disposal',
      code: { host: `
        return { name: 'orphan-cleanup', inject: ['browser', 'tools'], apply(ctx) {
          harness.registerTool(ctx, harness.defineTool({
            name: 'orphan_cleanup_browser', description: 'Render a temporary page region.', parameters: {},
            output: { schema: { type: 'json' }, render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] } },
            async execute() { const page = { tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/feed' }; const map = await harness.browser.pageMap({ installationId: 'install-1', page }); return harness.browser.render({ installationId: 'install-1', page, slot: 'orphan', regionRef: map.value.regions[0].regionRef, presentation: { summary: 'owned' } }) },
          }))
        }}
      ` },
    })

    await harness.runner.run(AGENT_A, pluginId, packageId, 'run')
    await call(harness.ctx, 'orphan_cleanup_browser', {})
    harness.disposeAgent(AGENT_A)
    await completed.promise
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(clears).toBe(1)
    expect(initiators).toEqual([AGENT_A, AGENT_A, undefined])
    expect(statusRequests).toHaveLength(1)
    expect(harness.runner.inventory().find(row => row.pluginId === pluginId)).toBeUndefined()
  })

  it('transfers exact cleanup to the runner ledger after the owning BrowserTask is terminal', async () => {
    const harness = await setup()
    const initiators: Array<Agent | undefined> = []
    harness.ctx.provide('browserTasks', { get: () => ({ phase: 'terminal' }) } as never)
    harness.ctx.provide('browser', { execute: vi.fn(async (operation: { action: { kind: string } }) => {
      initiators.push(harness.ctx.agents.currentInitiator())
      return {
        requestId: `browser-${operation.action.kind}`, sessionId: AGENT_A.id, installationId: 'install-1',
        outcome: 'observed', delivery: 'sent', value: operation.action.kind === 'entry_unmount'
          ? { unmounted: true, remaining: 0 } : { mounted: 1 },
      }
    }) } as never)
    const { pluginId, packageId } = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'term' }, name: 'terminal-cleanup', purpose: 'clean after task terminal',
      code: { host: `
        return { name: 'terminal-cleanup', async apply() {
          await harness.browser.mount({ installationId: 'install-1',
            page: { tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/feed' },
            slot: 'collect', regionSelector: 'main', selector: ':scope > article', label: 'Collect' })
        } }
      ` },
    })

    await expect(harness.runner.run(AGENT_A, pluginId, packageId, 'run')).resolves.toMatchObject({ ok: true })
    await expect(harness.runner.stop(AGENT_A, pluginId)).resolves.toEqual({ ok: true })
    expect(initiators).toEqual([AGENT_A, undefined])
  })

  it('lets an Agent-made tool use the bounded Browser facade with a fresh page identity', async () => {
    const harness = await setup()
    const browser = {
      execute: vi.fn(async (operation: { sessionId: string; installationId: string; action: { kind: string } }) => ({
        requestId: 'browser-request', sessionId: operation.sessionId, installationId: operation.installationId,
        outcome: 'observed', delivery: 'sent', value: { mounted: 1, action: operation.action.kind },
      })),
    }
    harness.ctx.provide('browser', browser)
    const plugin = await mount(harness, `
      return {
        name: 'browser-entry-composer',
        inject: ['browser', 'tools'],
        apply(ctx) {
          harness.registerTool(ctx, harness.defineTool({
            name: 'page_entry_inspect',
            description: 'Inspect one observed page region through Browser.',
            parameters: {
              installationId: { type: 'string', required: true },
              regionSelector: { type: 'string', required: true },
              selector: { type: 'string', required: true },
            },
            output: { schema: { type: 'json' }, render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] } },
            async execute(args) {
              return harness.browser.inspect({
                installationId: args.installationId,
                page: { tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/feed' },
                regionSelector: args.regionSelector, selector: args.selector, sampleLimit: 3,
              })
            },
          }))
        },
      }
    `)

    expect(text(await call(harness.ctx, 'page_entry_inspect', {
      installationId: 'install-1', regionSelector: 'main', selector: ':scope article',
    }))).toContain('entry_inspect')
    expect(browser.execute).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: AGENT_A.id,
      installationId: 'install-1',
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher is intentionally untyped
      action: expect.objectContaining({
        kind: 'entry_inspect', page: { tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/feed' },
        regionSelector: 'main', selector: ':scope article', sampleLimit: 3,
      }),
    }), expect.any(AbortSignal))

    await expect(harness.runner.stop(AGENT_A, plugin)).resolves.toEqual({ ok: true })
    expect(harness.ctx.tools.get('page_entry_inspect')).toBeUndefined()
  })

  it('maps, renders, and restores an Agent-owned page workspace on stop', async () => {
    const harness = await setup()
    const browser = {
      execute: vi.fn(async (operation: { sessionId: string; installationId: string; action: { kind: string } }) => ({
        requestId: `browser-${operation.action.kind}`, sessionId: operation.sessionId, installationId: operation.installationId,
        outcome: 'observed', delivery: 'sent', value: operation.action.kind === 'page_map'
          ? { regions: [{ regionRef: '11111111-1111-4111-8111-111111111111', disposable: true, protected: false }] }
          : operation.action.kind === 'region_clear'
            ? { cleared: true, restored: 1 } : { kind: operation.action.kind },
      })),
    }
    harness.ctx.provide('browser', browser)
    const plugin = await mount(harness, `
      return {
        name: 'page-workspace',
        inject: ['browser', 'tools'],
        apply(ctx) {
          harness.registerTool(ctx, harness.defineTool({
            name: 'page_workspace', description: 'Map and render a page workspace.', parameters: {},
            output: { schema: { type: 'json' }, render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] } },
            async execute() {
              const page = { tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/feed' }
              const map = await harness.browser.pageMap({ installationId: 'install-1', page })
              const panel = await harness.browser.render({ installationId: 'install-1', page, slot: 'analysis', regionRef: map.value.regions[0].regionRef, mode: 'replace', presentation: { summary: '结果' } })
              return { map, panel }
            },
          }))
        },
      }
    `)
    expect(text(await call(harness.ctx, 'page_workspace', {}))).toContain('page_map')
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher is intentionally untyped
    expect(browser.execute).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ kind: 'page_map' }) }), expect.any(AbortSignal))
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher is intentionally untyped
    expect(browser.execute).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ kind: 'region_render', mode: 'replace', mountId: `${plugin}:analysis` }) }), expect.any(AbortSignal))
    await expect(harness.runner.stop(AGENT_A, plugin)).resolves.toEqual({ ok: true })
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher is intentionally untyped
    expect(browser.execute).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ kind: 'region_clear', mountId: `${plugin}:analysis` }) }), expect.any(AbortSignal))
  })

  it('keeps a temporary Agent tool over the existing Browser service and retracts it on stop', async () => {
    const harness = await setup()
    const browser = { extract: vi.fn(async (args: { query?: string }) => ({ query: args.query ?? '', items: [{ index: 0, text: 'first item' }] })) }
    harness.ctx.provide('browser', browser)
    const plugin = await mount(harness, `
      return {
        name: 'browser-composer',
        inject: ['browser', 'tools'],
        apply(ctx) {
          harness.registerTool(ctx, harness.defineTool({
            name: 'page_items_extract',
            description: 'Extract bounded page items through Browser.',
            parameters: { query: { type: 'string' } },
            output: { schema: { type: 'json' }, render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] } },
            async execute(args) { return ctx.browser.extract(args) },
          }))
        },
      }
    `)
    expect(harness.ctx.tools.get('page_items_extract')).toBeDefined()
    expect(text(await call(harness.ctx, 'page_items_extract', { query: 'feed' }))).toContain('first item')
    expect(browser.extract).toHaveBeenCalledWith({ query: 'feed' })
    await expect(harness.runner.stop(AGENT_A, plugin)).resolves.toEqual({ ok: true })
    expect(harness.ctx.tools.get('page_items_extract')).toBeUndefined()
  })

  it('the host half\'s listeners have stopped by the time stop returns', async () => {
    const harness = await setup()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const id = await mount(harness, LISTENER_CODE)

    harness.ctx.tools.register(dummyTool('trigger_before'))
    expect(log).toHaveBeenCalledTimes(1)

    await expect(harness.runner.stop(AGENT_A, id)).resolves.toEqual({ ok: true })

    // Immediately after the awaited stop, the listener must be gone — no grace
    // period, no eventual consistency.
    harness.ctx.tools.register(dummyTool('trigger_after'))
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('unregisters a self-made tool on stop, and registers it again on the next run', async () => {
    const harness = await setup()
    const id = await mount(harness, REVERSE_TOOL_CODE)
    expect(harness.ctx.tools.get('reverse_text')).toBeDefined()

    await harness.runner.stop(AGENT_A, id)
    expect(harness.ctx.tools.get('reverse_text')).toBeUndefined()

    await harness.runner.run(AGENT_A, id, latestPackage(harness, id), 'run')
    expect(harness.ctx.tools.get('reverse_text')).toBeDefined()
  })

  it('names the replace recipe when a run collides with a live registration', async () => {
    const harness = await setup()
    await mount(harness, REVERSE_TOOL_CODE)

    // A second package registering the same tool name collides; the teaching
    // error points at the stop-then-run recipe rather than a bare conflict.
    await expect(mount(harness, REVERSE_TOOL_CODE)).rejects.toThrow('first cordis_stop that package\'s id')
  })
})

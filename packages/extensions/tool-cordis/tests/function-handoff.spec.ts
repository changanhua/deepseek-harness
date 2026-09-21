import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'

interface RegisteredTool {
  readonly name: string
  readonly parameters: { readonly properties?: Record<string, unknown> }
  readonly execute?: (input: unknown, context: { readonly agent: unknown }) => unknown
}
interface HandoffRequest {
  readonly handoffId: string
  readonly pluginId: string
  readonly packageId: string
  readonly pluginRunId: string
  readonly installationId: string
  readonly grantEpoch: number
  readonly scope: unknown
}
interface HandoffRecord {
  readonly handoffId: string
  readonly pluginId: string
  readonly packageId: string
  readonly pluginRunId: string
  readonly createdBySessionId: string
  readonly owner: { readonly installationId: string; readonly grantEpoch: number }
  readonly scope: unknown
  readonly browserResources: readonly unknown[]
}

describe('cordis_handoff', () => {
  it('exposes only exact run identity and user-selected scope to the model', () => {
    const registered: RegisteredTool[] = []
    const ctx = harness({ registered })

    apply(ctx)

    const tool = registered.find(candidate => candidate.name === 'cordis_handoff')
    expect(tool).toBeDefined()
    expect(Object.keys(tool?.parameters.properties ?? {})).toEqual([
      'pluginId', 'packageId', 'pluginRunId', 'scope',
    ])
    expect(JSON.stringify(tool?.parameters)).not.toMatch(/installationId|sessionId|owner|retained/u)
  })

  it('derives installation authority from the active BrowserTask and completes after durable handoff', async () => {
    const registered: RegisteredTool[] = []
    const page = { tabId: 4, frameId: 0, documentId: 'doc-a', url: 'https://example.test/a' }
    const task = {
      id: 'task-a', revision: 7, target: { installationId: 'install-a', page }, targetRevision: 3,
      capability: { state: 'observed', installationId: 'install-a', grantEpoch: 9 },
    }
    const handed = { ...task, revision: 8 }
    const handoffFunction = vi.fn((_agent: unknown, _ref: unknown, _request: unknown) => handed)
    const terminate = vi.fn((_agent: unknown, _ref: unknown, _outcome: unknown) => (
      { ...handed, revision: 9, phase: 'terminal', outcome: 'completed' }
    ))
    const handoffToInstallation = vi.fn((_agent: unknown, request: HandoffRequest,
      persist: (record: HandoffRecord) => void) => {
      persist({
        handoffId: request.handoffId,
        pluginId: request.pluginId,
        packageId: request.packageId,
        pluginRunId: request.pluginRunId,
        createdBySessionId: 'session-a',
        owner: { installationId: request.installationId, grantEpoch: request.grantEpoch },
        scope: request.scope,
        browserResources: [{
          kind: 'region_render', sessionId: 'session-a', installationId: 'install-a', page, mountId: 'region-a',
        }],
      })
      return { ok: true }
    })
    const ctx = harness({ registered, task, handoffFunction, terminate, handoffToInstallation })
    apply(ctx)
    const tool = registered.find(candidate => candidate.name === 'cordis_handoff')

    const result = await tool?.execute?.({
      pluginId: 'plugin-a', packageId: 'package-a', pluginRunId: 'run-a', scope: 'page',
    }, { agent: { session: { id: 'session-a' } } })

    const installationRequest = handoffToInstallation.mock.calls[0]?.[1]
    expect(installationRequest).toMatchObject({
      installationId: 'install-a', grantEpoch: 9, pluginId: 'plugin-a', packageId: 'package-a',
      pluginRunId: 'run-a', scope: { kind: 'page', target: page, targetRevision: 3 },
    })
    expect(typeof installationRequest?.handoffId).toBe('string')
    const taskRequest = handoffFunction.mock.calls[0]?.[2] as {
      owner: Record<string, unknown>
      scope: unknown
      resourceIds: readonly string[]
    } | undefined
    expect(taskRequest).toMatchObject({
      owner: {
        kind: 'browser-installation', installationId: 'install-a', grantEpoch: 9,
        pluginId: 'plugin-a', packageId: 'package-a', pluginRunId: 'run-a',
      },
      scope: { kind: 'page', target: { installationId: 'install-a', page }, targetRevision: 3 },
      resourceIds: ['region-a'],
    })
    expect(typeof taskRequest?.owner.handoffId).toBe('string')
    expect(terminate).toHaveBeenCalledWith(expect.anything(), { id: 'task-a', revision: 8 }, 'completed')
    expect(result).toMatchObject({ status: 'handed-off', pluginId: 'plugin-a', scope: 'page' })
  })
})

function harness(options: {
  registered: RegisteredTool[]
  task?: object
  handoffFunction?: (...args: unknown[]) => unknown
  terminate?: (...args: unknown[]) => unknown
  handoffToInstallation?: (agent: unknown, request: HandoffRequest, persist: (record: HandoffRecord) => void) => unknown
}): Context {
  return {
    systemPrompt: { section: vi.fn(), getSectionOrder: vi.fn(() => 0) },
    cordisInspect: { register: vi.fn(() => () => {}) },
    effect: (setup: () => unknown) => setup(),
    tools: { register: (tool: RegisteredTool) => {
      options.registered.push(tool)
      return () => {}
    } },
    on: vi.fn(),
    get: (name: string) => name === 'browserTasks' ? {
      get: vi.fn(() => options.task),
      handoffFunction: options.handoffFunction,
      terminate: options.terminate,
    } : undefined,
    browserTasks: {
      get: vi.fn(() => options.task),
      handoffFunction: options.handoffFunction,
      terminate: options.terminate,
    },
    dynamicCordisRunner: { handoffToInstallation: options.handoffToInstallation },
  } as unknown as Context
}

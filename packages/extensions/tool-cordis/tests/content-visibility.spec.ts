import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { queryServiceApi } from '../src/api-catalog.ts'
import { apply } from '../src/index.ts'

describe('human content discovery policy', () => {
  it.each(['content', 'contentSession', 'contentRemote'])('omits %s from the Agent directory and exact lookup', (key) => {
    const directory = queryServiceApi() as { services: Array<{ key: string }> }
    expect(directory.services.some(service => service.key === key)).toBe(false)
    expect(() => queryServiceApi(key)).toThrow(/no catalogued Service/u)
    expect(directory.services.some(service => service.key === 'sessions')).toBe(true)
  })
})

describe('inspect query tool schema', () => {
  it('asks models for a structured object instead of an opaque JSON string', () => {
    const registered: Array<{ name: string; parameters: Record<string, unknown> }> = []
    const ctx = {
      systemPrompt: { section: vi.fn() },
      cordisInspect: { register: vi.fn(() => () => {}) },
      effect: (setup: () => unknown) => setup(),
      tools: { register: (tool: { name: string; parameters: Record<string, unknown> }) => {
        registered.push(tool)
        return () => {}
      } },
      on: vi.fn(),
      dynamicCordisRunner: {},
    } as unknown as Context

    apply(ctx)

    const tool = registered.find(candidate => candidate.name === 'cordis_inspect_query')
    const input = (tool?.parameters.properties as Record<string, unknown> | undefined)?.input
    expect(input).toMatchObject({ type: 'object', additionalProperties: true })
  })

  it('reports browser entry cleanup that could not be observed', async () => {
    type RegisteredTool = { name: string
      execute: (args: { pluginId: string }, exec: { agent: Record<string, unknown> }) => Promise<unknown>
      output: { render: (args: Record<string, unknown>, value: unknown) => Array<{ text: string }> } }
    const registered: RegisteredTool[] = []
    const ctx = {
      systemPrompt: { section: vi.fn() },
      cordisInspect: { register: vi.fn(() => () => {}) },
      effect: (setup: () => unknown) => setup(),
      tools: { register: (tool: RegisteredTool) => {
        registered.push(tool)
        return () => {}
      } },
      on: vi.fn(),
      dynamicCordisRunner: {
        stop: vi.fn(async () => ({ ok: true, cleanupPending: ['plugin-1:feed'] })),
      },
    } as unknown as Context

    apply(ctx)

    const tool = registered.find(candidate => candidate.name === 'cordis_stop')
    const result = await tool?.execute({ pluginId: 'plugin-1' }, { agent: {} })
    expect(result).toEqual({ pluginId: 'plugin-1', cleanupPending: ['plugin-1:feed'] })
    expect(tool?.output.render({}, result)[0].text).toContain('plugin-1:feed')
  })
})

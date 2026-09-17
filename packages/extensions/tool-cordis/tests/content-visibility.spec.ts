import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { queryServiceApi, TYPE_API } from '../src/api-catalog.ts'
import { apply } from '../src/index.ts'

describe('human content discovery policy', () => {
  it.each(['content', 'contentSession', 'contentRemote'])('omits %s from the Agent directory and exact lookup', (key) => {
    const directory = queryServiceApi() as { services: Array<{ key: string }> }
    expect(directory.services.some(service => service.key === key)).toBe(false)
    expect(() => queryServiceApi(key)).toThrow(/no catalogued Service/u)
    expect(directory.services.some(service => service.key === 'sessions')).toBe(true)
  })
  it('publishes the opaque region presentation contract instead of the private render wire', () => {
    const declaration = TYPE_API.find(entry => entry.name === 'BrowserAction')?.declaration
    expect(declaration).toBeTypeOf('string')
    const render = declaration?.split("readonly kind: 'region_render';")[1] ?? ''
    expect(render).toContain('readonly regionRef: BrowserRegionRef;')
    expect(render).toContain('readonly presentation:')
    expect(render).not.toContain('readonly selector:')
    expect(render).not.toContain('readonly blocks:')
  })
})

describe('inspect query tool schema', () => {
  it('asks models for a structured object instead of an opaque JSON string', () => {
    const registered: Array<{ name: string; parameters: Record<string, unknown> }> = []
    const ctx = {
      systemPrompt: { section: vi.fn(), getSectionOrder: vi.fn(() => 0) },
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
  it('teaches dynamic packages to reuse generic browser capabilities before site logic', () => {
    const section = vi.fn<(value: { readonly text: string }) => void>()
    const ctx = {
      systemPrompt: { section, getSectionOrder: vi.fn(() => 0) },
      cordisInspect: { register: vi.fn(() => () => {}) },
      effect: (setup: () => unknown) => setup(),
      tools: { register: vi.fn(() => () => {}) },
      on: vi.fn(),
      dynamicCordisRunner: {},
    } as unknown as Context
    apply(ctx)
    const text = section.mock.calls[0]?.[0]?.text ?? ''
    expect(text).toContain('browser_extract')
    expect(text).toContain('do not create a site-specific workflow')
    expect(text).toContain('stable element references')
  })
})

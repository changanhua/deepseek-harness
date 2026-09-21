import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'

const agent = { session: { id: 'session-b' } }

describe('function edit command admission', () => {
  it('activates only the exact claimed rpc and retains that rpc among other claimed messages', async () => {
    const activate = vi.fn((_: unknown, rpcId: string) => rpcId === 'edit-rpc' ? {
      pluginId: 'keep-1', packageId: 'pkg-1', name: 'keep', purpose: 'test', currentPackageId: 'pkg-1',
    } : undefined)
    const instruction = vi.fn((_: unknown, rpcId: string) => rpcId === 'edit-rpc' ? 'change label' : undefined)
    const preStep = harness({ activate, instruction })
    apply(preStep.ctx)

    const decision = await preStep.handler!({
      agent,
      messages: [],
      signal: new AbortController().signal,
      claimedUserRpcs: [{ rpcId: 'unrelated-rpc' }, { rpcId: 'edit-rpc' }],
    }, async () => ({ kind: 'enter', messages: [] }))

    expect(activate).toHaveBeenCalledWith(agent, 'unrelated-rpc')
    expect(activate).toHaveBeenCalledWith(agent, 'edit-rpc')
    expect(instruction).toHaveBeenCalledWith(agent, 'edit-rpc')
    expect(JSON.stringify(decision)).toContain('function_edit_instruction')
  })

  it('does not activate an unclaimed or missing rpc id', async () => {
    const activate = vi.fn(() => undefined)
    const preStep = harness({ activate, instruction: vi.fn() })
    apply(preStep.ctx)

    const decision = await preStep.handler!({ agent, messages: [], signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))

    expect(activate).not.toHaveBeenCalled()
    expect(decision).toEqual({ kind: 'enter', messages: [] })
  })
})

type Callback = (...args: unknown[]) => unknown
type RunnerCallback = (agent: unknown, rpcId: string) => unknown

function harness(options: { activate: RunnerCallback; instruction: RunnerCallback }): { ctx: Context; handler: Callback | undefined } {
  const state: { handler?: Callback } = {}
  return {
    get handler() { return state.handler },
    ctx: {
      systemPrompt: { section: vi.fn(), getSectionOrder: vi.fn(() => 0) },
      cordisInspect: { register: vi.fn(() => () => {}) }, effect: (setup: () => unknown) => setup(),
      tools: { register: vi.fn(() => () => {}) }, get: vi.fn(() => undefined),
      on: vi.fn((name: string, handler: Callback) => { if (name === 'agent/pre-step') state.handler = handler }),
      dynamicCordisRunner: { activatePreparedEdit: options.activate, preparedEditInstruction: options.instruction },
    } as unknown as Context,
  }
}

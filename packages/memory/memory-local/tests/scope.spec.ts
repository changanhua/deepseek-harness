import { afterEach, describe, expect, it } from 'vitest'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { createMemoryHarness } from './harness.ts'
import { memoryCommand, memoryInspectionCommand } from '../src/scope.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })

describe('exact human memory command evidence', () => {
  it('permits an argument-free list but never widens it into an identity or revision inspection', async () => {
    const memory = await createMemoryHarness()
    cleanups.push(memory.dispose)
    const caller = memory.agent()
    const commandId = CommandId('empty-list')
    caller.session.append('command/run', { commandId, name: 'memory', source: { kind: 'user' } })
    expect(memoryCommand(caller, commandId, '').data.commandId).toBe(commandId)
    expect(memoryInspectionCommand(caller, commandId).data.commandId).toBe(commandId)
    expect(() => memoryInspectionCommand(caller, commandId, undefined, 1)).toThrow('exact active human command')
    expect(() => memoryInspectionCommand(caller, commandId, 'memory-one')).toThrow('exact active human command')
    expect(() => memoryCommand(caller, commandId, 'accept memory-one@1')).toThrow('exact active human command')
  })

  it.each([
    'accept memory-one@9007199254740992', 'approve memory-one@1', 'accept memory-one@1 extra',
    'accept memory-one@1 --unknown 2099-01-01T00:00:00Z', 'accept memory-one@1 --review-after invalid',
    'retire memory-one@1 --review-after 2099-01-01T00:00:00Z',
  ])('rejects malformed decision evidence: %s', async (args) => {
    const memory = await createMemoryHarness()
    cleanups.push(memory.dispose)
    const caller = memory.agent()
    expect(() => memoryInspectionCommand(caller, memory.human(caller, args), 'memory-one')).toThrow('exact active human command')
  })

  it('binds optional decision inspection to the exact revision when one is requested', async () => {
    const memory = await createMemoryHarness()
    cleanups.push(memory.dispose)
    const caller = memory.agent()
    const commandId = memory.human(caller, 'accept memory-one@1')
    expect(memoryInspectionCommand(caller, commandId, 'memory-one').data.commandId).toBe(commandId)
    expect(memoryInspectionCommand(caller, commandId, 'memory-one', 1).data.commandId).toBe(commandId)
    expect(() => memoryInspectionCommand(caller, commandId, 'memory-one', 2)).toThrow('exact active human command')
  })
})

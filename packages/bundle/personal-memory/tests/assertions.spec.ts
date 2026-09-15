import { expect, it } from 'vitest'
import { assertRecalled, assertWithheld, memoryResults, type AcceptanceAgent } from './assertions.ts'

function observed(value: unknown, options: { failed?: boolean; missingResult?: boolean } = {}): AcceptanceAgent {
  return { session: { events: [
    { type: 'tool/call', data: { name: 'memory_search', callId: 'actual-call' } },
    ...options.missingResult ? [] : [{ type: 'tool/result', data: { message: { content: [{
      type: 'tool-result', toolCallId: 'actual-call', isError: options.failed,
      content: [{ type: 'text', text: JSON.stringify(value) }],
    }] } } }],
  ] } } as unknown as AcceptanceAgent
}

const hit = {
  id: 'memory-one', eligibility: 'usable', checkedAt: '2030-01-01T00:00:00.000Z',
  memory: { revision: 2, statement: 'Run pnpm test-current', sources: [{ kind: 'file', path: 'README.md' }] },
}

it('requires a correlated successful tool result with the expected revision and source', () => {
  const agent = observed({ items: [hit] })
  expect(() => { assertRecalled(agent, hit.id, 2, 'pnpm test-current') }).not.toThrow()
  expect(() => { assertRecalled(agent, hit.id, 1, 'pnpm test-current') }).toThrow()
  expect(() => { assertRecalled(observed({ items: [{ ...hit, memory: { ...hit.memory, sources: [] } }] }), hit.id, 2, 'pnpm test-current') }).toThrow()
  expect(() => memoryResults(observed({}, { missingResult: true }), 'memory_search')).toThrow()
  expect(() => memoryResults(observed({}, { failed: true }), 'memory_search')).toThrow()
})

it('rejects blind reuse and missing model searches instead of treating them as safe exclusion', () => {
  expect(() => { assertWithheld(observed({ items: [hit] }), hit.id, 'pnpm test-current') }).toThrow()
  expect(() => { assertWithheld({ session: { events: [] } } as unknown as AcceptanceAgent, hit.id, 'old-command') }).toThrow()
  expect(() => { assertWithheld(observed({ items: [], excluded: { 'source-changed': 1 } }), hit.id, 'old-command') }).not.toThrow()
})

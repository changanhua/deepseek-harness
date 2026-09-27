import { describe, expect, it } from 'vitest'
import { BROWSER_TASK_LIMITS, validateChildObservation, validateCheckpointFacts, validateReceipt } from '../src/fold.ts'

const browserSessionId = '123e4567-e89b-42d3-a456-426614174000'
const target = { installationId: 'extension', page: { tabId: 1, frameId: 0, documentId: 'source', url: 'https://example.test/' } }
const observation = () => ({ sourceTab: { tabId: 1, windowId: 2, browserSessionId }, observedAt: 10,
  candidates: [{ tab: { tabId: 7, windowId: 2, browserSessionId }, url: 'https://example.test/child',
    relation: 'opener', attribution: 'candidate', evidence: 'created-navigation-target' }], truncated: false })
const receipt = () => ({ kind: 'browser-task/receipt', version: 1, taskId: 'task', requestId: 'click', actionKind: 'click',
  target, grantEpoch: 1, outcome: 'observed', delivery: 'sent', quiescent: true, children: observation() })

describe('canonical child-page observations', () => {
  it('retains unknown and incomplete observations without asserting a successful action', () => {
    expect(() => validateReceipt({ ...receipt(), outcome: 'unknown', quiescent: false })).not.toThrow()
    expect(() => validateReceipt({ ...receipt(), children: { ...observation(), candidates: [], truncated: true } })).not.toThrow()
    expect(() => validateReceipt({ ...receipt(), delivery: 'not-sent', outcome: 'failed' })).toThrow('unsent receipt')
  })

  it('uses the executor candidate limit and bounds the whole retained observation in bytes', () => {
    const value = observation()
    value.candidates = Array.from({ length: BROWSER_TASK_LIMITS.childCandidates }, (_, i) => ({
      ...value.candidates[0], tab: { tabId: i + 10, windowId: 2, browserSessionId },
    }))
    expect(() => validateChildObservation(value, target)).not.toThrow()
    value.candidates.push({ ...value.candidates[0], tab: { tabId: 20, windowId: 2, browserSessionId } })
    expect(() => validateChildObservation(value, target)).toThrow('candidate limit')
    const bounded = observation()
    bounded.candidates[0].url += 'a'.repeat(BROWSER_TASK_LIMITS.text - Buffer.byteLength(JSON.stringify(bounded)))
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBe(BROWSER_TASK_LIMITS.text)
    expect(() => validateChildObservation(bounded, target)).not.toThrow()
    bounded.candidates[0].url += '界'
    expect(() => validateChildObservation(bounded, target)).toThrow('children.complete')
  })

  it.each([
    ['source identity', (value: ReturnType<typeof observation>) => { value.sourceTab.tabId = 2 }],
    ['source UUID', (value: ReturnType<typeof observation>) => { value.sourceTab.browserSessionId = 'not-a-session' }],
    ['reused source tab', (value: ReturnType<typeof observation>) => { value.candidates[0].tab.tabId = 1 }],
    ['browser restart', (value: ReturnType<typeof observation>) => { value.candidates[0].tab.browserSessionId = '123e4567-e89b-42d3-b456-426614174000' }],
    ['negative window', (value: ReturnType<typeof observation>) => { value.candidates[0].tab.windowId = -1 }],
    ['duplicate tab', (value: ReturnType<typeof observation>) => { value.candidates.push(value.candidates[0]) }],
    ['invented causation', (value: ReturnType<typeof observation>) => { value.candidates[0].attribution = 'confirmed' }],
    ['unsupported relation', (value: ReturnType<typeof observation>) => { value.candidates[0].relation = 'active' }],
    ['unknown evidence', (value: ReturnType<typeof observation>) => { value.candidates[0].evidence = 'guessed' }],
    ['extra field', (value: ReturnType<typeof observation>) => { Reflect.set(value.candidates[0], 'authorized', true) }],
  ] as const)('rejects corrupt replay facts: %s', (_label, corrupt) => {
    const value = receipt()
    corrupt(value.children)
    expect(() => validateReceipt(value)).toThrow()
    const { kind: _kind, version: _version, ...fact } = value
    expect(() => validateCheckpointFacts(null, [{ ...fact, kind: 'browser-task-receipt', sessionSeq: 4 } as never])).toThrow()
  })

  it('rejects observations attached to another fact kind or a bootstrap receipt', () => {
    expect(() => validateCheckpointFacts(null, [{ kind: 'user', sessionSeq: 1, children: observation() } as never])).toThrow('non-receipt')
    expect(() => validateReceipt({ ...receipt(), version: 2 })).toThrow('bootstrap receipt carries transition')
  })
})

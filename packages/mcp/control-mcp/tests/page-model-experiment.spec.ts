import { describe, expect, it } from 'vitest'
import { ExperimentBudget, verifyCollection, withExperimentCleanup } from './page-model-experiment.ts'

const entries = [1, 2, 3].map(index => ({ title: `Entry ${index}`, link: `https://example.test/${index}` }))
const evidence = () => ({ expected: entries, beforeStop: entries, afterStop: entries,
  clicks: entries.map(entry => ({ sessionId: 's', mountId: 'm', documentId: 'd', entry })),
  sessionId: 's', mountId: 'm', documentId: 'd', remaining: 0,
  cleanup: { outcome: 'observed', value: { unmounted: true, remaining: 0 } },
  subjectStopped: true, intervention: false, statePreserved: true, sampleCorrect: true })

describe('page-model independent evidence', () => {
  it('accepts results backed by clicks and retained after confirmed stop', () => {
    expect(verifyCollection(evidence())).toEqual({ status: 'verified', failures: [] })
  })
  it('rejects a plausible result without corresponding owner-bound clicks', () => {
    const input = evidence()
    input.clicks[1]!.sessionId = 'other'
    expect(verifyCollection(input).failures).toContain('missing_entry_event')
  })
  it.each([
    ['missing results', { beforeStop: entries.slice(1) }, 'collection_mismatch'],
    ['duplicates', { beforeStop: [entries[0], entries[0], entries[2]] }, 'collection_mismatch'],
    ['wrong titles', { beforeStop: entries.map(entry => ({ ...entry, title: 'invented' })) }, 'collection_mismatch'],
    ['lost results', { afterStop: [] }, 'results_lost_on_stop'],
    ['unconfirmed cleanup', { cleanup: { outcome: 'unknown' } }, 'cleanup_unverified'],
    ['page residue', { remaining: 1 }, 'page_residue'],
    ['controller stopped', { subjectStopped: false }, 'subject_did_not_stop'],
    ['intervention', { intervention: true }, 'intervention'],
    ['lost markers', { statePreserved: false }, 'collected_state_lost'],
  ])('rejects %s', (_label, changed, reason) => {
    expect(verifyCollection({ ...evidence(), ...changed }).failures).toContain(reason)
  })
})

describe('shared RMB experiment budget', () => {
  it('reserves concurrent requests against the shared total before dispatch', () => {
    const budget = new ExperimentBudget(5)
    const a = budget.start('a', 5)
    const b = budget.start('b', 5)
    const reservation = a.request(3)
    expect(() => b.request(3)).toThrow('cost_budget_exhausted')
    reservation.settle(1)
    budget.start('c', 5).request(3).settle(2)
    expect(budget.snapshot()).toMatchObject({ chargedRmb: 3, reservedRmb: 0, remainingRmb: 2 })
  })
  it('does not refund requests whose actual charge is unknown', () => {
    const budget = new ExperimentBudget(5)
    budget.start('a', 5).request(5)
    expect(() => budget.start('b', 5).request(0.01)).toThrow('cost_budget_exhausted')
  })
  it('refuses duplicate settlement and invalid or excessive claimed costs', () => {
    const budget = new ExperimentBudget(5)
    const reservation = budget.start('a', 5).request(1)
    expect(() => reservation.settle(Number.NaN)).toThrow('invalid_cost')
    expect(() => reservation.settle(2)).toThrow('cost_exceeded_reservation')
    expect(() => budget.start('b', 5).request(1)).toThrow('cost_budget_exhausted')
  })
  it('counts model requests and browser operations with cleanup independent of task limits', () => {
    const run = new ExperimentBudget(5).start('a', 5)
    for (let i = 0; i < 12; i++) run.request(0.01).settle(0)
    expect(() => run.request(0.01)).toThrow('model_budget_exhausted')
    expect(() => run.browser('execute')).toThrow('run_terminal')
    run.browser('execute', true)
    expect(run.snapshot()).toMatchObject({ modelRequests: 12, cleanupOperations: 1, failed: true })
    const browserRun = new ExperimentBudget(5).start('browser', 5)
    for (let i = 0; i < 40; i++) browserRun.browser('execute')
    expect(() => browserRun.browser('prepare')).toThrow('browser_budget_exhausted')
    browserRun.browser('execute', true)
    expect(browserRun.snapshot()).toMatchObject({ browserOperations: 40, cleanupOperations: 1, failed: true })
  })
  it('never reuses a run id or resets a spent allocation', () => {
    const budget = new ExperimentBudget(5)
    budget.start('a', 1).request(1).settle(1)
    expect(() => budget.start('a', 1)).toThrow('duplicate_run')
    expect(() => budget.start('b', 0)).toThrow('invalid_cost')
  })
})

it('runs cleanup after cancellation without the cancelled task signal', async () => {
  const controller = new AbortController()
  controller.abort()
  let cleaned = false
  await expect(withExperimentCleanup(async () => controller.signal.throwIfAborted(), async (signal) => {
    expect(signal.aborted).toBe(false)
    cleaned = true
  })).rejects.toBeDefined()
  expect(cleaned).toBe(true)
})

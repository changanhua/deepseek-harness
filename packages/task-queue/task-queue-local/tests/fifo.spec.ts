import { describe, expect, it } from 'vitest'
import { determineFault, FaultedError, runMutationTransaction, waitForMutationDrain } from '../src/fifo.ts'

describe('runMutationTransaction serialization', () => {
  it('runs operations one at a time in submission order per owner', async () => {
    const owner = {}
    const order: string[] = []
    const log: string[] = []

    const op = (name: string, delay: number) => runMutationTransaction(owner, async () => {
      order.push(`start:${name}`)
      await new Promise(resolve => setTimeout(resolve, delay))
      order.push(`end:${name}`)
      log.push(name)
      return name
    })

    // Submit three operations; the first is slowest.
    const p1 = op('a', 30)
    const p2 = op('b', 10)
    const p3 = op('c', 5)
    const results = await Promise.all([p1, p2, p3])

    expect(results).toEqual(['a', 'b', 'c'])
    // No interleaving: each op fully completes before the next begins.
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'])
    expect(log).toEqual(['a', 'b', 'c'])
  })

  it('isolates distinct owners from one another', async () => {
    const a = {}
    const b = {}
    const order: string[] = []
    const slowFor = (owner: object, name: string, delay: number) => runMutationTransaction(owner, async () => {
      order.push(`start:${name}`)
      await new Promise(resolve => setTimeout(resolve, delay))
      order.push(`end:${name}`)
    })
    // owner b's fast op should not be blocked behind owner a's slow op.
    const p1 = slowFor(a, 'a-slow', 40)
    const p2 = slowFor(b, 'b-fast', 5)
    await Promise.all([p1, p2])
    expect(order[0]).toBe('start:a-slow')
    expect(order[1]).toBe('start:b-fast')
    expect(order[2]).toBe('end:b-fast')
    expect(order[3]).toBe('end:a-slow')
  })

  it('a throwing operation does not break the chain for the next op', async () => {
    const owner = {}
    await expect(runMutationTransaction(owner, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    const result = await runMutationTransaction(owner, async () => 'ok')
    expect(result).toBe('ok')
  })

  it('drains a successor enqueued by an in-flight operation', async () => {
    const owner = {}
    // oxlint-disable-next-line no-invalid-void-type -- Promise.withResolvers<void>() is a valid use of the void generic.
    const releaseFirst = Promise.withResolvers<void>()
    // oxlint-disable-next-line no-invalid-void-type -- Promise.withResolvers<void>() is a valid use of the void generic.
    const successorQueued = Promise.withResolvers<void>()
    let successorCompleted = false

    const first = runMutationTransaction(owner, async () => {
      void runMutationTransaction(owner, async () => {
        successorCompleted = true
      })
      successorQueued.resolve()
      await releaseFirst.promise
    })
    await successorQueued.promise

    let drained = false
    const drain = waitForMutationDrain(owner).then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    expect(successorCompleted).toBe(false)

    releaseFirst.resolve()
    await Promise.all([first, drain])
    expect(successorCompleted).toBe(true)
  })
})

describe('FaultedError', () => {
  it('is an Error subclass with the faulted name', () => {
    const err = new FaultedError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('FaultedError')
  })

  it('accepts a custom message', () => {
    expect(new FaultedError('custom reason').message).toBe('custom reason')
  })
})

describe('determineFault', () => {
  it('classifies committed when the change is present at its seq with matching payload', () => {
    expect(determineFault(true, true, new Error('io'))).toEqual({ kind: 'committed' })
  })

  it('classifies uncommitted when tail is intact, preserving the original error', () => {
    const original = new Error('fsync failed')
    expect(determineFault(false, true, original)).toEqual({ kind: 'uncommitted', original })
  })

  it('classifies undecidable when the tail is corrupt', () => {
    expect(determineFault(false, false, new Error('io'), 'torn line')).toEqual({
      kind: 'undecidable', reason: 'torn line',
    })
  })

  it('defaults the undecidable reason when none is provided', () => {
    expect(determineFault(false, false, undefined)).toEqual({ kind: 'undecidable', reason: 'log tail corrupt' })
  })

  it('committed wins even when the tail is reported corrupt', () => {
    expect(determineFault(true, false, new Error('io'))).toEqual({ kind: 'committed' })
  })
})

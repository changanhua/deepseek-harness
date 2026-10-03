import { expect, it } from 'vitest'
import { ExecutionEvidenceHandoff } from '../src/evidence.ts'

it('retains evidence after a failed acknowledgement and transfers stable references exactly once', async () => {
  const handoff = new ExecutionEvidenceHandoff(4096, 3)
  const reference = handoff.retain('execution', 'subject-1', 'subject', { observedCommit: 'actual' })
  expect(() =>{  handoff.release() }).toThrow('handoff-uncertain')
  let offered: unknown
  await expect(handoff.offer(async (bundle) => { offered = bundle; return { acceptedDigest: 'wrong' } })).rejects.toThrow('handoff-uncertain')
  expect(handoff.resolve(reference, 'subject-1', 'subject').content).toContain('actual')
  expect(() => handoff.resolve(reference, 'grader-1', 'grader')).toThrow('identity-mismatch')
  expect(() => handoff.resolve({ ...reference, digest: 'forged' }, 'subject-1', 'subject')).toThrow('identity-mismatch')
  await handoff.offer(async (bundle) => { expect(bundle).toBe(offered); return { acceptedDigest: bundle.digest } })
  await handoff.offer(async () => { throw new Error('must not redeliver an acknowledged bundle') })
  handoff.release()
  expect(() => handoff.resolve(reference, 'subject-1', 'subject')).toThrow('identity-mismatch')
})

it('bounds the complete UTF-8 transfer before admitting additional material', () => {
  const handoff = new ExecutionEvidenceHandoff(600, 3)
  const first = handoff.retain('observer', 'subject-1', 'subject', { name: '真实观测' })
  expect(() => handoff.retain('execution', 'subject-1', 'subject', { body: '测'.repeat(150) })).toThrow('capacity')
  expect(handoff.resolve(first, 'subject-1', 'subject').content).toContain('真实观测')
  expect(() => new ExecutionEvidenceHandoff(1, 1).retain('workspace', 'subject-1', 'subject', {})).toThrow('capacity')
})

it('cancels a hung receiver without redelivery or premature material release', async () => {
  const handoff = new ExecutionEvidenceHandoff(4096, 3)
  const reference = handoff.retain('execution', 'subject-1', 'subject', { actual: true })
  const abort = new AbortController()
  const receipt = Promise.withResolvers<{ acceptedDigest: string }>()
  const started = Promise.withResolvers<string>()
  const operation = handoff.offer((bundle) => { started.resolve(bundle.digest); return receipt.promise }, abort.signal)
  const digest = await started.promise
  abort.abort()
  await expect(operation).rejects.toThrow('handoff-interrupted')
  await expect(handoff.offer(async () => { throw new Error('redelivered') })).rejects.toThrow('handoff-in-progress')
  expect(() => { handoff.release() }).toThrow('handoff-uncertain')
  expect(handoff.resolve(reference, 'subject-1', 'subject').content).toContain('true')
  receipt.resolve({ acceptedDigest: digest })
  await receipt.promise
  expect(handoff.resolve(reference, 'subject-1', 'subject').content).toContain('true')
  await expect(handoff.offer(async () => { throw new Error('redelivered') })).resolves.toBe(digest)
  handoff.release()
})

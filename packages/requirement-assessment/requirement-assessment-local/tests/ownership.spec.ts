import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { acquireAssessmentOwnership } from '../src/ownership.ts'
it('requires a local absolute root and releases exclusive ownership', async () => {
  await expect(acquireAssessmentOwnership('relative')).rejects.toMatchObject({ code: 'conflict' })
  const root = await mkdtemp(join(tmpdir(), 'dsh-assessment-owner-'))
  const leases: { release(): Promise<void> }[] = []
  try {
    const first = await acquireAssessmentOwnership(root)
    leases.push(first)
    await expect(acquireAssessmentOwnership(root)).rejects.toMatchObject({ code: 'conflict' })
    await first.release()
    const recovered = await acquireAssessmentOwnership(root)
    leases.push(recovered)
    await recovered.release()
  } finally {
    await Promise.all(leases.map(lease => lease.release()))
    await rm(root, { recursive: true, force: true })
  }
})

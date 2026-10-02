import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPlanningHarness } from '../../../planning/planning-local/tests/harness.ts'
import LocalRequirementAssessment from '../src/index.ts'
import { input } from '../../requirement-assessment/tests/fixtures.ts'
const active: Awaited<ReturnType<typeof createPlanningHarness>>[] = []
afterEach(async () => { for (const value of active.splice(0)) await value.dispose() })
async function open() {
  const harness = await createPlanningHarness()
  active.push(harness)
  const fiber = await harness.ctx.plugin(LocalRequirementAssessment, { ownershipRoot: join(harness.root, 'assessment-owner') })
  const access = { workspaceId: harness.workspace.id, actorId: 'human-a', kind: 'human' as const, authorize() {} }
  return { ...harness, access, fiber, assessment: harness.ctx.requirementAssessment }
}
describe('local assessment Host authority', () => {
  it('records trusted actors, checks Workspace reads, and never changes Planning', async () => {
    const local = await open()
    const before = await local.ctx.planning.snapshot(local.access)
    await expect(local.assessment.reserve(local.access, input)).resolves.toEqual({ status: 'acquired' })
    const saved = await local.assessment.create(local.access, input)
    expect(saved.createdBy).toEqual({ kind: 'human', id: 'human-a' })
    expect(await local.assessment.get(local.access, saved.id)).toEqual(saved)
    expect(await local.assessment.replay(local.access, input.requestId, input.requestDigest)).toEqual(saved)
    expect((await local.assessment.snapshot(local.access)).assessments).toEqual([saved])
    expect(await local.ctx.planning.snapshot(local.access)).toEqual(before)
    await expect(local.assessment.snapshot({ ...local.access, workspaceId: 'absent' })).rejects.toMatchObject({ code: 'not-found' })
    await expect(local.assessment.get({ ...local.access, authorize() { throw new Error('revoked') } }, saved.id)).rejects.toThrow('revoked')
    await local.fiber.dispose()
    await expect(local.assessment.snapshot(local.access)).rejects.toMatchObject({ code: 'closed' })
  })
  it('rechecks authorization immediately before durable mutation', async () => {
    const local = await open()
    let calls = 0
    const access = { ...local.access, authorize() { if (++calls === 3) throw new Error('revoked before commit') } }
    await expect(local.assessment.create(access, input)).rejects.toThrow('revoked before commit')
    expect((await local.assessment.snapshot(local.access)).assessments).toEqual([])
  })
})

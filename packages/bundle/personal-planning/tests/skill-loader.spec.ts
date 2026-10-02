import { describe, expect, it } from 'vitest'
import { bootPlanningBundle } from './harness.ts'

describe('personal planning bundled skill', () => {
  it('discovers, loads, and unloads the planning-maintenance Skill through the real Loader', async () => {
    const world = await bootPlanningBundle()
    try {
      const ctx = (
        world as typeof world & {
          ctx: {
            get(name: string): unknown
            skills: {
              list(input: { cwd: string }): Promise<readonly { name: string; source: string }[]>
              get(name: string, input: { cwd: string }): Promise<{ content: string } | undefined>
            }
          }
        }
      ).ctx
      expect((await ctx.skills.list({ cwd: world.project })).find(skill => skill.name === 'planning-maintenance'))
        .toMatchObject({ source: 'bundled' })
      expect((await ctx.skills.get('planning-maintenance', { cwd: world.project }))?.content).toContain('planning_update')
      const stewardship = await ctx.skills.get('project-steward', { cwd: world.project })
      expect(stewardship?.content).toContain('Keep the original user outcome')
      expect(stewardship?.content).toContain('planning_execution')
      await world.close()
      expect(ctx.get('skills')).toBeUndefined()
    } finally { await world.dispose() }
  })
})

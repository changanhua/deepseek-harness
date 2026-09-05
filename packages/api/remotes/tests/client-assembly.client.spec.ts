// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { apply } from '../src/client/index.ts'

describe('Client Remote assembly', () => {
  it('mounts the Work Observatory namespace selected by the Web product', async () => {
    const mounted: string[] = []
    const ctx = new Context()
    ctx.provide('remote', {
      async $mount(contribution: TypertRemoteContribution) {
        mounted.push(contribution.package)
        return async () => {}
      },
    } as never)

    const dispose = await apply(ctx)

    expect(mounted).toContain('@changanhua/dsh-host-work-observatory')
    await dispose()
  })
})

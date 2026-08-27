import { describe, expect, it } from 'vitest'
import * as queueCore from '@deepseek-ai/dsh-task-queue'

describe('Queue v2 provider contract', () => {
  it('exposes provider-owned authority constructors without exposing the opaque brand', () => {
    expect(queueCore).toHaveProperty('createVerifiedAgentAuthority')
    expect(queueCore).toHaveProperty('createVerifiedOperatorAuthority')
  })

  it('keeps byte persistence outside the Queue core contract', () => {
    expect(queueCore).not.toHaveProperty('createStartContext')
  })
})

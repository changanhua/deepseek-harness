import { expect, it, vi } from 'vitest'
import { nextPlanningRequestId } from '../src/client/request-id.ts'

it('keeps distinct command identities when an HTTP origin has no Web Crypto', () => {
  vi.stubGlobal('crypto', undefined)
  try {
    const first = nextPlanningRequestId()
    const second = nextPlanningRequestId()
    expect(first.startsWith('planning-ui-')).toBe(true)
    expect(second).not.toBe(first)
  } finally {
    vi.unstubAllGlobals()
  }
})

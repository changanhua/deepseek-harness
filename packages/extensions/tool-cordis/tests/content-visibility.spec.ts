import { describe, expect, it } from 'vitest'
import { queryServiceApi } from '../src/api-catalog.ts'

describe('human content discovery policy', () => {
  it('omits content from the Agent directory and rejects exact service lookup', () => {
    const directory = queryServiceApi() as { services: Array<{ key: string }> }
    expect(directory.services.some(service => service.key === 'content')).toBe(false)
    expect(() => queryServiceApi('content')).toThrow(/no catalogued Service/u)
    expect(directory.services.some(service => service.key === 'sessions')).toBe(true)
  })
})

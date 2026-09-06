import { describe, expect, it } from 'vitest'
import { queryServiceApi } from '../src/api-catalog.ts'

describe('human content discovery policy', () => {
  it.each(['content', 'contentSession', 'contentRemote'])('omits %s from the Agent directory and exact lookup', (key) => {
    const directory = queryServiceApi() as { services: Array<{ key: string }> }
    expect(directory.services.some(service => service.key === key)).toBe(false)
    expect(() => queryServiceApi(key)).toThrow(/no catalogued Service/u)
    expect(directory.services.some(service => service.key === 'sessions')).toBe(true)
  })
})

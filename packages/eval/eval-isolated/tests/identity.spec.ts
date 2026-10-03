import { expect, test } from 'vitest'
import { compareCoreObservation } from '../src/identity.ts'

test('retains observed capability bytes on mismatch instead of replacing them with approval expectations', () => {
  const preset = { id: 'p', source: 'preset:system', digest: 'a'.repeat(64) }
  const skill = { id: 'skill', source: 'skill:runtime:runtime', digest: 'b'.repeat(64) }
  const expected = { sessionId: 's', preset, tools: [], skills: [skill] }
  const observed = { ...expected, skills: [{ ...skill, digest: 'c'.repeat(64) }] }
  const result = compareCoreObservation(observed, expected)
  expect(result.valid).toBe(false)
  expect(result.actual.skills[0]?.digest).toBe('c'.repeat(64))
  expect(result.mismatches).toEqual(['skills'])
  expect(compareCoreObservation(expected, expected).valid).toBe(true)
  expect(() => compareCoreObservation({ ...expected, tools: [{ id: 'fake' }] }, expected)).toThrow()
})

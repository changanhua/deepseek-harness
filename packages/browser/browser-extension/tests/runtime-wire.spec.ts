import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { extensionFrameSchema } from '../src/wire.ts'

it('accepts optional extension version information without widening capability or authentication fields', () => {
  const hello = { type: 'hello', protocolVersion: 1, installationId: randomUUID(), token: 'a'.repeat(43),
    capabilities: { protocolVersion: 1, requestRecovery: true, actionKinds: ['tabs'] } }
  expect(extensionFrameSchema.safeParse(hello).success).toBe(true)
  expect(extensionFrameSchema.safeParse({ ...hello, runtime: { version: '0.4.0' } }).success).toBe(true)
  for (const runtime of [{ version: '' }, { version: 'a'.repeat(65) }, { version: '0.4.0', arbitrary: true }]) {
    expect(extensionFrameSchema.safeParse({ ...hello, runtime }).success).toBe(false)
  }
  expect(extensionFrameSchema.safeParse({ ...hello, arbitrary: true }).success).toBe(false)
})

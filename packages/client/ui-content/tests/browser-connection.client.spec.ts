import { expect, it, vi } from 'vitest'
import { BrowserConnectionStore } from '../src/client/browser-connection.ts'

const request = {
  requestId: 'request-one', installationId: 'installation-one', extensionId: 'a'.repeat(32),
  expiresAt: '2026-09-07T23:00:00.000Z', status: 'pending' as const,
}

function remote() {
  return {
    request: vi.fn(async () => ({ ok: true as const, value: request })),
    approve: vi.fn(async () => ({ ok: true as const, value: { ...request, status: 'approved' as const } })),
    reject: vi.fn(async () => ({ ok: true as const, value: { ...request, status: 'rejected' as const } })),
    grants: vi.fn(async () => ({ ok: true as const, value: [] })),
    revoke: vi.fn(async () => ({ ok: true as const, value: undefined })),
  }
}

it('opening the connection request never grants access until the user approves', async () => {
  const face = remote()
  const store = new BrowserConnectionStore(face)
  await store.open(request.requestId)
  expect(store.getSnapshot().request?.status).toBe('pending')
  expect(face.approve).not.toHaveBeenCalled()
  await store.approve()
  expect(face.approve).toHaveBeenCalledWith(request.requestId, expect.any(AbortSignal))
  expect(store.getSnapshot().request?.status).toBe('approved')
  store.dispose()
})

it('a closed or disposed approval surface cannot be reopened by a stale reply', async () => {
  const face = remote()
  let resolve!: (value: { ok: true; value: typeof request }) => void
  face.request.mockImplementation(() => new Promise((done) => { resolve = done }))
  const store = new BrowserConnectionStore(face)
  const pending = store.open(request.requestId)
  store.close()
  resolve({ ok: true, value: request })
  await pending
  expect(store.getSnapshot().visible).toBe(false)
  expect(store.getSnapshot().request).toBeNull()
  store.dispose()
  await store.approve()
  expect(face.approve).not.toHaveBeenCalled()
})

it('does not claim approval when the Remote returns an authorization failure', async () => {
  const face = { ...remote(), approve: vi.fn(async () => ({ ok: false as const, error: { code: 'forbidden', message: '', details: {} } })) }
  const store = new BrowserConnectionStore(face)
  await store.open(request.requestId)
  await store.approve()
  expect(store.getSnapshot().request?.status).toBe('pending')
  expect(store.getSnapshot().error).toBe('forbidden')
  store.dispose()
})

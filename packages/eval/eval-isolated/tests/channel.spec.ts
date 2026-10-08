import { mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { RoleChannel } from '../src/channel.ts'

it('delivers Host cancellation independently of a model exchange and rejects worker cancellation writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-channel-'))
  const host = await RoleChannel.create(root, 1024), worker = await RoleChannel.connect(root, 1024)
  const stop = new AbortController()
  try {
    const canceled = worker.waitForCancellation(stop.signal)
    await worker.send({ sequence: 1, kind: 'model', value: {} })
    await host.requestCancellation()
    await canceled
    expect(await host.read()).toMatchObject({ sequence: 1, kind: 'model' })
    await expect(worker.requestCancellation()).rejects.toThrow('eval-channel-role-cannot-cancel')
  } finally { stop.abort(); await worker.close(); await host.close(); await rm(root, { recursive: true, force: true }) }
})

it('exchanges bounded frames and never follows a worker replacement of the request path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-channel-'))
  const host = await RoleChannel.create(root, 1024), worker = await RoleChannel.connect(root, 1024)
  try {
    const request = { sequence: 1, kind: 'model', value: { prompt: '你好' } }
    await worker.send(request)
    expect(await host.read()).toEqual(request)
    await host.send({ sequence: 1, kind: 'model-result', value: 'done' })
    expect((await worker.receive(1, AbortSignal.timeout(3000))).value).toBe('done')
    await rename(join(root, 'request'), join(root, 'original'))
    await writeFile(join(root, 'request'), 'a different file controlled by the worker')
    expect(await host.read()).toEqual(request)
    await expect(worker.send({ ...request, value: '测'.repeat(500) })).rejects.toThrow('capacity')
  } finally { await worker.close(); await host.close(); await rm(root, { recursive: true, force: true }) }
})

it('does not dispatch torn frames and rejects oversize declared lengths before allocating', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-channel-'))
  const host = await RoleChannel.create(root, 128)
  const raw = await open(join(root, 'request'), 'r+')
  try {
    await raw.write(Buffer.from([20, 0, 0, 0, 123]), 0, 5, 0)
    expect(await host.read()).toBeUndefined()
    await raw.write(Buffer.from([255, 255, 255, 127]), 0, 4, 0)
    await expect(host.read()).rejects.toThrow('capacity')
  } finally { await raw.close(); await host.close(); await rm(root, { recursive: true, force: true }) }
})

import { describe, expect, it, vi } from 'vitest'
import { BrowserFunctions, type BrowserFunctionRunner } from '../src/sessions.ts'
import { extensionFrameSchema } from '../src/wire.ts'

const owner = { installationId: '11111111-1111-4111-8111-111111111111', grantEpoch: 7 }
const inspection = {
  pluginId: 'saved-links-1', packageId: 'pkg-3',
  activeRun: { packageId: 'pkg-3', pluginRunId: 'run-9' },
}

function runner() {
  const list = vi.fn((_owner: typeof owner) => [inspection])
  const inspect = vi.fn((_owner: typeof owner, _pluginId: string) => inspection)
  const stop = vi.fn(async (_owner: typeof owner, _request: unknown): Promise<unknown> => ({ ok: true }))
  const run = vi.fn(async (_agent: unknown, _owner: typeof owner, _request: unknown): Promise<unknown> => ({ accepted: true }))
  const prepareEdit = vi.fn(async (_agent: unknown, _owner: typeof owner, _request: unknown): Promise<unknown> => ({ prepared: true }))
  const revokePreparedEdit = vi.fn((_requestId: string) => {})
  const commandStatus = vi.fn((_owner: typeof owner, _requestId: string): unknown => ({ status: 'accepted' }))
  const revokeInstallation = vi.fn((_owner: typeof owner) => {})
  const service: BrowserFunctionRunner = {
    listForInstallation: owner => list(owner),
    inspectForInstallation: (owner, pluginId) => inspect(owner, pluginId),
    stopForInstallation: async (owner, request) => stop(owner, request),
    runForInstallation: async (agent, installation, request) => run(agent, installation, request),
    prepareEditForInstallation: async (agent, installation, request) => prepareEdit(agent, installation, request),
    revokePreparedEdit,
    commandStatusForInstallation: (owner, requestId) => commandStatus(owner, requestId),
    revokeInstallation,
  }
  return { service, list, inspect, stop, run, prepareEdit, revokePreparedEdit, commandStatus, revokeInstallation }
}

const sessions = (agent = { id: 'agent-1' }) => ({
  resolveAgent: vi.fn(async () => ({ agent })),
  prompt: vi.fn(async () => ({ accepted: true })),
})

describe('BrowserFunctions', () => {
  it('publishes only the three bounded function methods on the extension wire', () => {
    for (const method of ['function.list', 'function.inspect', 'function.stop', 'function.run', 'function.edit']) {
      expect(extensionFrameSchema.safeParse({ type: 'request', requestId: owner.installationId, method, params: {} }).success).toBe(true)
    }
  })

  it('derives the list owner only from its authenticated grant', async () => {
    const fixture = runner()
    const functions = new BrowserFunctions(fixture.service, sessions(), { ...owner, permit: () => true })

    await expect(functions.handle('function.list', {})).resolves.toEqual({ functions: [inspection] })
    expect(fixture.list).toHaveBeenCalledWith(owner)
    await expect(functions.handle('function.list', { installationId: 'attacker', grantEpoch: 1 })).rejects.toMatchObject({ code: 'bad_request' })
  })

  it('requires the current package and run before inspection', async () => {
    const fixture = runner()
    const functions = new BrowserFunctions(fixture.service, sessions(), { ...owner, permit: () => true })

    await expect(functions.handle('function.inspect', {
      pluginId: 'saved-links-1', expectedPackageId: 'pkg-3', expectedPluginRunId: 'run-9',
    })).resolves.toEqual({ function: inspection })
    expect(fixture.inspect).toHaveBeenCalledWith(owner, 'saved-links-1')
    await expect(functions.handle('function.inspect', {
      pluginId: 'saved-links-1', expectedPackageId: 'pkg-2', expectedPluginRunId: 'run-9',
    })).rejects.toMatchObject({ code: 'function_changed' })
    await expect(functions.handle('function.inspect', {
      pluginId: 'saved-links-1', expectedPackageId: 'pkg-3', expectedPluginRunId: 'run-9', sessionId: 'forged',
    })).rejects.toMatchObject({ code: 'bad_request' })
  })

  it('does not stop a changed function', async () => {
    const fixture = runner()
    const functions = new BrowserFunctions(fixture.service, sessions(), { ...owner, permit: () => true })

    await expect(functions.handle('function.stop', {
      pluginId: 'saved-links-1', expectedPackageId: 'pkg-3', expectedPluginRunId: 'run-8',
    })).rejects.toMatchObject({ code: 'function_changed' })
    expect(fixture.stop).not.toHaveBeenCalled()
  })

  it('returns only its stopped function identity', async () => {
    const fixture = runner()
    const functions = new BrowserFunctions(fixture.service, sessions(), { ...owner, permit: () => true })

    await expect(functions.handle('function.stop', {
      pluginId: 'saved-links-1', expectedPackageId: 'pkg-3', expectedPluginRunId: 'run-9',
    })).resolves.toEqual({ stopped: true, pluginId: 'saved-links-1' })
    expect(fixture.stop).toHaveBeenCalledWith(owner, { pluginId: 'saved-links-1', expectedPackageId: 'pkg-3', expectedPluginRunId: 'run-9' })
  })

  it('closes when the authenticated grant is no longer permitted', async () => {
    const fixture = runner()
    const functions = new BrowserFunctions(fixture.service, sessions(), { ...owner, permit: () => false })

    await expect(functions.handle('function.list', {})).rejects.toMatchObject({ code: 'forbidden' })
    expect(fixture.list).not.toHaveBeenCalled()
  })

  it('runs using only the authenticated owner and exact resolved session Agent', async () => {
    const fixture = runner(); const controller = sessions()
    const functions = new BrowserFunctions(fixture.service, controller, { ...owner, permit: () => true })
    await expect(functions.handle('function.run', { requestId: '123e4567-e89b-42d3-a456-426614174001', functionId: 'saved-links-1', expectedVersion: 'pkg-3', expectedRunId: 'run-9', sessionId: 'session-1', expectedTargetRevision: 4 })).resolves.toEqual({ accepted: true })
    expect(fixture.run).toHaveBeenCalledWith({ id: 'agent-1' }, owner, { requestId: '123e4567-e89b-42d3-a456-426614174001', pluginId: 'saved-links-1', expectedPackageId: 'pkg-3', expectedPluginRunId: 'run-9', expectedTargetRevision: 4 })
    expect(controller.resolveAgent).toHaveBeenCalledWith('session-1')
  })

  it('maps the global wire null revision to an omitted runner revision for run and edit', async () => {
    const fixture = runner(); const controller = sessions()
    const functions = new BrowserFunctions(fixture.service, controller, { ...owner, permit: () => true })
    await functions.handle('function.run', { requestId: '123e4567-e89b-42d3-a456-426614174006', functionId: 'saved-links-1', expectedVersion: 'pkg-3', expectedRunId: null, sessionId: 'session-1', expectedTargetRevision: null })
    await functions.handle('function.edit', { requestId: '123e4567-e89b-42d3-a456-426614174007', functionId: 'saved-links-1', expectedVersion: 'pkg-3', sessionId: 'session-1', expectedTargetRevision: null, instruction: '改成每周摘要' })
    expect(fixture.run).toHaveBeenCalledWith(
      { id: 'agent-1' }, owner,
      { requestId: '123e4567-e89b-42d3-a456-426614174006', pluginId: 'saved-links-1',
        expectedPackageId: 'pkg-3' },
    )
    expect(fixture.prepareEdit).toHaveBeenCalledWith(
      { id: 'agent-1' }, owner,
      { requestId: '123e4567-e89b-42d3-a456-426614174007', pluginId: 'saved-links-1',
        expectedPackageId: 'pkg-3', instruction: '改成每周摘要' },
    )
  })

  it('queues edit with the same request id and revokes preparation when enqueue fails', async () => {
    const fixture = runner(); const controller = sessions(); controller.prompt.mockRejectedValueOnce(new Error('queue failed'))
    const functions = new BrowserFunctions(fixture.service, controller, { ...owner, permit: () => true })
    await expect(functions.handle('function.edit', { requestId: '123e4567-e89b-42d3-a456-426614174002', functionId: 'saved-links-1', expectedVersion: 'pkg-3', sessionId: 'session-1', expectedTargetRevision: null, instruction: '把摘要改成三条要点' })).rejects.toThrow('queue failed')
    expect(fixture.prepareEdit).toHaveBeenCalledWith({ id: 'agent-1' }, owner, expect.objectContaining({ requestId: '123e4567-e89b-42d3-a456-426614174002', instruction: '把摘要改成三条要点' }))
    expect(controller.prompt).toHaveBeenCalledWith({ requestId: '123e4567-e89b-42d3-a456-426614174002', sessionId: 'session-1', mode: 'queue', content: [{ type: 'text', text: '把摘要改成三条要点' }] }, expect.any(AbortSignal))
    expect(fixture.revokePreparedEdit).toHaveBeenCalledWith('123e4567-e89b-42d3-a456-426614174002')
  })

  it('rejects forged owner or capability fields on run and edit', async () => {
    const fixture = runner(); const functions = new BrowserFunctions(fixture.service, sessions(), { ...owner, permit: () => true })
    await expect(functions.handle('function.run', { requestId: '123e4567-e89b-42d3-a456-426614174003', functionId: 'saved-links-1', expectedVersion: 'pkg-3', expectedRunId: null, sessionId: 'session-1', expectedTargetRevision: null, owner: { installationId: 'forged' } })).rejects.toMatchObject({ code: 'bad_request' })
    await expect(functions.handle('function.edit', { requestId: '123e4567-e89b-42d3-a456-426614174004', functionId: 'saved-links-1', expectedVersion: 'pkg-3', sessionId: 'session-1', expectedTargetRevision: null, instruction: '改一下', capability: 'forged' })).rejects.toMatchObject({ code: 'bad_request' })
  })

  it('turns an explicit runner rejection into an RPC failure instead of a successful response', async () => {
    const fixture = runner(); fixture.run.mockResolvedValueOnce({ ok: false, reason: 'target_changed', message: 'target changed' })
    const functions = new BrowserFunctions(fixture.service, sessions(), { ...owner, permit: () => true })
    await expect(functions.handle('function.run', { requestId: '123e4567-e89b-42d3-a456-426614174005', functionId: 'saved-links-1', expectedVersion: 'pkg-3', expectedRunId: null, sessionId: 'session-1', expectedTargetRevision: null })).rejects.toMatchObject({ code: 'target_changed', message: 'target changed' })
  })

  it('reads command status using only its authenticated installation owner', async () => {
    const fixture = runner(); const functions = new BrowserFunctions(fixture.service, sessions(), { ...owner, permit: () => true })
    await expect(functions.handle('function.command.status', { requestId: '123e4567-e89b-42d3-a456-426614174008' })).resolves.toEqual({ status: 'accepted' })
    expect(fixture.commandStatus).toHaveBeenCalledWith(owner, '123e4567-e89b-42d3-a456-426614174008')
    await expect(functions.handle('function.command.status', { requestId: '123e4567-e89b-42d3-a456-426614174008', owner: 'forged' })).rejects.toMatchObject({ code: 'bad_request' })
  })
})

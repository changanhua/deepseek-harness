import { describe, expect, it } from 'vitest'
import { AGENT_A, AGENT_B, setup } from './helpers.ts'

const OWNER = { installationId: 'installation-personal', grantEpoch: 9 }
const HOST_CODE = 'return { name: "delivered-function", apply() {} }'
const CLIENT_CODE = 'return () => {}'
const PAGE = { tabId: 7, frameId: 0, documentId: 'doc-a', url: 'https://example.test/a' }

describe('delivered function commands', () => {
  it('projects a client edit from defined through consumed to completed after client settlement', async () => {
    const harness = await setup()
    ;(AGENT_B.session as unknown as { append: () => void }).append = () => {}
    harness.gateway.answer = 'approve'
    const definition = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'keep' }, name: 'kept function', purpose: 'survives its creating chat',
      code: { host: HOST_CODE, client: CLIENT_CODE },
    })
    const initial = await harness.runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
    if (!initial.ok) throw new Error(initial.message)
    await harness.gateway.answering
    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, handoffId: 'handoff-client-edit', pluginId: definition.pluginId, packageId: definition.packageId,
      pluginRunId: initial.pluginRunId, scope: { kind: 'global' },
    }, () => {})).toMatchObject({ ok: true })
    expect(harness.runner.prepareEditForInstallation(AGENT_B, OWNER, {
      requestId: 'client-edit', pluginId: definition.pluginId, expectedPackageId: definition.packageId, instruction: 'client change',
    })).toMatchObject({ ok: true })
    expect(harness.runner.activatePreparedEdit(AGENT_B, 'client-edit')).toBeDefined()
    const updated = harness.runner.define(AGENT_B, {
      plugin: { kind: 'existing', pluginId: definition.pluginId }, name: 'updated', purpose: 'updated',
      code: { host: HOST_CODE, client: CLIENT_CODE },
    })
    expect(harness.runner.commandStatusForInstallation(OWNER, 'client-edit')).toMatchObject({ status: 'defined' })
    delete harness.gateway.answer
    const receipt = await harness.runner.run(AGENT_B, definition.pluginId, updated.packageId, 'update')
    expect(receipt).toMatchObject({ ok: true })
    expect(harness.runner.commandStatusForInstallation(OWNER, 'client-edit')).toMatchObject({ status: 'consumed' })
    const request = harness.gateway.events.filter(([name]) => name === 'cordis/request-run').at(-1)?.[1] as {
      requestId: string
      pluginId: typeof definition.pluginId
      packageId: typeof updated.packageId
      mode: 'update'
    }
    const half = await harness.runner.runHostHalf(
      AGENT_B, request.pluginId, request.packageId, request.mode, request.requestId as never, false,
    )
    if (!half.ok) throw new Error(half.message)
    await harness.runner.resolveRequestRun(request.requestId as never, { ok: true, pluginRunId: half.pluginRunId })
    expect(harness.runner.commandStatusForInstallation(OWNER, 'client-edit')).toMatchObject({ status: 'completed', newPackageId: updated.packageId })
    await harness.ctx.parallel('agent/turn-stopping', {
      agent: AGENT_B, turn: 2, signal: new AbortController().signal,
    })
    expect(harness.runner.commandStatusForInstallation(OWNER, 'client-edit')).toMatchObject({ status: 'completed' })
  })

  it('cleans a new-session page mount through its controller session and original ledger page', async () => {
    const harness = await setup()
    const calls: Array<{ sessionId: string; action: { kind: string; page?: unknown; mountId?: string } }> = []
    harness.ctx.provide('browser', {
      execute: async (operation: { sessionId: string; action: { kind: string; page?: unknown; mountId?: string } }) => {
        calls.push(operation)
        return operation.action.kind === 'entry_unmount'
          ? { outcome: 'observed', delivery: 'sent', value: { unmounted: true, remaining: 0 } }
          : { outcome: 'observed', delivery: 'sent', value: {} }
      },
    } as never)
    harness.ctx.provide('browserTasks', {
      readTarget: (agent: { id: string }) => agent.id === AGENT_B.id
        ? { revision: 12, binding: { installationId: OWNER.installationId, page: PAGE } }
        : { revision: 1, binding: { installationId: OWNER.installationId, page: PAGE } },
    } as never)
    const definition = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'keep' }, name: 'kept function', purpose: 'survives its creating chat',
      code: { host: `await harness.browser.mount({ installationId: '${OWNER.installationId}', page: ${JSON.stringify(PAGE)}, slot: 'result', regionSelector: 'main', selector: ':scope', label: 'Result' }); return { name: 'mounted', apply() {} }` },
    })
    const initial = await harness.runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
    if (!initial.ok) throw new Error(initial.message)
    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, handoffId: 'handoff-new-session-cleanup', pluginId: definition.pluginId, packageId: definition.packageId,
      pluginRunId: initial.pluginRunId, scope: { kind: 'page', target: PAGE, targetRevision: 1 },
    }, () => {})).toMatchObject({ ok: true })
    await harness.runner.stopForInstallation(OWNER, {
      pluginId: definition.pluginId, expectedPackageId: definition.packageId, expectedPluginRunId: initial.pluginRunId,
    })
    const restarted = await harness.runner.runForInstallation(AGENT_B, OWNER, {
      requestId: 'new-session-page-run', pluginId: definition.pluginId, expectedPackageId: definition.packageId,
      expectedTargetRevision: 12,
    })
    if (!restarted.ok) throw new Error(restarted.message)
    await harness.runner.stopForInstallation(OWNER, {
      pluginId: definition.pluginId, expectedPackageId: definition.packageId, expectedPluginRunId: restarted.pluginRunId,
    })
    expect(calls.at(-1)).toMatchObject({
      sessionId: AGENT_B.id,
      action: { kind: 'entry_unmount', page: PAGE, mountId: `${definition.pluginId}:result` },
    })
  })

  it('bounds all-pending edit commands and admits new work after a terminal eviction', async () => {
    const harness = await setup()
    ;(AGENT_B.session as unknown as { append: () => void }).append = () => {}
    const definition = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'keep' }, name: 'kept function', purpose: 'survives its creating chat', code: { host: HOST_CODE },
    })
    const initial = await harness.runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
    if (!initial.ok) throw new Error(initial.message)
    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, handoffId: 'handoff-capacity', pluginId: definition.pluginId, packageId: definition.packageId,
      pluginRunId: initial.pluginRunId, scope: { kind: 'global' },
    }, () => {})).toMatchObject({ ok: true })
    for (let index = 0; index < 512; index++) {
      expect(harness.runner.prepareEditForInstallation(AGENT_B, OWNER, {
        requestId: `edit-capacity-${index}`, pluginId: definition.pluginId, expectedPackageId: definition.packageId, instruction: 'change',
      })).toMatchObject({ ok: true })
    }
    expect(harness.runner.prepareEditForInstallation(AGENT_B, OWNER, {
      requestId: 'edit-capacity-busy', pluginId: definition.pluginId, expectedPackageId: definition.packageId, instruction: 'change',
    })).toMatchObject({ ok: false, reason: 'busy' })
    harness.runner.revokePreparedEdit('edit-capacity-0')
    expect(harness.runner.prepareEditForInstallation(AGENT_B, OWNER, {
      requestId: 'edit-capacity-after-terminal', pluginId: definition.pluginId, expectedPackageId: definition.packageId, instruction: 'change',
    })).toMatchObject({ ok: true })
  })

  it('reports a prepared edit without exposing its instruction', async () => {
    const harness = await setup()
    ;(AGENT_B.session as unknown as { append: () => void }).append = () => {}
    const definition = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'keep' }, name: 'kept function', purpose: 'survives its creating chat', code: { host: HOST_CODE },
    })
    const initial = await harness.runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
    if (!initial.ok) throw new Error(initial.message)
    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, handoffId: 'handoff-status', pluginId: definition.pluginId, packageId: definition.packageId,
      pluginRunId: initial.pluginRunId, scope: { kind: 'global' },
    }, () => {})).toMatchObject({ ok: true })
    harness.runner.prepareEditForInstallation(AGENT_B, OWNER, {
      requestId: 'edit-status', pluginId: definition.pluginId, expectedPackageId: definition.packageId, instruction: 'secret edit words',
    })
    expect(harness.runner.commandStatusForInstallation(OWNER, 'edit-status')).toMatchObject({
      kind: 'edit', status: 'prepared', pluginId: definition.pluginId, expectedPackageId: definition.packageId,
    })
    expect(JSON.stringify(harness.runner.commandStatusForInstallation(OWNER, 'edit-status'))).not.toContain('secret edit words')
  })

  it('revokes installation authority before asynchronously disposing its old function ledger', async () => {
    const harness = await setup()
    const definition = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'keep' }, name: 'kept function', purpose: 'survives its creating chat', code: { host: HOST_CODE },
    })
    const initial = await harness.runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
    if (!initial.ok) throw new Error(initial.message)
    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, handoffId: 'handoff-revoke', pluginId: definition.pluginId, packageId: definition.packageId,
      pluginRunId: initial.pluginRunId, scope: { kind: 'global' },
    }, () => {})).toMatchObject({ ok: true })

    await harness.runner.revokeInstallation(OWNER)

    expect(harness.runner.listForInstallation(OWNER)).toEqual([])
    await expect(harness.runner.runForInstallation(AGENT_B, OWNER, {
      requestId: 'revoked-run', pluginId: definition.pluginId, expectedPackageId: definition.packageId,
    })).resolves.toMatchObject({ ok: false, reason: 'plugin-missing' })
  })

  it('does not let an ordinary new-session Agent inspect, define, or run a delivered function', async () => {
    const harness = await setup()
    const definition = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'keep' }, name: 'kept function', purpose: 'survives its creating chat', code: { host: HOST_CODE },
    })
    const initial = await harness.runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
    if (!initial.ok) throw new Error(initial.message)
    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, handoffId: 'handoff-deny', pluginId: definition.pluginId, packageId: definition.packageId,
      pluginRunId: initial.pluginRunId, scope: { kind: 'global' },
    }, () => {})).toMatchObject({ ok: true })

    expect(() => harness.runner.inspectPackage(AGENT_B, definition.pluginId, definition.packageId)).toThrow(/no dynamic plugin/u)
    expect(() => harness.runner.define(AGENT_B, {
      plugin: { kind: 'existing', pluginId: definition.pluginId }, name: 'forged', purpose: 'forged', code: { host: HOST_CODE },
    })).toThrow(/no dynamic plugin/u)
    await expect(harness.runner.run(AGENT_B, definition.pluginId, definition.packageId, 'run'))
      .resolves.toMatchObject({ ok: false, reason: 'plugin-missing' })
  })

  it('allows one activated edit definition and its exact update', async () => {
    const harness = await setup()
    ;(AGENT_B.session as unknown as { append: () => void }).append = () => {}
    const definition = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'keep' }, name: 'kept function', purpose: 'survives its creating chat', code: { host: HOST_CODE },
    })
    const initial = await harness.runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
    if (!initial.ok) throw new Error(initial.message)
    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, handoffId: 'handoff-positive', pluginId: definition.pluginId, packageId: definition.packageId,
      pluginRunId: initial.pluginRunId, scope: { kind: 'global' },
    }, () => {})).toMatchObject({ ok: true })
    expect(harness.runner.prepareEditForInstallation(AGENT_B, OWNER, {
      requestId: 'edit-positive', pluginId: definition.pluginId, expectedPackageId: definition.packageId, instruction: 'change label',
    })).toMatchObject({ ok: true })
    expect(harness.runner.activatePreparedEdit(AGENT_B, 'edit-positive')).toBeDefined()
    const updated = harness.runner.define(AGENT_B, {
      plugin: { kind: 'existing', pluginId: definition.pluginId }, name: 'updated', purpose: 'updated function', code: { host: HOST_CODE },
    })
    await expect(harness.runner.run(AGENT_B, definition.pluginId, updated.packageId, 'update'))
      .resolves.toMatchObject({ ok: true, packageId: updated.packageId, mode: 'update' })
    expect(() => harness.runner.define(AGENT_B, {
      plugin: { kind: 'existing', pluginId: definition.pluginId }, name: 'second', purpose: 'second', code: { host: HOST_CODE },
    })).toThrow(/no dynamic plugin/u)
  })

  it('rejects an update when the run captured by edit admission changed', async () => {
    const harness = await setup()
    ;(AGENT_B.session as unknown as { append: () => void }).append = () => {}
    const definition = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'keep' }, name: 'kept function', purpose: 'survives its creating chat', code: { host: HOST_CODE },
    })
    const initial = await harness.runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
    if (!initial.ok) throw new Error(initial.message)
    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, handoffId: 'handoff-update-cas', pluginId: definition.pluginId, packageId: definition.packageId,
      pluginRunId: initial.pluginRunId, scope: { kind: 'global' },
    }, () => {})).toMatchObject({ ok: true })
    expect(harness.runner.prepareEditForInstallation(AGENT_B, OWNER, {
      requestId: 'edit-update-cas', pluginId: definition.pluginId, expectedPackageId: definition.packageId, instruction: 'change label',
    })).toMatchObject({ ok: true })
    expect(harness.runner.activatePreparedEdit(AGENT_B, 'edit-update-cas')).toBeDefined()
    const updated = harness.runner.define(AGENT_B, {
      plugin: { kind: 'existing', pluginId: definition.pluginId }, name: 'updated', purpose: 'updated', code: { host: HOST_CODE },
    })
    await harness.runner.stopForInstallation(OWNER, {
      pluginId: definition.pluginId, expectedPackageId: definition.packageId, expectedPluginRunId: initial.pluginRunId,
    })
    await harness.runner.runForInstallation(AGENT_B, OWNER, {
      requestId: 'restart-update-cas', pluginId: definition.pluginId, expectedPackageId: definition.packageId,
    })
    await expect(harness.runner.run(AGENT_B, definition.pluginId, updated.packageId, 'update'))
      .resolves.toMatchObject({ ok: false, reason: 'plugin-missing' })
  })

  it('never activates a prepared edit after it was revoked', async () => {
    const harness = await setup()
    const facts: unknown[] = []
    ;(AGENT_B.session as unknown as { append: (name: string, value: unknown) => void }).append = (name, value) => {
      if (name === 'cordis/function-command') facts.push(value)
    }
    const definition = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'keep' }, name: 'kept function', purpose: 'survives its creating chat', code: { host: HOST_CODE },
    })
    const initial = await harness.runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
    if (!initial.ok) throw new Error(initial.message)
    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, handoffId: 'handoff-edit', pluginId: definition.pluginId, packageId: definition.packageId,
      pluginRunId: initial.pluginRunId, scope: { kind: 'global' },
    }, () => {})).toMatchObject({ ok: true })
    expect(harness.runner.prepareEditForInstallation(AGENT_B, OWNER, {
      requestId: 'edit-request-1', pluginId: definition.pluginId, expectedPackageId: definition.packageId,
      expectedPluginRunId: initial.pluginRunId, instruction: 'rename the label',
    })).toMatchObject({ ok: true, state: 'prepared' })
    harness.runner.revokePreparedEdit('edit-request-1')
    expect(harness.runner.activatePreparedEdit(AGENT_B, 'edit-request-1')).toBeUndefined()
    expect(facts).toHaveLength(1)
  })

  it('rejects edit activation after the captured run changed', async () => {
    const harness = await setup()
    ;(AGENT_B.session as unknown as { append: () => void }).append = () => {}
    const definition = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'keep' }, name: 'kept function', purpose: 'survives its creating chat', code: { host: HOST_CODE },
    })
    const initial = await harness.runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
    if (!initial.ok) throw new Error(initial.message)
    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, handoffId: 'handoff-cas', pluginId: definition.pluginId, packageId: definition.packageId,
      pluginRunId: initial.pluginRunId, scope: { kind: 'global' },
    }, () => {})).toMatchObject({ ok: true })
    expect(harness.runner.prepareEditForInstallation(AGENT_B, OWNER, {
      requestId: 'edit-cas', pluginId: definition.pluginId, expectedPackageId: definition.packageId,
      instruction: 'change label',
    })).toMatchObject({ ok: true })
    await harness.runner.stopForInstallation(OWNER, {
      pluginId: definition.pluginId, expectedPackageId: definition.packageId, expectedPluginRunId: initial.pluginRunId,
    })
    await harness.runner.runForInstallation(AGENT_B, OWNER, {
      requestId: 'restart-cas', pluginId: definition.pluginId, expectedPackageId: definition.packageId,
    })
    expect(harness.runner.activatePreparedEdit(AGENT_B, 'edit-cas')).toBeUndefined()
  })

  it('permits the new conversation to complete the exact Client-half run controller', async () => {
    const harness = await setup()
    harness.gateway.answer = 'approve'
    const definition = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'keep' }, name: 'kept function', purpose: 'survives its creating chat',
      code: { host: HOST_CODE, client: CLIENT_CODE },
    })
    const initial = await harness.runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
    if (!initial.ok) throw new Error(initial.message)
    await harness.gateway.answering
    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, handoffId: 'handoff-client', pluginId: definition.pluginId, packageId: definition.packageId,
      pluginRunId: initial.pluginRunId, scope: { kind: 'global' },
    }, () => {})).toMatchObject({ ok: true })
    await harness.runner.stopForInstallation(OWNER, {
      pluginId: definition.pluginId, expectedPackageId: definition.packageId, expectedPluginRunId: initial.pluginRunId,
    })
    delete harness.gateway.answer

    const started = await harness.runner.runForInstallation(AGENT_B, OWNER, {
      requestId: 'run-client-1', pluginId: definition.pluginId, expectedPackageId: definition.packageId,
    })
    expect(started).toMatchObject({ ok: true, status: 'starting' })
    const event = harness.gateway.events.filter(([name]) => name === 'cordis/request-run').at(-1)?.[1] as {
      requestId: string
      pluginId: typeof definition.pluginId
      packageId: typeof definition.packageId
      mode: 'run'
    }
    const half = await harness.runner.runHostHalf(AGENT_B, event.pluginId, event.packageId, event.mode, event.requestId as never, false)
    if (!half.ok) throw new Error(half.message)
    expect(half).toMatchObject({ ok: true })
    expect(harness.runner.getClientCode(AGENT_B, definition.pluginId, half.pluginRunId)).toMatchObject({ pluginRunId: half.pluginRunId })
  })

  it('restarts a stopped global function only for its exact installation and version', async () => {
    const harness = await setup()
    const definition = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'keep' }, name: 'kept function', purpose: 'survives its creating chat', code: { host: HOST_CODE },
    })
    const initial = await harness.runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
    if (!initial.ok) throw new Error(initial.message)
    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, handoffId: 'handoff-command', pluginId: definition.pluginId, packageId: definition.packageId,
      pluginRunId: initial.pluginRunId, scope: { kind: 'global' },
    }, () => {})).toMatchObject({ ok: true })
    await harness.runner.stopForInstallation(OWNER, {
      pluginId: definition.pluginId, expectedPackageId: definition.packageId, expectedPluginRunId: initial.pluginRunId,
    })

    await expect(harness.runner.runForInstallation(AGENT_B, OWNER, {
      requestId: 'run-request-1', pluginId: definition.pluginId, expectedPackageId: definition.packageId,
    })).resolves.toMatchObject({ ok: true, packageId: definition.packageId, mode: 'run' })
    await expect(harness.runner.runForInstallation(AGENT_B, { ...OWNER, grantEpoch: 8 }, {
      requestId: 'run-request-2', pluginId: definition.pluginId, expectedPackageId: definition.packageId,
    })).resolves.toMatchObject({ ok: false, reason: 'plugin-missing' })
  })

  it('does not reuse a request id for a different function command', async () => {
    const harness = await setup()
    const definition = harness.runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'keep' }, name: 'kept function', purpose: 'survives its creating chat', code: { host: HOST_CODE },
    })
    const initial = await harness.runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
    if (!initial.ok) throw new Error(initial.message)
    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, handoffId: 'handoff-command-2', pluginId: definition.pluginId, packageId: definition.packageId,
      pluginRunId: initial.pluginRunId, scope: { kind: 'global' },
    }, () => {})).toMatchObject({ ok: true })

    await harness.runner.runForInstallation(AGENT_B, OWNER, {
      requestId: 'run-request-same', pluginId: definition.pluginId, expectedPackageId: definition.packageId,
      expectedPluginRunId: initial.pluginRunId,
    })
    await expect(harness.runner.runForInstallation(AGENT_B, OWNER, {
      requestId: 'run-request-same', pluginId: definition.pluginId, expectedPackageId: 'pkg-other' as never,
      expectedPluginRunId: initial.pluginRunId,
    })).resolves.toMatchObject({ ok: false, reason: 'request-conflict' })
  })
})

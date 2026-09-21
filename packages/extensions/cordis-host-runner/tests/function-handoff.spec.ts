import { describe, expect, it, vi } from 'vitest'
import { AGENT_A, AGENT_B, setup } from './helpers.ts'

const HOST_CODE = 'return { name: "delivered-function", apply() {} }'
const PAGE = { tabId: 7, frameId: 0, documentId: 'doc-original', url: 'https://example.test/original' }
const OWNER = { installationId: 'installation-personal', grantEpoch: 9 }
const HANDOFF = { handoffId: 'handoff-0001' }
const PAGE_SCOPE = { scope: { kind: 'page' as const, target: PAGE, targetRevision: 4 } }
const GLOBAL_SCOPE = { scope: { kind: 'global' as const } }

async function runningFunction() {
  const harness = await setup()
  const definition = harness.runner.define(AGENT_A, {
    plugin: { kind: 'new', idPrefix: 'keep' }, name: 'kept function', purpose: 'survives its creating chat',
    code: { host: HOST_CODE },
  })
  const started = await harness.runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
  if (!started.ok) throw new Error(started.message)
  return { harness, definition, runId: started.pluginRunId }
}

describe('delivered function handoff', () => {
  it('rejects a handoff from an Agent other than the exact running owner', async () => {
    const { harness, definition, runId } = await runningFunction()

    expect(harness.runner.handoffToInstallation(AGENT_B, {
      ...OWNER, ...HANDOFF, ...PAGE_SCOPE, pluginId: definition.pluginId, packageId: definition.packageId, pluginRunId: runId,
    }, () => {})).toMatchObject({ ok: false, reason: 'plugin-missing' })
    expect(harness.runner.inventory()[0]).toMatchObject({ agentId: AGENT_A.id, activeRun: { pluginRunId: runId } })
  })

  it('requires the latest exact activation to be running before persisting a handoff', async () => {
    const { runner } = await setup()
    const definition = runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'idle' }, name: 'not live', purpose: 'must not transfer', code: { host: HOST_CODE },
    })

    expect(runner.handoffToInstallation(AGENT_A, {
      ...OWNER, ...HANDOFF, ...PAGE_SCOPE, pluginId: definition.pluginId, packageId: definition.packageId, pluginRunId: 'run-invented',
    } as never, () => {})).toMatchObject({ ok: false, reason: 'not-running' })
  })

  it('rejects page scope when the running function owns no page resource', async () => {
    const { harness, definition, runId } = await runningFunction()

    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, ...HANDOFF, ...PAGE_SCOPE,
      pluginId: definition.pluginId, packageId: definition.packageId, pluginRunId: runId,
    }, () => {})).toMatchObject({ ok: false, reason: 'handoff-not-ready' })
    await expect(harness.runner.stop(AGENT_A, definition.pluginId)).resolves.toEqual({ ok: true })
  })

  it('rejects an empty bridge-minted handoff identity before persisting or promoting', async () => {
    const { harness, definition, runId } = await runningFunction()

    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, handoffId: ' ', ...GLOBAL_SCOPE,
      pluginId: definition.pluginId, packageId: definition.packageId, pluginRunId: runId,
    }, () => {})).toMatchObject({ ok: false, reason: 'handoff-not-ready' })
    await expect(harness.runner.stop(AGENT_A, definition.pluginId)).resolves.toEqual({ ok: true })
  })

  it('does not promote ownership when the durable handoff callback fails', async () => {
    const { harness, definition, runId } = await runningFunction()
    const persist = vi.fn(() => { throw new Error('task log write failed') })

    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, ...HANDOFF, ...GLOBAL_SCOPE, pluginId: definition.pluginId, packageId: definition.packageId, pluginRunId: runId,
    }, persist)).toMatchObject({ ok: false, reason: 'persist-failed' })
    await expect(harness.runner.stop(AGENT_A, definition.pluginId)).resolves.toEqual({ ok: true })
  })

  it('does not accept an asynchronous persistence callback as a completed handoff', async () => {
    const { harness, definition, runId } = await runningFunction()

    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, ...HANDOFF, ...GLOBAL_SCOPE, pluginId: definition.pluginId, packageId: definition.packageId, pluginRunId: runId,
    }, () => Promise.resolve())).toMatchObject({ ok: false, reason: 'persist-failed' })
    await expect(harness.runner.stop(AGENT_A, definition.pluginId)).resolves.toEqual({ ok: true })
  })

  it('keeps a delivered function alive after its creating Agent is disposed', async () => {
    const { harness, definition, runId } = await runningFunction()
    const saved: unknown[] = []

    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, ...HANDOFF, ...GLOBAL_SCOPE, pluginId: definition.pluginId, packageId: definition.packageId, pluginRunId: runId,
    }, (handoff) => { saved.push(handoff) })).toMatchObject({ ok: true })
    harness.disposeAgent(AGENT_A)
    await Promise.resolve()

    expect(saved).toHaveLength(1)
    expect(harness.runner.listForInstallation(OWNER)).toMatchObject([{
      delivery: { handoffId: HANDOFF.handoffId, owner: OWNER, scope: GLOBAL_SCOPE.scope },
    }])
    expect(harness.runner.inspectForInstallation(OWNER, definition.pluginId)).toMatchObject({
      delivery: { handoffId: HANDOFF.handoffId, scope: GLOBAL_SCOPE.scope },
    })
    expect(harness.runner.inspectForInstallation(OWNER, definition.pluginId)).not.toHaveProperty('openTarget')
    await expect(harness.runner.stopForInstallation(OWNER, {
      pluginId: definition.pluginId, expectedPackageId: definition.packageId, expectedPluginRunId: runId,
    })).resolves.toEqual({ ok: true })
  })

  it('fails closed for a different installation or an obsolete grant epoch', async () => {
    const { harness, definition, runId } = await runningFunction()
    void harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, ...HANDOFF, ...GLOBAL_SCOPE, pluginId: definition.pluginId, packageId: definition.packageId, pluginRunId: runId,
    }, () => {})

    expect(harness.runner.listForInstallation({ installationId: 'another-installation', grantEpoch: 9 })).toEqual([])
    expect(harness.runner.inspectForInstallation({ ...OWNER, grantEpoch: 8 }, definition.pluginId)).toBeUndefined()
    await expect(harness.runner.stopForInstallation({ ...OWNER, grantEpoch: 8 }, {
      pluginId: definition.pluginId, expectedPackageId: definition.packageId, expectedPluginRunId: runId,
    }))
      .resolves.toMatchObject({ ok: false, reason: 'plugin-missing' })
  })

  it('stops a delivered browser function through its original cleanup session and page', async () => {
    const { harness, definition } = await runningFunction()
    const calls: Array<{ sessionId: string; action: { page?: unknown; kind: string } }> = []
    harness.ctx.provide('browser', {
      execute: async (operation: { sessionId: string; action: { page?: unknown; kind: string } }) => {
        calls.push(operation)
        return { outcome: 'observed', delivery: 'sent', value: operation.action.kind === 'entry_unmount'
          ? { unmounted: true, remaining: 0 } : {} }
      },
    } as never)
    const update = harness.runner.define(AGENT_A, {
      plugin: { kind: 'existing', pluginId: definition.pluginId }, name: 'kept function', purpose: 'survives its creating chat',
      code: { host: `await harness.browser.mount({ installationId: 'installation-personal', page: ${JSON.stringify(PAGE)}, slot: 'result', regionSelector: 'main', selector: ':scope', label: 'Result' }); return { name: 'delivered-browser', apply() {} }` },
    })
    const updated = await harness.runner.run(AGENT_A, definition.pluginId, update.packageId, 'update')
    if (!updated.ok) throw new Error(updated.message)
    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, ...HANDOFF, ...PAGE_SCOPE, pluginId: definition.pluginId, packageId: update.packageId, pluginRunId: updated.pluginRunId,
    }, () => {})).toMatchObject({ ok: true })

    expect(harness.runner.inspectForInstallation(OWNER, definition.pluginId)).toMatchObject({
      openTarget: { kind: 'browser', resource: { kind: 'entry_mount', sessionId: AGENT_A.id,
        installationId: OWNER.installationId, page: PAGE, mountId: `${definition.pluginId}:result` } },
    })

    await expect(harness.runner.stopForInstallation(OWNER, {
      pluginId: definition.pluginId, expectedPackageId: update.packageId,
      expectedPluginRunId: updated.pluginRunId,
    })).resolves.toEqual({ ok: true })
    expect(harness.runner.inspectForInstallation(OWNER, definition.pluginId)).not.toHaveProperty('openTarget')
    expect(calls.at(-1)).toMatchObject({ sessionId: AGENT_A.id, action: { kind: 'entry_unmount', page: PAGE } })
  })

  it('opens a delivered Client interface in its real Web session, only while running', async () => {
    const { runner, gateway } = await setup()
    gateway.answer = 'approve'
    const definition = runner.define(AGENT_A, {
      plugin: { kind: 'new', idPrefix: 'view' }, name: 'text comparison', purpose: 'compare in Web',
      code: { client: 'return { name: "comparison-view", apply() {} }' },
    })
    const run = await runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
    if (!run.ok) throw new Error(run.message)
    await gateway.answering
    expect(runner.handoffToInstallation(AGENT_A, {
      ...OWNER, ...HANDOFF, ...GLOBAL_SCOPE, pluginId: definition.pluginId,
      packageId: definition.packageId, pluginRunId: run.pluginRunId,
    }, () => {})).toMatchObject({ ok: true })
    expect(runner.inspectForInstallation(OWNER, definition.pluginId)).toMatchObject({
      openTarget: { kind: 'web', sessionId: AGENT_A.id },
    })
    await runner.stopForInstallation(OWNER, { pluginId: definition.pluginId,
      expectedPackageId: definition.packageId, expectedPluginRunId: run.pluginRunId })
    expect(runner.inspectForInstallation(OWNER, definition.pluginId)).not.toHaveProperty('openTarget')
  })

  it('rejects a delivered page scope whose live resources belong to a different document', async () => {
    const { harness, definition } = await runningFunction()
    harness.ctx.provide('browser', { execute: async () => ({ outcome: 'observed', delivery: 'sent', value: {} }) } as never)
    const update = harness.runner.define(AGENT_A, {
      plugin: { kind: 'existing', pluginId: definition.pluginId }, name: 'kept function', purpose: 'survives its creating chat',
      code: { host: `await harness.browser.render({ installationId: 'installation-personal', page: ${JSON.stringify(PAGE)}, slot: 'result', regionRef: '00000000-0000-4000-8000-000000000001', presentation: { summary: 'kept' } }); return { name: 'delivered-page', apply() {} }` },
    })
    const updated = await harness.runner.run(AGENT_A, definition.pluginId, update.packageId, 'update')
    if (!updated.ok) throw new Error(updated.message)

    expect(harness.runner.handoffToInstallation(AGENT_A, {
      ...OWNER, ...HANDOFF,
      scope: { kind: 'page', target: { ...PAGE, documentId: 'another-document' }, targetRevision: 4 },
      pluginId: definition.pluginId, packageId: update.packageId, pluginRunId: updated.pluginRunId,
    }, () => {})).toMatchObject({ ok: false, reason: 'handoff-not-ready' })

    expect(harness.runner.handoffToInstallation(AGENT_A, {
      installationId: 'another-installation', grantEpoch: OWNER.grantEpoch, ...HANDOFF,
      scope: PAGE_SCOPE.scope, pluginId: definition.pluginId, packageId: update.packageId, pluginRunId: updated.pluginRunId,
    }, () => {})).toMatchObject({ ok: false, reason: 'handoff-not-ready' })
  })
})

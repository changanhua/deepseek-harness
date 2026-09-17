/**
 * Dynamic Cordis Plugin service: immutable package definitions, one active run
 * per Plugin, human-approved Client activation, and Host/Client invocation.
 * @module @deepseek-ai/dsh-cordis-host-runner
 */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { isPlugin, normalizeHandler } from './guard.ts'
import { CordisInspectRegistryService } from './inspect-registry.ts'
import { missingServices, startHostHalf } from './lifecycle.ts'
import { DynamicCordisRegistry } from './registry.ts'
import type {
  DynamicCordisDefineReceipt, DynamicCordisDefineRequest, DynamicCordisDefinition,
  DynamicCordisPackageInspection, DynamicCordisPendingRequest, DynamicCordisPlugin,
  DynamicCordisPluginInspection,
  DynamicCordisReference, DynamicCordisRun,
} from './registry.ts'
import { createSandbox, evaluateHostCode, precheckCode } from './sandbox.ts'
import type {
  ApprovalRequestId, CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId, CordisErrorDetails,
  CordisDynamicRunMode, CordisInspectProviderManifest, CordisInspectQueryResolution,
  CordisInspectRequestId, CordisInspectResolveAck, DynamicCordisClientSource, DynamicCordisHostHalfResult,
  DynamicCordisInventoryRow, DynamicCordisInvokeResult, DynamicCordisRenderFailure, DynamicCordisResolveAck,
  DynamicCordisRunAttempt, DynamicCordisRunResolution, DynamicCordisRunResponse, DynamicCordisStopResponse,
  DynamicCordisUndefineReceipt, RequestRunOutcome,
} from './types.ts'

export type * from './types.ts'
export type {
  DynamicCordisDefineReceipt, DynamicCordisDefineRequest, DynamicCordisDefinition, DynamicCordisHandler,
  DynamicCordisPackageInspection, DynamicCordisPlugin, DynamicCordisPluginInspection,
  DynamicCordisReference, DynamicCordisRun,
} from './registry.ts'
export { CordisInspectRegistryService } from './inspect-registry.ts'
export type { HostCordisInspectProviderRegistration } from './inspect-registry.ts'
export { HOST_BUILTIN_INSPECTION } from './sandbox.ts'

/**
 * Brand a Host-minted Plugin ID.
 * @param id - opaque identifier minted by the Host registry.
 * @returns the branded Plugin identifier.
 */
export function CordisDynamicPluginId(id: string): CordisDynamicPluginId {
  return id as CordisDynamicPluginId
}

/**
 * Brand a Host-minted Package ID.
 * @param id - opaque identifier minted by the Host registry.
 * @returns the branded Package identifier.
 */
export function CordisDynamicPackageId(id: string): CordisDynamicPackageId {
  return id as CordisDynamicPackageId
}

/**
 * Brand a Host-minted Plugin Run ID.
 * @param id - opaque identifier minted by the Host registry.
 * @returns the branded Plugin Run identifier.
 */
export function CordisDynamicPluginRunId(id: string): CordisDynamicPluginRunId {
  return id as CordisDynamicPluginRunId
}

/**
 * Brand a Host-minted approval request ID.
 * @param id - opaque identifier minted by the Host registry.
 * @returns the branded approval request identifier.
 */
export function ApprovalRequestId(id: string): ApprovalRequestId {
  return id as ApprovalRequestId
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Process-local dynamic Plugin registry and lifecycle service. */
    dynamicCordisRunner: DynamicCordisRunnerService
  }
}

/** Runner configuration. */
export interface Config {
  /** Maximum synchronous VM evaluation time in milliseconds. */
  vmTimeoutMs?: number
}

type ResolvedConfig = Required<Config>

/** Host-only snapshot consumed by inspect and tool result rendering. */
export interface DynamicCordisSnapshotRow {
  pluginId: CordisDynamicPluginId
  currentPackageId?: CordisDynamicPackageId
  nextPackageId?: CordisDynamicPackageId
  packages: Array<{
    packageId: CordisDynamicPackageId
    name: string
    purpose: string
    hasHostHalf: boolean
    hasClientHalf: boolean
  }>
  activeRun?: {
    pluginRunId: CordisDynamicPluginRunId
    packageId: CordisDynamicPackageId
    fiber?: Fiber
    handlers: string[]
    renderFailure?: DynamicCordisRenderFailure
  }
  latestRun?: DynamicCordisRunAttempt
}

interface ActivationPlan {
  plugin: DynamicCordisPlugin
  definition: DynamicCordisDefinition
  mode: CordisDynamicRunMode
}

type BrowserCleanupKind = 'entry_unmount' | 'region_clear'

interface BrowserCleanupIdentity {
  readonly requestId: string
  readonly sessionId: string
  readonly installationId: string
}

interface BrowserCleanupRequest extends BrowserCleanupIdentity {
  /** Whether this exact unmount also discards extension-side collected entries. */
  readonly forgetCollected: boolean
}

interface BrowserGateway {
  execute?: (operation: unknown, signal: AbortSignal) => Promise<unknown>
  requestStatus?: (query: BrowserCleanupIdentity) => Promise<unknown>
}

/** Dynamic Plugin registry and Host-half lifecycle. */
export class DynamicCordisRunnerService extends TypertRemoteService {
  static inject = ['tools', 'agents']

  static Config: z<Config> = z.object({
    vmTimeoutMs: z.number().min(1).default(5000),
  })

  private readonly rootCtx: Context
  private readonly registry = new DynamicCordisRegistry()
  private readonly ownerCleanups = new WeakMap<Agent, () => void | Promise<void>>()
  /**
   * A disposed Agent can no longer be an initiator, but an exact page cleanup
   * it already owns must still converge.  Keep one unref'd retry per orphaned
   * Plugin; this is deliberately not a general-purpose detached execution
   * facility.
   */
  private readonly orphanCleanupTimers = new Map<CordisDynamicPluginId, ReturnType<typeof setTimeout>>()
  private readonly orphanCleanupAttempts = new Map<CordisDynamicPluginId, number>()
  /** Sent cleanup requests are reconciled by their original identity, never replayed. */
  private readonly cleanupRequests = new Map<string, BrowserCleanupRequest>()
  private readonly inspectRegistry: CordisInspectRegistryService
  private readonly starting = new Map<CordisDynamicPluginId, Promise<DynamicCordisHostHalfResult>>()
  private readonly resolved: ResolvedConfig
  private group: Fiber | undefined

  /** Create the service under the Host composition. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'dynamicCordisRunner')
    this.rootCtx = ctx
    this.resolved = config as ResolvedConfig
    this.inspectRegistry = new CordisInspectRegistryService(ctx)
    ctx.effect(() => () => {
      for (const timer of this.orphanCleanupTimers.values()) clearTimeout(timer)
      this.orphanCleanupTimers.clear()
      this.orphanCleanupAttempts.clear()
    }, 'dynamicCordisRunner: orphan cleanup timers')
    ctx.on('agent/disposed', ({ agent }) => {
      void this.disposeOwned(agent).catch((error: unknown) => {
        console.error(`[cordis:${agent.id}] owner disposal failed`, error)
      })
    })
  }

  private async disposeOwned(agent: Agent): Promise<void> {
    for (const plugin of this.registry.ofSession(agent.id).filter(candidate => candidate.ownerAgent === agent)) {
      this.cancelPending(plugin.pluginId, `dynamic plugin "${plugin.pluginId}" owner was disposed`)
      if (plugin.run !== undefined) await this.retract(plugin)
      for (const mount of plugin.retainedBrowserMounts.values()) plugin.pendingBrowserMounts.set(mount.mountId, mount)
      const remaining = await this.cleanupPendingBrowserMounts(plugin, true)
      if (remaining.length) {
        console.error(`[cordis:${plugin.pluginId}] owner disposal cleanup pending: ${remaining.join(', ')}`)
        // AgentRegistry emits disposal while the exact Agent can still be the
        // initiator. Defer the liveness check one microtask so the post-detach
        // path is armed even when that first, correctly attributed cleanup is
        // unresolved.
        queueMicrotask(() => {
          if (this.registry.get(plugin.pluginId) === plugin && !this.ownerIsLive(plugin)) {
            this.scheduleOrphanCleanup(plugin)
          }
        })
        continue
      }
      this.forgetPlugin(plugin)
    }
  }

  /**
   * Define a new Plugin's first Package or append a Package to an existing Plugin.
   * @param agent - Exact live Agent that owns the Plugin and browser operations.
   * @param request - Plugin selection, metadata, and source code.
   * @returns Host-minted Plugin and Package identities with declared-half metadata.
   */
  define(agent: Agent, request: DynamicCordisDefineRequest): DynamicCordisDefineReceipt {
    this.requireLiveAgent(agent)
    this.ensureOwnerCleanup(agent)
    const name = request.name.trim()
    const purpose = request.purpose.trim()
    if (name.length === 0) throw new Error('cordis_define needs a non-empty `name`')
    if (purpose.length === 0) throw new Error('cordis_define needs a non-empty `purpose`')
    if (request.code.host === undefined && request.code.client === undefined) {
      throw new Error('cordis_define needs `code.host`, `code.client`, or both')
    }
    if (request.code.host !== undefined) precheckCode(request.code.host, 'code.host')
    if (request.code.client !== undefined) precheckCode(request.code.client, 'code.client')

    let plugin: DynamicCordisPlugin
    if (request.plugin.kind === 'new') {
      const prefix = request.plugin.idPrefix.trim()
      if (!/^[a-z]{3,6}$/.test(prefix)) {
        throw new Error('cordis_define `plugin.idPrefix` must contain 3–6 lowercase English letters')
      }
      const pluginId = CordisDynamicPluginId(this.registry.mintPluginId(prefix))
      plugin = {
        pluginId,
        sessionId: agent.id,
        ownerAgent: agent,
        packages: new Map(),
        approvedClientPackages: new Set(),
        clientVersionUpdatesApproved: false,
        state: new Map(),
        retainedBrowserMounts: new Map(),
        pendingBrowserWork: new Set(),
        pendingBrowserMounts: new Map(),
        pendingBrowserRegions: new Map(),
      }
      this.registry.add(plugin)
    } else {
      const found = this.registry.get(request.plugin.pluginId)
      if (found === undefined || found.ownerAgent !== agent) {
        throw new Error(missingPluginMessage(request.plugin.pluginId))
      }
      plugin = found
    }

    const packageId = CordisDynamicPackageId(this.registry.mintPackageId())
    const definition: DynamicCordisDefinition = {
      packageId,
      name,
      purpose,
      ...request.code.host === undefined ? {} : { hostCode: request.code.host },
      ...request.code.client === undefined ? {} : { clientCode: request.code.client },
    }
    plugin.packages.set(packageId, definition)
    return {
      pluginId: plugin.pluginId,
      packageId,
      name,
      purpose,
      hasHostHalf: definition.hostCode !== undefined,
      hasClientHalf: definition.clientCode !== undefined,
    }
  }

  /**
   * Remove a Plugin, its active run, and all immutable Packages.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity to remove.
   * @returns Whether removal succeeded and whether it stopped an active run.
   */
  async undefine(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisUndefineReceipt> {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) return { ok: false, reason: 'plugin-missing', message: missingPluginMessage(pluginId) }
    const wasRunning = plugin.run !== undefined
    this.cancelPending(pluginId, `dynamic plugin "${pluginId}" was removed before approval`)
    if (plugin.run !== undefined) await this.retract(plugin)
    for (const mount of plugin.retainedBrowserMounts.values()) plugin.pendingBrowserMounts.set(mount.mountId, mount)
    const remaining = await this.cleanupPendingBrowserMounts(plugin, true)
    if (remaining.length) return { ok: false, reason: 'cleanup-pending', message: `browser page cleanup remains unresolved: ${remaining.join(', ')}` }
    this.registry.delete(pluginId)
    return { ok: true, wasRunning }
  }

  /**
   * Remove a Plugin from the user panel and queue the resulting state change for the model's next step.
   * @param agent - Agent whose Session owns the Plugin and receives the context.
   * @param pluginId - Stable Plugin identity to remove.
   * @returns Whether removal succeeded and whether it stopped an active run.
   */
  @Remote('undefineFromPanel')
  async undefineFromPanel(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisUndefineReceipt> {
    const result = await this.undefine(agent, pluginId)
    if (result.ok) {
      this.injectUserContext(
        agent,
        `The user removed Cordis Plugin ${pluginId} and all of its Packages. The Plugin no longer exists.`,
      )
    }
    return result
  }

  /**
   * Start or update one Package for a model tool call. An unauthorized Client
   * Package waits for approval; Plugin-wide authorization covers later versions.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity to activate.
   * @param packageId - Immutable Package version to activate.
   * @param mode - Whether to run the current version or switch versions.
   * @param signal - Tool-call cancellation signal while the activation request is being created.
   * @returns The successful activation identity or an actionable refusal.
   */
  async run(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    packageId: CordisDynamicPackageId,
    mode: CordisDynamicRunMode,
    signal?: AbortSignal,
  ): Promise<DynamicCordisRunResponse> {
    const plan = this.resolvePlan(agent, pluginId, packageId, mode)
    if (!plan.ok) return plan.response
    if (signal?.aborted === true) {
      return {
        ok: false,
        reason: 'cancelled',
        message: `the run request for dynamic plugin "${pluginId}" was cancelled before activation`,
      }
    }
    if (this.registry.pendingRequestFor(pluginId) !== undefined) {
      return { ok: false, reason: 'transition-in-flight', message: `dynamic plugin "${pluginId}" already has a pending run request` }
    }
    const attempt = this.createAttempt(plan)
    plan.plugin.nextPackageId = packageId
    plan.plugin.latestRun = attempt
    if (plan.definition.clientCode === undefined) {
      const started = await this.activate(plan, undefined, false, attempt)
      if (started.ok) return this.runResponse(plan.plugin, started)
      this.failAttempt(plan.plugin, attempt, 'host-load', started)
      return { ...started, reason: 'host-half-failed' }
    }

    const requestId = ApprovalRequestId(this.registry.mintApprovalRequestId())
    const requiresApproval = !plan.plugin.clientVersionUpdatesApproved
      && !plan.plugin.approvedClientPackages.has(packageId)
    attempt.approvalRequestId = requestId
    attempt.requiresApproval = requiresApproval
    attempt.status = requiresApproval ? 'awaiting-approval' : 'starting-host'
    this.registry.armRequest(requestId, {
      agentId: agent.id,
      pluginId,
      packageId,
      pluginRunId: attempt.pluginRunId,
      mode,
      requiresApproval,
    })
    this.ctx.emit('cordis/request-run', {
      requestId,
      agentId: agent.id,
      pluginId,
      packageId,
      mode,
      name: plan.definition.name,
      purpose: plan.definition.purpose,
      requiresApproval,
    })
    return {
      ok: true,
      status: requiresApproval ? 'awaiting-approval' : 'starting',
      pluginId,
      packageId,
      pluginRunId: attempt.pluginRunId,
      mode,
      waitingFor: [],
      ...plan.plugin.currentPackageId === undefined ? {} : { currentPackageId: plan.plugin.currentPackageId },
      nextPackageId: packageId,
    }
  }

  /**
   * Start Host code for an approved request or a direct panel gesture.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity to activate.
   * @param packageId - Immutable Package version to activate.
   * @param mode - Whether to run the current version or switch versions.
   * @param requestId - Model-driven request identity, or null for a direct user gesture.
   * @param approveFutureVersions - Whether this approval covers later Packages of the same Plugin.
   * @returns The exact Host activation or a failure message.
   */
  @Remote('runHostHalf')
  async runHostHalf(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    packageId: CordisDynamicPackageId,
    mode: CordisDynamicRunMode,
    requestId: ApprovalRequestId | null,
    approveFutureVersions: boolean,
  ): Promise<DynamicCordisHostHalfResult> {
    const plan = this.resolvePlan(agent, pluginId, packageId, mode, requestId === null)
    if (!plan.ok) return { ok: false, message: plan.response.message }
    let attempt: DynamicCordisRunAttempt
    if (requestId !== null) {
      const pending = this.registry.peekRequest(requestId)
      if (pending === undefined || pending.pluginId !== pluginId || pending.packageId !== packageId || pending.mode !== mode) {
        return { ok: false, message: `run request "${requestId}" does not authorize ${pluginId}/${packageId}` }
      }
      const latest = plan.plugin.latestRun
      const expectedStatus = pending.requiresApproval ? 'awaiting-approval' : 'starting-host'
      if (latest === undefined || latest.pluginRunId !== pending.pluginRunId
        || (latest.status !== expectedStatus && (!pending.requiresApproval && latest.status !== 'client-pending'))) {
        return { ok: false, message: `run request "${requestId}" no longer identifies the latest run of ${pluginId}` }
      }
      attempt = latest
      if (pending.requiresApproval) {
        plan.plugin.approvedClientPackages.add(packageId)
        if (approveFutureVersions) plan.plugin.clientVersionUpdatesApproved = true
      }
    } else {
      const pending = this.registry.pendingRequestFor(pluginId)
      if (pending !== undefined) return { ok: false, message: `dynamic plugin "${pluginId}" has pending run request ${pending}` }
      const attached = plan.plugin.run?.packageId === packageId
        && plan.plugin.latestRun?.pluginRunId === plan.plugin.run.pluginRunId
        ? plan.plugin.latestRun
        : undefined
      attempt = attached ?? this.createAttempt(plan)
      if (attached === undefined) {
        plan.plugin.nextPackageId = packageId
        plan.plugin.latestRun = attempt
      }
      if (plan.definition.clientCode !== undefined) plan.plugin.approvedClientPackages.add(packageId)
    }
    const attaching = attempt.pluginRunId === plan.plugin.run?.pluginRunId
    if (!attaching) {
      attempt.status = 'starting-host'
      if (attempt.host.status !== 'absent') attempt.host = { status: 'pending', waitingFor: [] }
    }
    const started = await this.activate(plan, requestId ?? undefined, attaching, attempt)
    if (!started.ok) this.failAttempt(plan.plugin, attempt, 'host-load', started)
    return started
  }

  /**
   * Fetch Client code for the exact active run.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity to read.
   * @param pluginRunId - Exact active run authorized to receive source.
   * @returns Client source and its Plugin, Package, and run identities.
   */
  @Remote('getClientCode')
  getClientCode(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
  ): DynamicCordisClientSource {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) throw new Error(missingPluginMessage(pluginId))
    const run = plugin.run
    if (run === undefined || run.pluginRunId !== pluginRunId) {
      throw new Error(`dynamic plugin "${pluginId}" is not running activation "${pluginRunId}"`)
    }
    const definition = plugin.packages.get(run.packageId)
    if (definition?.clientCode === undefined) throw new Error(`package "${run.packageId}" has no Client half`)
    return {
      code: definition.clientCode,
      name: definition.name,
      pluginId,
      packageId: run.packageId,
      pluginRunId,
    }
  }

  /**
   * Resolve one model-driven Client activation request.
   * @param requestId - Request identity to settle once.
   * @param resolution - Browser refusal or exact Client activation result.
   * @returns Whether the still-pending request accepted this resolution.
   */
  @Remote('resolveRequestRun')
  async resolveRequestRun(
    requestId: ApprovalRequestId,
    resolution: DynamicCordisRunResolution,
  ): Promise<DynamicCordisResolveAck> {
    const pending = this.registry.peekRequest(requestId)
    if (pending === undefined) return { accepted: false }
    const plugin = this.registry.get(pending.pluginId)
    if (resolution.ok && plugin?.run?.pluginRunId !== resolution.pluginRunId) return { accepted: false }
    if (!resolution.ok && resolution.pluginRunId !== undefined
      && plugin?.run?.pluginRunId !== resolution.pluginRunId) return { accepted: false }
    this.registry.claimRequest(requestId)
    const settled = await this.settleActivation(plugin, resolution, requestId)
    this.announceResolved(requestId, resolution, pending.requiresApproval ? undefined : 'completed')
    this.steerRunOutcome(pending, settled)
    return { accepted: true }
  }

  /**
   * Settle a direct panel run after this page loaded or failed its Client half.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity being settled.
   * @param resolution - Exact Client activation result from the acting page.
   * @returns The committed activation or its failure.
   */
  @Remote('settleUserRun')
  async settleUserRun(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    resolution: DynamicCordisRunResolution,
  ): Promise<DynamicCordisRunResponse> {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) return { ok: false, reason: 'plugin-missing', message: missingPluginMessage(pluginId) }
    const settled = await this.settleActivation(plugin, resolution)
    this.injectUserRunOutcome(agent, pluginId, settled)
    return settled
  }

  /**
   * Stop the active run while retaining every Package version.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity to stop.
   * @returns Success or the reason no run was stopped.
   */
  async stop(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisStopResponse> {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) return { ok: false, reason: 'plugin-missing', message: missingPluginMessage(pluginId) }
    const pending = this.registry.pendingRequestFor(pluginId)
    if (plugin.run === undefined && pending === undefined
      && plugin.pendingBrowserMounts.size === 0 && plugin.pendingBrowserRegions.size === 0) {
      return { ok: false, reason: 'not-running', message: `dynamic plugin "${pluginId}" is not running` }
    }
    if (pending !== undefined) this.cancelPending(pluginId, `dynamic plugin "${pluginId}" was stopped before approval`)
    if (plugin.run !== undefined) await this.retract(plugin)
    const cleanupPending = await this.cleanupPendingBrowserMounts(plugin)
    if (plugin.latestRun !== undefined) {
      plugin.latestRun.status = 'stopped'
      if (plugin.latestRun.host.status !== 'absent') plugin.latestRun.host = { status: 'stopped', waitingFor: [] }
      if (plugin.latestRun.client.status !== 'absent') plugin.latestRun.client = { status: 'stopped', waitingFor: [] }
    }
    if (cleanupPending.length > 0) {
      return {
        ok: false,
        reason: 'cleanup-pending',
        message: `dynamic plugin stopped, but browser page cleanup remains unresolved: ${cleanupPending.join(', ')}`,
        cleanupPending,
      }
    }
    return { ok: true }
  }

  /**
   * Stop a Plugin from the user panel and queue the resulting state change for the model's next step.
   * @param agent - Agent whose Session owns the Plugin and receives the context.
   * @param pluginId - Stable Plugin identity to stop.
   * @returns Success or the reason no run was stopped.
   */
  @Remote('stopFromPanel')
  async stopFromPanel(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisStopResponse> {
    const result = await this.stop(agent, pluginId)
    if (!result.ok) return result
    const plugin = this.owned(agent, pluginId)
    this.injectUserContext(
      agent,
      `The user stopped Cordis Plugin ${pluginId}. Its Packages remain defined; currentPackageId is `
        + `${plugin?.currentPackageId ?? 'none'}.`,
    )
    return result
  }

  /**
   * Replace the Host mirror of the Client inspect provider directory.
   * @param providers - complete Client provider manifest.
   * @returns null after accepting the manifest.
   */
  @Remote('syncInspectManifest')
  syncInspectManifest(providers: readonly CordisInspectProviderManifest[]): null {
    this.inspectRegistry.syncClientManifest(providers)
    return null
  }

  /**
   * Claim one pending Client inspect query with its live result.
   * @param agent - Session that owns the query.
   * @param requestId - exact pending query identity.
   * @param resolution - provider result or structured refusal.
   * @returns whether this answer won the query.
   */
  @Remote('resolveInspectQuery')
  resolveInspectQuery(
    agent: Agent,
    requestId: CordisInspectRequestId,
    resolution: CordisInspectQueryResolution,
  ): CordisInspectResolveAck {
    return this.inspectRegistry.resolveClientQuery(agent, requestId, resolution)
  }

  /**
   * Frame-wide inventory, grouped as one row per stable Plugin.
   * @returns Source-free metadata for every process-local Plugin.
   */
  /* jscpd:ignore-start */
  @Remote('inventory')
  inventory(): DynamicCordisInventoryRow[] {
    return this.registry.all().map(plugin => ({
      pluginId: plugin.pluginId,
      agentId: plugin.sessionId,
      packages: [...plugin.packages.values()].map(definition => ({
        packageId: definition.packageId,
        name: definition.name,
        purpose: definition.purpose,
        hasHostHalf: definition.hostCode !== undefined,
        hasClientHalf: definition.clientCode !== undefined,
      })),
      ...plugin.currentPackageId === undefined ? {} : { currentPackageId: plugin.currentPackageId },
      ...plugin.nextPackageId === undefined ? {} : { nextPackageId: plugin.nextPackageId },
      ...plugin.run === undefined ? {} : {
        activeRun: { pluginRunId: plugin.run.pluginRunId, packageId: plugin.run.packageId },
      },
      ...plugin.latestRun === undefined ? {} : { latestRun: cloneAttempt(plugin.latestRun) },
    }))
  }
  /* jscpd:ignore-end */

  /**
   * Read one Session's Host-rich state for inspection and result rendering.
   * @param agent - Agent whose Session selects visible Plugins.
   * @returns Plugin versions, active runs, Host fibers, and render failures.
   */
  snapshot(agent: Agent): DynamicCordisSnapshotRow[] {
    return this.registry.ofSession(agent.id).map(plugin => ({
      pluginId: plugin.pluginId,
      ...plugin.currentPackageId === undefined ? {} : { currentPackageId: plugin.currentPackageId },
      ...plugin.nextPackageId === undefined ? {} : { nextPackageId: plugin.nextPackageId },
      packages: [...plugin.packages.values()].map(definition => ({
        packageId: definition.packageId,
        name: definition.name,
        purpose: definition.purpose,
        hasHostHalf: definition.hostCode !== undefined,
        hasClientHalf: definition.clientCode !== undefined,
      })),
      ...plugin.run === undefined ? {} : {
        activeRun: {
          pluginRunId: plugin.run.pluginRunId,
          packageId: plugin.run.packageId,
          ...plugin.run.fiber === undefined ? {} : { fiber: plugin.run.fiber },
          handlers: [...plugin.run.handlers.keys()],
          ...plugin.run.renderFailure === undefined ? {} : { renderFailure: plugin.run.renderFailure },
        },
      },
      ...plugin.latestRun === undefined ? {} : { latestRun: cloneAttempt(plugin.latestRun) },
    }))
  }

  /**
   * Read source-free context for an explicit `@pluginId` user gesture.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity referenced by the user.
   * @returns The preferred modification base, or undefined when unavailable.
   */
  reference(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisReference | undefined {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) return undefined
    const packageId = plugin.nextPackageId
      ?? plugin.currentPackageId
      ?? [...plugin.packages.keys()].at(-1)
    if (packageId === undefined) return undefined
    const definition = plugin.packages.get(packageId)
    if (definition === undefined) return undefined
    return {
      pluginId,
      packageId,
      name: definition.name,
      purpose: definition.purpose,
      ...plugin.currentPackageId === undefined ? {} : { currentPackageId: plugin.currentPackageId },
      ...plugin.nextPackageId === undefined ? {} : { nextPackageId: plugin.nextPackageId },
      ...plugin.run === undefined ? {} : {
        activeRun: { pluginRunId: plugin.run.pluginRunId, packageId: plugin.run.packageId },
      },
      ...plugin.latestRun === undefined ? {} : { latestRun: cloneAttempt(plugin.latestRun) },
    }
  }

  /**
   * List source-free Plugin summaries owned by one Session.
   * @param agent - Agent whose Session selects visible Plugins.
   * @returns one summary per Plugin in creation order.
   */
  listPlugins(agent: Agent): DynamicCordisPluginInspection[] {
    return this.registry.ofSession(agent.id).map(plugin => this.inspectPlugin(agent, plugin.pluginId))
  }

  /**
   * Inspect one Plugin without returning Package source.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - stable Plugin identity.
   * @returns version pointers, latest run, and all Package summaries.
   */
  inspectPlugin(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisPluginInspection {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) throw new Error(missingPluginMessage(pluginId))
    const reference = this.reference(agent, pluginId)
    if (reference === undefined) throw new Error(`dynamic plugin "${pluginId}" has no package`)
    return {
      ...reference,
      state: structuredClone(Object.fromEntries(plugin.state)),
      packages: [...plugin.packages.values()].map(definition => ({
        packageId: definition.packageId,
        name: definition.name,
        purpose: definition.purpose,
        hasHostHalf: definition.hostCode !== undefined,
        hasClientHalf: definition.clientCode !== undefined,
      })),
    }
  }

  /**
   * Read one exact immutable Package and its Host and Client source.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity that owns the Package.
   * @param packageId - Exact immutable Package identity to inspect.
   * @returns Package metadata, source, and the Plugin's lifecycle pointers.
   */
  inspectPackage(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    packageId: CordisDynamicPackageId,
  ): DynamicCordisPackageInspection {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) throw new Error(missingPluginMessage(pluginId))
    const definition = plugin.packages.get(packageId)
    if (definition === undefined) {
      throw new Error(`dynamic package "${packageId}" does not exist on plugin "${pluginId}"`)
    }
    return {
      pluginId,
      packageId,
      name: definition.name,
      purpose: definition.purpose,
      code: {
        ...definition.hostCode === undefined ? {} : { host: definition.hostCode },
        ...definition.clientCode === undefined ? {} : { client: definition.clientCode },
      },
      /* jscpd:ignore-start */
      ...plugin.currentPackageId === undefined ? {} : { currentPackageId: plugin.currentPackageId },
      ...plugin.nextPackageId === undefined ? {} : { nextPackageId: plugin.nextPackageId },
      ...plugin.run === undefined ? {} : {
        activeRun: { pluginRunId: plugin.run.pluginRunId, packageId: plugin.run.packageId },
      },
      ...plugin.latestRun === undefined ? {} : { latestRun: cloneAttempt(plugin.latestRun) },
      /* jscpd:ignore-end */
    }
  }

  /**
   * Record a post-load render failure for the exact active run.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity that rendered.
   * @param pluginRunId - Exact active run that produced the failure.
   * @param failure - Slot, message, and entry-retirement result.
   * @returns Null after recording or ignoring a stale report.
   */
  @Remote('reportRenderFailure')
  async reportRenderFailure(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
    failure: DynamicCordisRenderFailure,
  ): Promise<null> {
    const plugin = this.owned(agent, pluginId)
    if (plugin?.run?.pluginRunId === pluginRunId) {
      const run = plugin.run
      const definition = plugin.packages.get(plugin.run.packageId)
      const shouldSteer = run.renderFailure === undefined
      run.renderFailure = failure
      const attempt = plugin.latestRun
      if (attempt?.pluginRunId === pluginRunId) {
        attempt.error = this.diagnostic(plugin, attempt, 'client-render', failure)
        attempt.client = { status: 'failed', waitingFor: attempt.client.waitingFor, error: failure.message }
        attempt.status = 'failed'
      }
      if (definition !== undefined && shouldSteer) {
        this.steerRenderFailure(agent, plugin, definition, pluginRunId, failure)
      }
    }
    return await Promise.resolve(null)
  }

  /**
   * Report a Client guard rejection that happened after the Package completed activation.
   * @param agent - Agent whose Session must own the Plugin.
   * @param pluginId - Stable Plugin identity whose Client code was rejected.
   * @param pluginRunId - Exact active run that produced the rejection.
   * @param failure - Original guard message and stack.
   * @returns Null after reporting or ignoring a stale/startup failure.
   */
  @Remote('reportClientGuardFailure')
  async reportClientGuardFailure(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
    failure: CordisErrorDetails,
  ): Promise<null> {
    const plugin = this.owned(agent, pluginId)
    const run = plugin?.run
    if (plugin !== undefined && run?.pluginRunId === pluginRunId) {
      this.steerGuardFailure(plugin, run, 'Client', failure)
    }
    return await Promise.resolve(null)
  }

  /**
   * Invoke an active Host method while rejecting stale Client runs.
   * @param pluginId - Stable Plugin identity that owns the method.
   * @param pluginRunId - Exact active run authorizing the call.
   * @param method - Registered Host handler name.
   * @param args - JSON argument delivered to the handler.
   * @returns The JSON result or a typed invocation failure.
   */
  @Remote('invoke')
  async invoke(
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
    method: string,
    args: JsonValue,
  ): Promise<DynamicCordisInvokeResult> {
    const plugin = this.registry.get(pluginId)
    if (plugin === undefined || plugin.run === undefined) {
      return { ok: false, code: 'plugin-not-running', message: `dynamic plugin "${pluginId}" is not running` }
    }
    const run = plugin.run
    if (run.pluginRunId !== pluginRunId) {
      return { ok: false, code: 'stale-run', message: `activation "${pluginRunId}" is no longer active` }
    }
    const handler = run.handlers.get(method)
    if (handler === undefined) {
      return { ok: false, code: 'method-not-found', message: `dynamic plugin "${pluginId}" registered no Host method "${method}"` }
    }
    try {
      return { ok: true, value: await handler(args) as JsonValue }
    } catch (error) {
      const failure = errorDetails(error)
      this.steerHostHandlerFailure(plugin, run, method, failure)
      return { ok: false, code: 'handler-error', ...failure }
    }
  }

  private resolvePlan(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    packageId: CordisDynamicPackageId,
    mode: CordisDynamicRunMode,
    allowActiveAttach = false,
  ): { ok: true } & ActivationPlan | { ok: false; response: Extract<DynamicCordisRunResponse, { ok: false }> } {
    const plugin = this.owned(agent, pluginId)
    if (plugin === undefined) return { ok: false, response: { ok: false, reason: 'plugin-missing', message: missingPluginMessage(pluginId) } }
    const definition = plugin.packages.get(packageId)
    if (definition === undefined) {
      return { ok: false, response: { ok: false, reason: 'package-missing', message: `plugin "${pluginId}" has no package "${packageId}"` } }
    }
    const current = plugin.currentPackageId
    if (mode === 'update' && (current === undefined || current === packageId)) {
      return {
        ok: false,
        response: {
          ok: false,
          reason: 'invalid-mode',
          message: current === undefined
            ? `plugin "${pluginId}" has no successful version yet; start "${packageId}" with mode "run"`
            : `package "${packageId}" is already current; use mode "run"`,
        },
      }
    }
    if (mode === 'run' && current !== undefined && current !== packageId) {
      return {
        ok: false,
        response: {
          ok: false,
          reason: 'invalid-mode',
          message: `package "${packageId}" differs from current "${current}"; use mode "update"`,
        },
      }
    }
    if (!allowActiveAttach && this.starting.has(pluginId)) {
      return { ok: false, response: { ok: false, reason: 'transition-in-flight', message: `plugin "${pluginId}" is already starting` } }
    }
    return { ok: true, plugin, definition, mode }
  }

  private activate(
    plan: ActivationPlan,
    requestId: ApprovalRequestId | undefined,
    allowActiveAttach: boolean,
    attempt: DynamicCordisRunAttempt,
  ): Promise<DynamicCordisHostHalfResult> {
    const inFlight = this.starting.get(plan.plugin.pluginId)
    if (inFlight !== undefined) return inFlight
    const starting = this.startFresh(plan, requestId, allowActiveAttach, attempt)
    this.starting.set(plan.plugin.pluginId, starting)
    return starting.finally(() => { this.starting.delete(plan.plugin.pluginId) })
  }

  private async startFresh(
    plan: ActivationPlan,
    requestId: ApprovalRequestId | undefined,
    allowActiveAttach: boolean,
    attempt: DynamicCordisRunAttempt,
  ): Promise<DynamicCordisHostHalfResult> {
    const { plugin, definition, mode } = plan
    if (allowActiveAttach
      && plugin.run?.packageId === definition.packageId
      && plugin.run.pluginRunId === attempt.pluginRunId) {
      return {
        ok: true,
        pluginId: plugin.pluginId,
        packageId: definition.packageId,
        pluginRunId: plugin.run.pluginRunId,
        waitingFor: missingFor(this.ctx, plugin.run),
        startedHere: false,
      }
    }
    if (plugin.run !== undefined) await this.retract(plugin)
    if ((plugin.pendingBrowserMounts.size > 0 || plugin.pendingBrowserRegions.size > 0)
      && (await this.cleanupPendingBrowserMounts(plugin)).length > 0) {
      return { ok: false, message: 'browser cleanup must settle before starting another Plugin version' }
    }
    if (mode === 'update' || plugin.currentPackageId === undefined) plugin.nextPackageId = definition.packageId
    const run: DynamicCordisRun = {
      pluginRunId: attempt.pluginRunId,
      packageId: definition.packageId,
      handlers: new Map(),
      handlerDisposers: [],
      reportedRuntimeErrors: new Set(),
      ownedBrowserMounts: new Map(),
      ownedBrowserRegions: new Map(),
      browserLifetime: new AbortController(),
      browserWork: new Set(),
      ...requestId === undefined ? {} : { startedForRequest: requestId },
    }
    plugin.run = run
    if (definition.hostCode !== undefined) {
      const failure = await this.startHost(plugin, definition.hostCode, run)
      if (failure !== undefined) {
        if (plugin.run === run) delete plugin.run
        return { ok: false, ...failure }
      }
    }
    if (run.browserLifetime.signal.aborted || plugin.run !== run) {
      await run.fiber?.dispose()
      await this.cleanupBrowserMounts(plugin, run)
      return { ok: false, message: 'dynamic Plugin stopped during activation' }
    }
    this.ctx.emit('cordis/dynamic-package', {
      pluginId: plugin.pluginId,
      packageId: definition.packageId,
      pluginRunId: run.pluginRunId,
      name: definition.name,
    })
    attempt.host = {
      status: run.fiber === undefined ? 'absent' : missingFor(this.ctx, run).length === 0 ? 'running' : 'waiting',
      waitingFor: missingFor(this.ctx, run),
    }
    if (definition.clientCode === undefined) {
      this.commitActivation(plugin, run)
    } else {
      attempt.status = 'client-pending'
      attempt.client = { status: 'pending', waitingFor: [] }
    }
    return {
      ok: true,
      pluginId: plugin.pluginId,
      packageId: definition.packageId,
      pluginRunId: run.pluginRunId,
      waitingFor: missingFor(this.ctx, run),
      startedHere: true,
    }
  }

  private async startHost(
    plugin: DynamicCordisPlugin,
    hostCode: string,
    run: DynamicCordisRun,
  ): Promise<CordisErrorDetails | undefined> {
    const handle = (method: unknown, fn: unknown): (() => void) => {
      const normalized = normalizeHandler(method, fn)
      run.handlers.set(normalized.method, normalized.handler)
      const dispose = (): void => {
        if (run.handlers.get(normalized.method) === normalized.handler) run.handlers.delete(normalized.method)
      }
      run.handlerDisposers.push(dispose)
      return dispose
    }
    try {
      const sandbox = createSandbox(plugin.pluginId, {
        handle,
        sessionId: plugin.sessionId,
        pluginId: plugin.pluginId,
        pluginRunId: run.pluginRunId,
        state: pluginStateFacade(plugin),
        browser: this.browserEntryFacade(plugin, run),
      })
      const evaluated = await evaluateHostCode(sandbox, hostCode, plugin.pluginId, this.resolved.vmTimeoutMs)
      if (!isPlugin(evaluated)) {
        throw new Error(evaluated === undefined
          ? 'the Host half returned `undefined` — did you forget `return`?'
          : 'the Host half must return a Plugin function or an object with apply(ctx)')
      }
      run.fiber = await startHostHalf(
        this.requireGroup(),
        evaluated,
        (error) => { this.steerGuardFailure(plugin, run, 'Host', errorDetails(error)) },
      )
      return undefined
    } catch (error) {
      run.browserLifetime.abort()
      for (const dispose of run.handlerDisposers.splice(0)) dispose()
      await this.cleanupBrowserMounts(plugin, run)
      return errorDetails(error)
    }
  }

  private browserEntryFacade(plugin: DynamicCordisPlugin, run: DynamicCordisRun): object {
    const execute = async (input: Record<string, unknown>, action: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> => {
      run.browserLifetime.signal.throwIfAborted()
      const browser = this.ctx.get('browser') as { execute?: (operation: unknown, signal: AbortSignal) => Promise<unknown> } | undefined
      if (typeof browser?.execute !== 'function') throw new Error('harness.browser requires the Browser service')
      const installationId = requiredText(input.installationId, 'installationId', 128)
      const lifetime = AbortSignal.any([run.browserLifetime.signal, signal ?? AbortSignal.timeout(15_000)])
      const work = this.executeBrowser(
        plugin,
        browser,
        { sessionId: plugin.sessionId, installationId, requestId: randomUUID(), action },
        lifetime,
      )
      run.browserWork.add(work)
      plugin.pendingBrowserWork.add(work)
      try { return await work } finally { run.browserWork.delete(work); plugin.pendingBrowserWork.delete(work) }
    }
    const slot = (input: Record<string, unknown>): string => {
      const value = requiredText(input.slot, 'slot', 32)
      if (!/^[a-z][a-z0-9-]*$/u.test(value)) throw new Error('harness.browser slot must be lowercase ASCII with optional digits or hyphens')
      return value
    }
    const page = (input: Record<string, unknown>): Record<string, unknown> => {
      const value = input.page
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('harness.browser page is required')
      const cloned = structuredClone(value as Record<string, unknown>)
      const fields = Object.keys(cloned)
      if (fields.length !== 4 || !['tabId', 'frameId', 'documentId', 'url'].every(field => fields.includes(field))) {
        throw new Error('harness.browser page must contain only tabId, frameId, documentId, and url')
      }
      return {
        tabId: requiredNonnegativeInteger(cloned.tabId, 'page tabId'),
        frameId: requiredNonnegativeInteger(cloned.frameId, 'page frameId'),
        documentId: requiredText(cloned.documentId, 'page documentId', 128),
        url: httpUrl(cloned.url, 'page url'),
      }
    }
    return Object.freeze({
      inspect: async (input: Record<string, unknown>, signal?: AbortSignal) => execute(input, {
        kind: 'entry_inspect', page: page(input),
        regionSelector: requiredText(input.regionSelector, 'regionSelector', 256),
        selector: requiredText(input.selector, 'selector', 256),
        ...optionalText(input, 'titleSelector', 256), ...optionalText(input, 'linkSelector', 256),
        ...(input.sampleLimit === undefined ? {} : { sampleLimit: input.sampleLimit }),
      }, signal),
      pageMap: async (input: Record<string, unknown>, signal?: AbortSignal) => execute(input, {
        kind: 'page_map', page: page(input),
      }, signal),
      mount: async (input: Record<string, unknown>, signal?: AbortSignal) => {
        run.browserLifetime.signal.throwIfAborted()
        const ownedSlot = slot(input)
        const mountId = `${plugin.pluginId}:${ownedSlot}`
        const ownedPage = page(input)
        // Finish every local parse/clone before registering ownership. A
        // synchronous validation failure never crossed the Browser boundary
        // and therefore creates no cleanup responsibility.
        const installationId = requiredText(input.installationId, 'installationId', 128)
        const action = {
          kind: 'entry_mount' as const, page: ownedPage, mountId,
          regionSelector: requiredText(input.regionSelector, 'regionSelector', 256),
          selector: requiredText(input.selector, 'selector', 256), label: requiredText(input.label, 'label', 64),
          ...optionalText(input, 'titleSelector', 256), ...optionalText(input, 'linkSelector', 256),
          ...(input.collected === undefined ? {} : { collected: structuredClone(input.collected) }),
        }
        const previous = plugin.retainedBrowserMounts.get(mountId)
        const samePage = previous !== undefined && previous.installationId === installationId
          && previous.page.tabId === ownedPage.tabId && previous.page.frameId === ownedPage.frameId
          && previous.page.documentId === ownedPage.documentId && previous.page.url === ownedPage.url
        if (previous !== undefined && !samePage) throw new Error('browser slot is bound to another page; use a new slot')
        if (previous === undefined && plugin.retainedBrowserMounts.size >= 128) {
          throw new Error('browser slot retention capacity exceeded')
        }
        const owned = { installationId,
          page: ownedPage as { tabId: number; frameId: number; documentId: string; url: string }, mountId }
        run.ownedBrowserMounts.set(ownedSlot, owned)
        plugin.retainedBrowserMounts.set(mountId, owned)
        // Track before dispatch because an infrastructure failure can surface after delivery crossed the process boundary.
        const result = await execute(input, action, signal) as { outcome?: unknown }
        if (definitelyNotSent(result) && run.ownedBrowserMounts.get(ownedSlot) === owned) {
          if (previous === undefined) {
            run.ownedBrowserMounts.delete(ownedSlot)
            plugin.retainedBrowserMounts.delete(mountId)
          } else {
            run.ownedBrowserMounts.set(ownedSlot, previous)
            plugin.retainedBrowserMounts.set(mountId, previous)
          }
        }
        return result
      },
      unmount: async (input: Record<string, unknown>, signal?: AbortSignal) => {
        const ownedSlot = slot(input)
        const existing = run.ownedBrowserMounts.get(ownedSlot)
        const mountId = `${plugin.pluginId}:${ownedSlot}`
        const result = await execute(input, { kind: 'entry_unmount', page: page(input), mountId }, signal) as { outcome?: unknown }
        // An earlier unmount may finish after a same-slot mount.  The mount id is
        // stable per slot, so it cannot distinguish those two registrations.
        if (confirmedUnmount(result) && existing !== undefined && run.ownedBrowserMounts.get(ownedSlot) === existing) {
          run.ownedBrowserMounts.delete(ownedSlot)
        }
        return result
      },
      render: async (input: Record<string, unknown>, signal?: AbortSignal) => {
        run.browserLifetime.signal.throwIfAborted()
        const ownedSlot = slot(input)
        const mountId = `${plugin.pluginId}:${ownedSlot}`
        const ownedPage = page(input)
        // Complete all local validation before reserving a cleanup obligation.
        // A synchronous validation/clone failure has not crossed the page
        // boundary and must not look like an uncertain rendered region.
        const regionRef = requiredRegionRef(input.regionRef)
        const placement = optionalEnum(input, 'placement', ['prepend', 'append'] as const)
        const mode = optionalEnum(input, 'mode', ['append', 'replace'] as const)
        const presentation = cloneRegionPresentation(input.presentation)
        const installationId = requiredText(input.installationId, 'installationId', 128)
        const previous = run.ownedBrowserRegions.get(ownedSlot)
        if (previous !== undefined && (previous.installationId !== installationId
          || previous.page.tabId !== ownedPage.tabId || previous.page.frameId !== ownedPage.frameId
          || previous.page.documentId !== ownedPage.documentId || previous.page.url !== ownedPage.url)) {
          throw new Error('browser region slot is bound to another page; restore it before rebinding')
        }
        const owned = { installationId,
          page: ownedPage as { tabId: number; frameId: number; documentId: string; url: string }, mountId }
        // Track before dispatch because an infrastructure failure can surface after delivery crossed the process boundary.
        run.ownedBrowserRegions.set(ownedSlot, owned)
        const result = await execute(input, {
          kind: 'region_render', page: ownedPage, mountId,
          regionRef, ...placement, ...mode, presentation,
        }, signal) as { outcome?: unknown }
        if (definitelyNotSent(result)) {
          // Do not roll a newer same-slot render back when this dispatch settles late.
          if (run.ownedBrowserRegions.get(ownedSlot) === owned) {
            if (previous === undefined) run.ownedBrowserRegions.delete(ownedSlot)
            else run.ownedBrowserRegions.set(ownedSlot, previous)
          }
        }
        return result
      },
      restore: async (input: Record<string, unknown>, signal?: AbortSignal) => {
        const ownedSlot = slot(input)
        const existing = run.ownedBrowserRegions.get(ownedSlot)
        const mountId = `${plugin.pluginId}:${ownedSlot}`
        const result = await execute(input, { kind: 'region_clear', page: page(input), mountId }, signal) as { outcome?: unknown; value?: unknown }
        // See unmount: mount ids name slots rather than an individual dispatch.
        if (confirmedRegionClear(result) && existing !== undefined && run.ownedBrowserRegions.get(ownedSlot) === existing) {
          run.ownedBrowserRegions.delete(ownedSlot)
          if (plugin.pendingBrowserRegions.get(mountId) === existing) plugin.pendingBrowserRegions.delete(mountId)
        }
        return result
      },
    })
  }

  private async cleanupBrowserMounts(plugin: DynamicCordisPlugin, run: DynamicCordisRun): Promise<string[]> {
    run.browserLifetime.abort()
    const outstanding = Promise.allSettled([...run.browserWork])
    let timer: ReturnType<typeof setTimeout> | undefined
    const settled = await Promise.race([outstanding.then(() => true), new Promise<boolean>((resolve) => {
      timer = setTimeout(() =>{  resolve(false) }, 5_000)
    })])
    clearTimeout(timer)
    if (!settled) {
      for (const mount of run.ownedBrowserMounts.values()) plugin.pendingBrowserMounts.set(mount.mountId, mount)
      for (const region of run.ownedBrowserRegions.values()) plugin.pendingBrowserRegions.set(region.mountId, region)
      return [...run.ownedBrowserMounts.values(), ...run.ownedBrowserRegions.values()].map(mount => mount.mountId)
    }
    const browser = this.ctx.get('browser') as BrowserGateway | undefined
    if (typeof browser?.execute !== 'function') {
      for (const mount of run.ownedBrowserMounts.values()) plugin.pendingBrowserMounts.set(mount.mountId, mount)
      for (const region of run.ownedBrowserRegions.values()) plugin.pendingBrowserRegions.set(region.mountId, region)
      return [...run.ownedBrowserMounts.values(), ...run.ownedBrowserRegions.values()].map(mount => mount.mountId)
    }
    const pending: string[] = []
    for (const [slot, mount] of [...run.ownedBrowserMounts]) {
      if (await this.reconcileCleanup(plugin, browser, 'entry_unmount', mount, false)) {
        if (run.ownedBrowserMounts.get(slot) === mount) run.ownedBrowserMounts.delete(slot)
        if (plugin.pendingBrowserMounts.get(mount.mountId) === mount) plugin.pendingBrowserMounts.delete(mount.mountId)
      } else {
        plugin.pendingBrowserMounts.set(mount.mountId, mount)
        pending.push(mount.mountId)
      }
    }
    for (const [slot, region] of [...run.ownedBrowserRegions]) {
      if (await this.reconcileCleanup(plugin, browser, 'region_clear', region, false)) {
        if (run.ownedBrowserRegions.get(slot) === region) run.ownedBrowserRegions.delete(slot)
        if (plugin.pendingBrowserRegions.get(region.mountId) === region) plugin.pendingBrowserRegions.delete(region.mountId)
      } else {
        plugin.pendingBrowserRegions.set(region.mountId, region)
        pending.push(region.mountId)
      }
    }
    return pending
  }

  private async cleanupPendingBrowserMounts(plugin: DynamicCordisPlugin, forgetCollected = false): Promise<string[]> {
    const unresolved = () => [...plugin.pendingBrowserMounts.keys(), ...plugin.pendingBrowserRegions.keys()]
    if (plugin.pendingBrowserWork.size > 0) return unresolved()
    const browser = this.ctx.get('browser') as BrowserGateway | undefined
    if (typeof browser?.execute !== 'function') return unresolved()
    const pending: string[] = []
    for (const [mountId, mount] of [...plugin.pendingBrowserMounts]) {
      if (await this.reconcileCleanup(plugin, browser, 'entry_unmount', mount, forgetCollected)) {
        if (plugin.pendingBrowserMounts.get(mountId) === mount) plugin.pendingBrowserMounts.delete(mountId)
        if (forgetCollected && plugin.retainedBrowserMounts.get(mountId) === mount) plugin.retainedBrowserMounts.delete(mountId)
      } else {
        pending.push(mountId)
      }
    }
    for (const [mountId, region] of [...plugin.pendingBrowserRegions]) {
      if (await this.reconcileCleanup(plugin, browser, 'region_clear', region, false)) {
        if (plugin.pendingBrowserRegions.get(mountId) === region) plugin.pendingBrowserRegions.delete(mountId)
      } else {
        pending.push(mountId)
      }
    }
    return pending
  }

  /**
   * Reconcile one cleanup action. A sent/unknown cleanup is never executed a
   * second time: its original request id is status-polled until a conclusive
   * receipt arrives. Only an explicitly not-sent result becomes eligible for
   * a later fresh cleanup request.
   */
  private async reconcileCleanup(
    plugin: DynamicCordisPlugin,
    browser: BrowserGateway,
    kind: BrowserCleanupKind,
    target: { installationId: string; page: { tabId: number; frameId: number; documentId: string; url: string }; mountId: string },
    forgetCollected: boolean,
  ): Promise<boolean> {
    const key = this.cleanupKey(plugin, kind, target.mountId)
    const prior = this.cleanupRequests.get(key)
    if (prior !== undefined) {
      if (typeof browser.requestStatus !== 'function') return false
      let status: unknown
      try {
        status = await browser.requestStatus({
          requestId: prior.requestId, sessionId: prior.sessionId, installationId: prior.installationId,
        })
      } catch (error) {
        console.error(`[cordis:${plugin.pluginId}] failed to reconcile sent browser cleanup ${target.mountId}`, error)
        return false
      }
      if (cleanupConfirmed(kind, status)) {
        this.cleanupRequests.delete(key)
        // A normal stop's unmount deliberately preserves the collected-entry
        // cache.  It cannot satisfy a later permanent removal that explicitly
        // asks the extension to forget that cache, so make that stronger,
        // semantically distinct cleanup eligible on the next lifecycle pass.
        if (kind === 'entry_unmount' && forgetCollected && !prior.forgetCollected) return false
        return true
      }
      // The action was definitely never sent. Drop only this transport
      // identity; the next lifecycle pass may mint a fresh cleanup request.
      if (definitelyNotSent(status)) this.cleanupRequests.delete(key)
      return false
    }

    const request: BrowserCleanupRequest = {
      requestId: randomUUID(), sessionId: plugin.sessionId, installationId: target.installationId, forgetCollected,
    }
    const action = kind === 'entry_unmount'
      ? { kind, page: target.page, mountId: target.mountId, ...(forgetCollected ? { forgetCollected: true } : {}) }
      : { kind, page: target.page, mountId: target.mountId }
    try {
      const result = await this.executeBrowser(plugin, browser, {
        requestId: request.requestId, sessionId: request.sessionId,
        installationId: request.installationId, action,
      }, AbortSignal.timeout(5_000), true)
      if (cleanupConfirmed(kind, result)) return true
      if (!definitelyNotSent(result)) this.cleanupRequests.set(key, request)
    } catch (error) {
      // A thrown transport boundary does not prove that the page did not see
      // the cleanup. Preserve its identity and require status-only recovery.
      this.cleanupRequests.set(key, request)
      console.error(`[cordis:${plugin.pluginId}] failed to dispatch browser cleanup ${target.mountId}`, error)
    }
    return false
  }

  private cleanupKey(plugin: DynamicCordisPlugin, kind: BrowserCleanupKind, mountId: string): string {
    return `${plugin.pluginId}\u0000${kind}\u0000${mountId}`
  }

  private async settleActivation(
    plugin: DynamicCordisPlugin | undefined,
    resolution: DynamicCordisRunResolution,
    requestId?: ApprovalRequestId,
  ): Promise<DynamicCordisRunResponse> {
    if (plugin === undefined) return { ok: false, reason: 'plugin-missing', message: 'the dynamic plugin was removed during activation' }
    const attempt = plugin.latestRun
    if (!resolution.ok) {
      if (resolution.reason === 'rejected') {
        if (attempt !== undefined) {
          attempt.status = 'rejected'
          attempt.error = this.diagnostic(plugin, attempt, 'approval', resolution.message ?? 'the run request was declined')
          attempt.client = { status: 'stopped', waitingFor: [] }
        }
        return { ok: false, reason: 'rejected', message: resolution.message ?? 'the run request was declined' }
      }
      const run = plugin.run
      const ownsRun = run !== undefined
        && resolution.pluginRunId === run.pluginRunId
        && (requestId === undefined || run.startedForRequest === requestId)
        && resolution.startedHere !== false
      if (ownsRun) await this.retract(plugin)
      if (attempt !== undefined && (resolution.pluginRunId === undefined || attempt.pluginRunId === resolution.pluginRunId)) {
        this.failAttempt(
          plugin,
          attempt,
          resolution.reason === 'host-half-failed' ? 'host-apply' : 'client-apply',
          {
            message: resolution.message ?? resolution.reason,
            ...resolution.stack === undefined ? {} : { stack: resolution.stack },
          },
        )
      }
      return {
        ok: false,
        reason: resolution.reason,
        message: resolution.message ?? resolution.reason,
        ...resolution.stack === undefined ? {} : { stack: resolution.stack },
      }
    }
    const run = plugin.run
    if (run === undefined || run.pluginRunId !== resolution.pluginRunId) {
      return { ok: false, reason: 'client-half-failed', message: `activation "${resolution.pluginRunId}" is no longer active` }
    }
    if (attempt !== undefined && attempt.pluginRunId === run.pluginRunId) {
      attempt.client = {
        status: resolution.waitingFor === undefined || resolution.waitingFor.length === 0 ? 'running' : 'waiting',
        waitingFor: resolution.waitingFor ?? [],
      }
    }
    this.commitActivation(plugin, run)
    return {
      ...this.runResponse(plugin, {
        ok: true,
        pluginId: plugin.pluginId,
        packageId: run.packageId,
        pluginRunId: run.pluginRunId,
        waitingFor: missingFor(this.ctx, run),
        startedHere: false,
      }),
      ...resolution.waitingFor === undefined ? {} : { clientWaitingFor: resolution.waitingFor },
    }
  }

  private commitActivation(plugin: DynamicCordisPlugin, run: DynamicCordisRun): void {
    plugin.currentPackageId = run.packageId
    delete plugin.nextPackageId
    delete run.startedForRequest
    const attempt = plugin.latestRun
    if (attempt?.pluginRunId === run.pluginRunId) {
      attempt.status = attempt.host.status === 'waiting' || attempt.client.status === 'waiting' ? 'waiting' : 'running'
      delete attempt.approvalRequestId
      delete attempt.requiresApproval
      delete attempt.error
    }
  }

  private runResponse(
    plugin: DynamicCordisPlugin,
    started: Extract<DynamicCordisHostHalfResult, { ok: true }>,
  ): Extract<DynamicCordisRunResponse, { ok: true }> {
    return {
      ok: true,
      status: 'running',
      pluginId: plugin.pluginId,
      packageId: started.packageId,
      pluginRunId: started.pluginRunId,
      waitingFor: started.waitingFor,
      currentPackageId: started.packageId,
      mode: plugin.latestRun?.pluginRunId === started.pluginRunId ? plugin.latestRun.mode : 'run',
    }
  }

  private announceResolved(
    requestId: ApprovalRequestId,
    resolution: DynamicCordisRunResolution,
    override?: RequestRunOutcome,
  ): void {
    const outcome = override ?? (resolution.ok ? 'approved' : resolution.reason === 'rejected' ? 'rejected' : 'failed')
    this.ctx.emit('cordis/request-run-resolved', { requestId, outcome })
  }

  private steerRunOutcome(
    pending: DynamicCordisPendingRequest,
    settled: DynamicCordisRunResponse,
  ): void {
    const agents = this.rootCtx.get('agents')
    const agent = agents?.get(pending.agentId)
    if (agent === undefined) return
    const plugin = this.registry.get(pending.pluginId)
    const identity = `${pending.pluginId}/${pending.packageId} (${pending.pluginRunId})`
    let text: string
    if (settled.ok) {
      text = `Cordis ${pending.mode} ${identity} completed successfully. `
        + `currentPackageId is ${settled.currentPackageId ?? pending.packageId}. Continue using the running Plugin.`
    } else if (settled.reason === 'rejected') {
      text = `The user rejected Cordis ${pending.mode} ${identity}. `
        + 'Do not request the same activation again unless the user asks.'
    } else {
      const returnedStatus = pending.requiresApproval ? 'awaiting-approval' : 'starting'
      text = `Cordis ${pending.mode} ${identity} failed after cordis_run returned ${returnedStatus}: `
        + `${settled.reason}\n${formatErrorDetails(settled)}\n`
        + `currentPackageId: ${plugin?.currentPackageId ?? 'none'}\n`
        + `nextPackageId: ${plugin?.nextPackageId ?? pending.packageId}\n`
        + 'Inspect the failed Package, correct it on the same Plugin when needed, and retry the activation autonomously.'
    }
    agent.steer(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'cordis-host-runner' },
    }))
  }

  private steerRenderFailure(
    agent: Agent,
    plugin: DynamicCordisPlugin,
    definition: DynamicCordisDefinition,
    pluginRunId: CordisDynamicPluginRunId,
    failure: DynamicCordisRenderFailure,
  ): void {
    agent.steer(createUserMessage({
      content: [{
        type: 'text',
        text: `Cordis Client UI ${plugin.pluginId}/${definition.packageId} (${pluginRunId}) failed while rendering `
          + `Slot "${failure.slot}" after activation.\n`
          + `${formatErrorDetails(failure)}\n`
          + `entryAbdicated: ${failure.abdicated}\n`
          + 'Inspect the failed Package, fix the Client code by defining a new Package on the same Plugin, and '
          + 'activate that Package autonomously with cordis_run mode:"update".',
      }],
      source: { kind: 'plugin', plugin: 'cordis-host-runner' },
    }))
  }

  private steerHostHandlerFailure(
    plugin: DynamicCordisPlugin,
    run: DynamicCordisRun,
    method: string,
    failure: CordisErrorDetails,
  ): void {
    const reportKey = `Host\u0000handler\u0000${method}\u0000${failure.message}`
    if (!this.claimRuntimeFailure(plugin, run, reportKey)) return
    const agents = this.rootCtx.get('agents')
    const agent = agents?.get(plugin.sessionId)
    if (agent === undefined) return
    agent.steer(createUserMessage({
      content: [{
        type: 'text',
        text: `Cordis Host handler ${plugin.pluginId}/${run.packageId} (${run.pluginRunId}) failed when the Client called `
          + `host.call(${JSON.stringify(method)}).\n`
          + `${formatErrorDetails(failure)}\n`
          + 'The Plugin remains running. Inspect this Package, correct the Host code on the same Plugin, and activate '
          + 'the new Package autonomously with cordis_run mode:"update". If the handler needs a Service, either declare '
          + 'that Service in the returned Plugin inject list or read it with ctx.get(name) and handle undefined.',
      }],
      source: { kind: 'plugin', plugin: 'cordis-host-runner' },
    }))
  }

  /* jscpd:ignore-start */
  private steerGuardFailure(
    plugin: DynamicCordisPlugin,
    run: DynamicCordisRun,
    platform: 'Host' | 'Client',
    failure: CordisErrorDetails,
  ): void {
    const reportKey = `${platform}\u0000guard\u0000${failure.message}`
    if (!this.claimRuntimeFailure(plugin, run, reportKey)) return
    const agents = this.rootCtx.get('agents')
    const agent = agents?.get(plugin.sessionId)
    if (agent === undefined) return
    agent.steer(createUserMessage({
      content: [{
        type: 'text',
        text: `Cordis ${platform} guard rejected runtime code in ${plugin.pluginId}/${run.packageId} `
          + `(${run.pluginRunId}) after activation.\n${formatErrorDetails(failure)}\n`
          + 'The Plugin remains running. Inspect this Package, define a corrected Package on the same Plugin, and '
          + 'activate it autonomously with cordis_run mode:"update".',
      }],
      source: { kind: 'plugin', plugin: 'cordis-host-runner' },
    }))
  }
  /* jscpd:ignore-end */

  private claimRuntimeFailure(plugin: DynamicCordisPlugin, run: DynamicCordisRun, key: string): boolean {
    const attempt = plugin.latestRun
    if (plugin.run !== run || attempt?.pluginRunId !== run.pluginRunId
      || (attempt.status !== 'running' && attempt.status !== 'waiting')) return false
    if (run.reportedRuntimeErrors.has(key)) return false
    run.reportedRuntimeErrors.add(key)
    return true
  }

  private injectUserRunOutcome(
    agent: Agent,
    pluginId: CordisDynamicPluginId,
    settled: DynamicCordisRunResponse,
  ): void {
    const plugin = this.owned(agent, pluginId)
    let text: string
    if (settled.ok) {
      text = `The user manually ran Cordis Plugin ${pluginId}, Package ${settled.packageId}, `
        + `as ${settled.pluginRunId}. The activation succeeded; currentPackageId is ${settled.currentPackageId}.`
    } else {
      const attempt = plugin?.latestRun
      text = `The user manually ran Cordis Plugin ${pluginId}`
        + `${attempt === undefined ? '' : `, Package ${attempt.packageId}, as ${attempt.pluginRunId}`}, but it failed: `
        + `${settled.reason}\n${formatErrorDetails(settled)}\n`
        + `currentPackageId: ${plugin?.currentPackageId ?? 'none'}\n`
        + `nextPackageId: ${plugin?.nextPackageId ?? 'none'}`
    }
    this.injectUserContext(agent, text)
  }

  private injectUserContext(agent: Agent, text: string): void {
    const agents = this.rootCtx.get('agents')
    if (agents?.get(agent.id) !== agent) return
    agent.inject(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'cordis-host-runner' },
    }))
  }

  private cancelPending(pluginId: CordisDynamicPluginId, message: string): void {
    const requestId = this.registry.pendingRequestFor(pluginId)
    if (requestId === undefined) return
    const pending = this.registry.claimRequest(requestId)
    if (pending === undefined) return
    const plugin = this.registry.get(pluginId)
    if (plugin?.latestRun?.pluginRunId === pending.pluginRunId) {
      plugin.latestRun.status = 'cancelled'
      plugin.latestRun.error = this.diagnostic(plugin, plugin.latestRun, 'approval', message)
      delete plugin.latestRun.approvalRequestId
      delete plugin.latestRun.requiresApproval
    }
    this.announceResolved(requestId, { ok: false, reason: 'rejected' }, 'cancelled')
  }

  private createAttempt(plan: ActivationPlan): DynamicCordisRunAttempt {
    return {
      pluginRunId: CordisDynamicPluginRunId(this.registry.mintPluginRunId()),
      packageId: plan.definition.packageId,
      mode: plan.mode,
      status: 'starting-host',
      host: {
        status: plan.definition.hostCode === undefined ? 'absent' : 'pending',
        waitingFor: [],
      },
      client: {
        status: plan.definition.clientCode === undefined ? 'absent' : 'pending',
        waitingFor: [],
      },
    }
  }

  private failAttempt(
    plugin: DynamicCordisPlugin,
    attempt: DynamicCordisRunAttempt,
    phase: NonNullable<DynamicCordisRunAttempt['error']>['phase'],
    failure: CordisErrorDetails,
  ): void {
    attempt.status = 'failed'
    attempt.error = this.diagnostic(plugin, attempt, phase, failure)
    if (phase.startsWith('host')) attempt.host = { status: 'failed', waitingFor: [], error: failure.message }
    else attempt.client = { status: 'failed', waitingFor: [], error: failure.message }
  }

  private diagnostic(
    plugin: DynamicCordisPlugin,
    attempt: DynamicCordisRunAttempt,
    phase: NonNullable<DynamicCordisRunAttempt['error']>['phase'],
    failure: CordisErrorDetails | string,
  ): NonNullable<DynamicCordisRunAttempt['error']> {
    const details = typeof failure === 'string' ? { message: failure } : failure
    return {
      phase,
      ...details,
      pluginId: plugin.pluginId,
      packageId: attempt.packageId,
      pluginRunId: attempt.pluginRunId,
    }
  }

  private async retract(plugin: DynamicCordisPlugin): Promise<string[]> {
    const run = plugin.run
    if (run === undefined) return []
    delete plugin.run
    run.browserLifetime.abort()
    for (const dispose of run.handlerDisposers.splice(0)) dispose()
    if (run.fiber !== undefined) await run.fiber.dispose()
    const cleanupPending = await this.cleanupBrowserMounts(plugin, run)
    this.ctx.emit('cordis/dynamic-retract', {
      pluginId: plugin.pluginId,
      packageId: run.packageId,
      pluginRunId: run.pluginRunId,
    })
    return cleanupPending
  }

  private owned(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisPlugin | undefined {
    const plugin = this.registry.get(pluginId)
    return this.rootCtx.agents.get(agent.id) === agent && plugin?.ownerAgent === agent ? plugin : undefined
  }

  private requireLiveAgent(agent: Agent): void {
    if (this.rootCtx.agents.get(agent.id) !== agent) {
      throw new Error('dynamic Cordis requires an exact live Agent owner')
    }
  }

  private ensureOwnerCleanup(agent: Agent): void {
    if (this.ownerCleanups.has(agent)) return
    const cleanup = agent.ctx.effect(() => async () => {
      if (this.ownerCleanups.get(agent) !== cleanup) return
      this.ownerCleanups.delete(agent)
      await this.disposeOwned(agent)
    }, `dynamicCordisRunner.owner(${agent.id})`)
    this.ownerCleanups.set(agent, cleanup)
  }

  private ownerIsLive(plugin: DynamicCordisPlugin): boolean {
    return this.rootCtx.agents.get(plugin.ownerAgent.id) === plugin.ownerAgent
  }

  /** Retry only orphaned exact cleanup receipts, never ordinary Plugin work. */
  private scheduleOrphanCleanup(plugin: DynamicCordisPlugin): void {
    if (this.orphanCleanupTimers.has(plugin.pluginId) || this.ownerIsLive(plugin)) return
    const attempt = this.orphanCleanupAttempts.get(plugin.pluginId) ?? 0
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5))
    const timer = setTimeout(() => {
      this.orphanCleanupTimers.delete(plugin.pluginId)
      void this.retryOrphanCleanup(plugin)
    }, delay)
    // An unresolved remote page must not hold the Host process open solely for
    // best-effort convergence during shutdown.
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    this.orphanCleanupTimers.set(plugin.pluginId, timer)
  }

  private async retryOrphanCleanup(plugin: DynamicCordisPlugin): Promise<void> {
    if (this.registry.get(plugin.pluginId) !== plugin || this.ownerIsLive(plugin)) return
    const remaining = await this.cleanupPendingBrowserMounts(plugin, true)
    if (remaining.length === 0) {
      this.forgetPlugin(plugin)
      return
    }
    this.orphanCleanupAttempts.set(plugin.pluginId, (this.orphanCleanupAttempts.get(plugin.pluginId) ?? 0) + 1)
    this.scheduleOrphanCleanup(plugin)
  }

  private forgetPlugin(plugin: DynamicCordisPlugin): void {
    const timer = this.orphanCleanupTimers.get(plugin.pluginId)
    if (timer !== undefined) clearTimeout(timer)
    this.orphanCleanupTimers.delete(plugin.pluginId)
    this.orphanCleanupAttempts.delete(plugin.pluginId)
    for (const key of this.cleanupRequests.keys()) {
      if (key.startsWith(`${plugin.pluginId}\u0000`)) this.cleanupRequests.delete(key)
    }
    this.registry.delete(plugin.pluginId)
  }

  private executeBrowser(
    plugin: DynamicCordisPlugin,
    browser: { execute?: (operation: unknown, signal: AbortSignal) => Promise<unknown> },
    operation: unknown,
    signal: AbortSignal,
    allowDetachedOwnerCleanup = false,
  ): Promise<unknown> {
    const execute = browser.execute
    if (typeof execute !== 'function') throw new Error('harness.browser requires the Browser service')
    // A terminal BrowserTask is immutable. Exact resources already captured by
    // this runner transfer their remaining cleanup responsibility to the
    // runner ledger instead of mutating or reopening that old task. Ordinary
    // Plugin work never enters this path, and unknown cleanup remains bound to
    // its original requestStatus identity in reconcileCleanup().
    if (allowDetachedOwnerCleanup && (!this.ownerIsLive(plugin) || this.ownerTaskIsTerminal(plugin))) {
      return execute(operation, signal)
    }
    return this.rootCtx.agents.withInitiator(plugin.ownerAgent, () => execute(operation, signal))
  }

  private ownerTaskIsTerminal(plugin: DynamicCordisPlugin): boolean {
    const tasks = this.rootCtx.get('browserTasks') as { get?: (agent: Agent) => { phase?: unknown } | undefined } | undefined
    if (typeof tasks?.get !== 'function') return false
    try { return tasks.get(plugin.ownerAgent)?.phase === 'terminal' }
    catch { return false }
  }

  private requireGroup(): Fiber {
    this.group ??= this.rootCtx.plugin({ name: 'cordis-dynamic', apply: () => {} })
    return this.group
  }
}

function missingFor(ctx: Context, run: DynamicCordisRun): string[] {
  return run.fiber === undefined ? [] : missingServices(ctx, run.fiber)
}

function confirmedUnmount(result: unknown): boolean {
  if (result === null || typeof result !== 'object') return false
  const receipt = result as {
    outcome?: unknown
    delivery?: unknown
    reason?: unknown
    value?: { unmounted?: unknown; remaining?: unknown }
  }
  return receipt.outcome === 'observed' && receipt.delivery === 'sent'
      && receipt.value?.unmounted === true && receipt.value.remaining === 0
    || receipt.outcome === 'failed' && receipt.delivery === 'sent' && receipt.reason === 'document_replaced'
    || receipt.delivery === 'not-sent' && receipt.reason === 'already_released'
}

function confirmedRegionClear(result: unknown): boolean {
  if (result === null || typeof result !== 'object') return false
  const receipt = result as {
    outcome?: unknown
    delivery?: unknown
    reason?: unknown
    value?: { cleared?: unknown; disposition?: unknown }
  }
  return receipt.outcome === 'observed' && receipt.delivery === 'sent'
      && (receipt.value?.cleared === true || receipt.value?.disposition === 'absent')
    || receipt.outcome === 'failed' && receipt.delivery === 'sent' && receipt.reason === 'document_replaced'
    || receipt.delivery === 'not-sent' && receipt.reason === 'already_released'
}

function cleanupConfirmed(kind: BrowserCleanupKind, result: unknown): boolean {
  return kind === 'entry_unmount' ? confirmedUnmount(result) : confirmedRegionClear(result)
}

function definitelyNotSent(result: unknown): boolean {
  return result !== null && typeof result === 'object'
    && (result as { delivery?: unknown }).delivery === 'not-sent'
}

const MAX_PLUGIN_STATE_ENTRIES = 32
const MAX_PLUGIN_STATE_BYTES = 64 * 1024

function requiredText(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new Error(`harness.browser ${name} must be a non-empty string of at most ${maximum} characters`)
  }
  return value
}

function optionalText(input: Record<string, unknown>, name: string, maximum: number): Record<string, string> {
  const value = input[name]
  return value === undefined ? {} : { [name]: requiredText(value, name, maximum) }
}

function optionalEnum<const T extends readonly string[]>(
  input: Record<string, unknown>, name: string, values: T,
): Record<string, T[number]> {
  const value = input[name]
  if (value === undefined) return {}
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`harness.browser ${name} must be one of: ${values.join(', ')}`)
  }
  return { [name]: value }
}

function requiredRegionRef(value: unknown): string {
  const ref = requiredText(value, 'regionRef', 36)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(ref)) {
    throw new Error('harness.browser regionRef must be a UUID v4')
  }
  return ref
}

/** Validate the same bounded high-level DTO exposed by the public Browser contract. */
function cloneRegionPresentation(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('harness.browser presentation must be an object')
  const presentation = structuredClone(value as Record<string, unknown>)
  const allowed = ['title', 'summary', 'items', 'facts', 'links', 'footer']
  if (Object.keys(presentation).some(key => !allowed.includes(key))) throw new Error('harness.browser presentation has unsupported fields')
  const scalar = (key: 'title' | 'summary' | 'footer', maximum: number) => {
    if (presentation[key] !== undefined) boundedText(presentation[key], `presentation ${key}`, maximum)
  }
  scalar('title', 128); scalar('summary', 4096); scalar('footer', 4096)
  const array = (key: 'items' | 'facts' | 'links', check: (item: Record<string, unknown>) => void) => {
    const value = presentation[key]
    if (value === undefined) return 0
    if (!Array.isArray(value) || value.length > 128) throw new Error(`harness.browser presentation ${key} must contain at most 128 items`)
    for (const item of value) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error(`harness.browser presentation ${key} item must be an object`)
      check(item as Record<string, unknown>)
    }
    return value.length
  }
  const items = array('items', (item) => { exactPresentationKeys(item, ['title', 'meta', 'link']); boundedText(item.title, 'presentation item title', 512)
    if (item.meta !== undefined) boundedText(item.meta, 'presentation item meta', 512); if (item.link !== undefined) validateHttpUrl(item.link, 'presentation item link') })
  const facts = array('facts', (item) => { exactPresentationKeys(item, ['label', 'value']); boundedText(item.label, 'presentation fact label', 256); boundedText(item.value, 'presentation fact value', 1024) })
  const links = array('links', (item) => { exactPresentationKeys(item, ['text', 'href']); boundedText(item.text, 'presentation link text', 512); validateHttpUrl(item.href, 'presentation link href') })
  const count = Number(presentation.title !== undefined)
    + Number(presentation.summary !== undefined)
    + Number(presentation.footer !== undefined)
    + items + facts + links
  if (count === 0 || count > 200) throw new Error('harness.browser presentation must compile to 1 to 200 blocks')
  return presentation
}

function exactPresentationKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('harness.browser presentation item has unsupported fields')
}

function validateHttpUrl(value: unknown, name: string): void {
  const text = boundedText(value, name, 8192)
  let url: URL
  try { url = new URL(text) } catch { throw new Error(`harness.browser ${name} must be an http or https URL`) }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`harness.browser ${name} must be an http or https URL`)
}

function boundedText(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) {
    throw new Error(`harness.browser ${name} must be a string of at most ${maximum} characters`)
  }
  return value
}

function requiredNonnegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`harness.browser ${name} must be a non-negative integer`)
  }
  return value
}

function httpUrl(value: unknown, name: string): string {
  const text = boundedText(value, name, 8192)
  let url: URL
  try { url = new URL(text) } catch { throw new Error(`harness.browser ${name} must be an http or https URL`) }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`harness.browser ${name} must be an http or https URL`)
  return text
}

function pluginStateFacade(plugin: DynamicCordisPlugin): object {
  const key = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/u.test(value)) {
      throw new Error('harness.state key must start with lowercase ASCII and contain at most 64 lowercase letters, digits, dots, underscores, or hyphens')
    }
    return value
  }
  const cloneJson = (value: unknown): JsonValue => {
    let encoded: string | undefined
    try { encoded = JSON.stringify(value) } catch { /* handled below */ }
    if (encoded === undefined) throw new Error('harness.state accepts JSON values only')
    return JSON.parse(encoded) as JsonValue
  }
  const totalBytes = (next: Map<string, JsonValue>): number => Buffer.byteLength(JSON.stringify([...next]))
  return Object.freeze({
    get: (rawKey: unknown): JsonValue | undefined => {
      const value = plugin.state.get(key(rawKey))
      return value === undefined ? undefined : structuredClone(value)
    },
    set: (rawKey: unknown, rawValue: unknown): void => {
      const stateKey = key(rawKey)
      const value = cloneJson(rawValue)
      const next = new Map(plugin.state)
      next.set(stateKey, value)
      if (next.size > MAX_PLUGIN_STATE_ENTRIES || totalBytes(next) > MAX_PLUGIN_STATE_BYTES) {
        throw new Error(`harness.state exceeds ${MAX_PLUGIN_STATE_ENTRIES} entries or ${MAX_PLUGIN_STATE_BYTES} bytes`)
      }
      plugin.state.set(stateKey, value)
    },
    delete: (rawKey: unknown): boolean => plugin.state.delete(key(rawKey)),
  })
}

function missingPluginMessage(id: CordisDynamicPluginId): string {
  return `no dynamic plugin "${id}" in this process — it may have been removed or lost on DSH restart`
}

function errorDetails(error: unknown): CordisErrorDetails {
  if (typeof error !== 'object' || error === null) return { message: String(error) }
  const message = 'message' in error && typeof error.message === 'string'
    ? error.message
    : Object.prototype.toString.call(error)
  const stack = 'stack' in error && typeof error.stack === 'string' ? error.stack : undefined
  return { message, ...stack === undefined ? {} : { stack } }
}

function formatErrorDetails(failure: CordisErrorDetails): string {
  return `message: ${failure.message}`
    + (failure.stack === undefined ? '' : `\nstack:\n${failure.stack}`)
}

function cloneAttempt(attempt: DynamicCordisRunAttempt): DynamicCordisRunAttempt {
  return {
    ...attempt,
    host: { ...attempt.host, waitingFor: [...attempt.host.waitingFor] },
    client: { ...attempt.client, waitingFor: [...attempt.client.waitingFor] },
    ...attempt.error === undefined ? {} : { error: { ...attempt.error } },
  }
}

export default DynamicCordisRunnerService

/**
 * Owned runtime-fact registry with synchronous baseline projection and
 * explicit asynchronous inspection.
 *
 * @module @changanhua/dsh-runtime-facts
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isVisibleRuntimeFact } from './visible.ts'
import type {
  RuntimeFact,
  RuntimeFactContext,
  RuntimeFactInfo,
  RuntimeFactKey,
  RuntimeFactObservationResult,
  RuntimeFactValue,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    runtimeFacts: RuntimeFacts
  }
}

/** Runtime fact projection configuration. */
export interface Config {
  /** Include baseline facts in the dynamic runtime-context snapshot. */
  includeInRuntimeContext?: boolean
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  includeInRuntimeContext: z.boolean().default(true),
})

const FACT_KEY_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/

/**
 * Validate and brand a runtime fact key.
 * @param value - dotted lowercase kebab-case fact name.
 * @returns the validated branded key.
 * @throws when any segment is empty, uppercase, or not lowercase kebab-case.
 */
export function factKey(value: string): RuntimeFactKey {
  if (!FACT_KEY_PATTERN.test(value)) {
    throw new TypeError(`runtime fact key ${JSON.stringify(value)} must match ${String(FACT_KEY_PATTERN)}`)
  }
  return value as RuntimeFactKey
}

function cloneFact(fact: RuntimeFact): RuntimeFact {
  return Object.freeze({
    ...fact,
    ...fact.relevance === undefined
      ? {}
      : { relevance: Object.freeze({ tools: Object.freeze([...fact.relevance.tools]) }) },
  })
}

function infoOf(fact: RuntimeFact): RuntimeFactInfo {
  return {
    key: fact.key,
    owner: fact.owner,
    description: fact.description,
    evaluation: fact.evaluation,
    freshness: fact.freshness,
    exposure: fact.exposure,
    ...fact.relevance === undefined
      ? {}
      : { relevance: { tools: [...fact.relevance.tools] } },
  }
}

function validateFact(fact: RuntimeFact): void {
  factKey(fact.key)
  if (fact.owner.length === 0 || fact.owner.trim() !== fact.owner) {
    throw new TypeError(`runtime fact "${fact.key}" owner must be non-blank and have no surrounding whitespace`)
  }
  if (fact.description.length === 0 || fact.description.trim() !== fact.description) {
    throw new TypeError(`runtime fact "${fact.key}" description must be non-blank and have no surrounding whitespace`)
  }
  if (fact.evaluation === 'sync') {
    if (fact.resolveSync === undefined || fact.resolveAsync !== undefined) {
      throw new TypeError(`runtime fact "${fact.key}" with evaluation "sync" must declare only resolveSync`)
    }
  } else if (fact.resolveAsync === undefined || fact.resolveSync !== undefined) {
    throw new TypeError(`runtime fact "${fact.key}" with evaluation "async" must declare only resolveAsync`)
  }
  if (fact.exposure === 'baseline' && fact.evaluation !== 'sync') {
    throw new TypeError(`runtime fact "${fact.key}" with exposure "baseline" must use synchronous evaluation`)
  }
  const tools = fact.relevance?.tools
  if (tools === undefined) return
  if (tools.length === 0) {
    throw new TypeError(`runtime fact "${fact.key}" relevance.tools must not be empty`)
  }
  const seen = new Set<string>()
  for (const tool of tools) {
    if (!TOOL_NAME_PATTERN.test(tool)) {
      throw new TypeError(`runtime fact "${fact.key}" relevance tool ${JSON.stringify(tool)} must match ${String(TOOL_NAME_PATTERN)}`)
    }
    if (seen.has(tool)) {
      throw new TypeError(`runtime fact "${fact.key}" relevance lists tool ${JSON.stringify(tool)} more than once`)
    }
    seen.add(tool)
  }
}

function observation(value: RuntimeFactValue | undefined): RuntimeFactObservationResult {
  if (value === undefined) return { status: 'unavailable' }
  if (typeof value === 'string') {
    if (value.includes('\n') || value.includes('\r')) return { status: 'unavailable' }
    return { status: 'ok', value }
  }
  if (typeof value === 'boolean') return { status: 'ok', value }
  if (typeof value === 'number' && Number.isFinite(value)) return { status: 'ok', value }
  return { status: 'unavailable' }
}

/** Registry for uniquely owned runtime facts. */
export class RuntimeFacts extends Service {
  static inject = ['systemPrompt']
  static Config = Config

  private readonly facts = new Map<RuntimeFactKey, RuntimeFact>()
  private readonly staticObservations = new Map<RuntimeFactKey, RuntimeFactObservationResult>()
  private readonly pendingStaticObservations = new Map<RuntimeFactKey, Promise<RuntimeFactObservationResult>>()
  private readonly includeInRuntimeContext: boolean
  private readonly ownerCtx: Context

  /**
   * Create the registry and contribute its ordered runtime-context snapshot.
   * @param ctx - service owner and prompt registry context.
   * @param config - automatic projection configuration.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'runtimeFacts')
    this.ownerCtx = ctx
    this.includeInRuntimeContext = config.includeInRuntimeContext ?? true
    ctx.systemPrompt.context({
      name: 'runtime-facts',
      order: 120,
      text: context => this.render({
        ...context.scope === undefined ? {} : { scope: context.scope },
        ...context.signal === undefined ? {} : { signal: context.signal },
      }),
    })
  }

  /**
   * Register one uniquely owned fact for the calling plugin fiber.
   * @param declaration - resolver, ownership, projection, and freshness declaration.
   * @returns the exact effect disposer that removes the fact and its cached observation.
   * @throws when the declaration is malformed or its key already has an owner.
   */
  registerFact(declaration: RuntimeFact): () => Promise<void> {
    validateFact(declaration)
    const existing = this.facts.get(declaration.key)
    if (existing !== undefined) {
      throw new Error(
        `runtime fact "${declaration.key}" is already owned by "${existing.owner}"; `
        + `"${declaration.owner}" cannot also own it`,
      )
    }
    const fact = cloneFact(declaration)
    const initial = fact.evaluation === 'sync' && fact.freshness === 'static'
      ? this.observeSync(fact, {})
      : undefined
    return this.ctx.effect(() => {
      const race = this.facts.get(fact.key)
      if (race !== undefined) {
        throw new Error(
          `runtime fact "${fact.key}" is already owned by "${race.owner}"; `
          + `"${fact.owner}" cannot also own it`,
        )
      }
      this.facts.set(fact.key, fact)
      if (initial !== undefined) this.staticObservations.set(fact.key, initial)
      return () => {
        this.facts.delete(fact.key)
        this.staticObservations.delete(fact.key)
        this.pendingStaticObservations.delete(fact.key)
      }
    }, `runtimeFacts.registerFact(${JSON.stringify(fact.key)})`)
  }

  /**
   * List resolver-free fact declarations in code-unit key order.
   * @returns detached metadata that callers may not use to mutate a registration.
   */
  list(): RuntimeFactInfo[] {
    return [...this.facts.values()]
      .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
      .map(infoOf)
  }

  /**
   * Observe selected facts, awaiting asynchronous resolvers while containing each failure.
   * @param keys - valid fact keys; an unregistered key produces `unknown`.
   * @param context - optional scope and cancellation signal.
   * @returns one observation per requested key.
   */
  async inspect(
    keys: readonly RuntimeFactKey[],
    context: RuntimeFactContext = {},
  ): Promise<Record<string, RuntimeFactObservationResult>> {
    const entries = await Promise.all(keys.map(async (key): Promise<[string, RuntimeFactObservationResult]> => {
      const fact = this.facts.get(key)
      if (fact === undefined) return [key, { status: 'unknown' }]
      return [key, await this.observe(fact, context)]
    }))
    return Object.fromEntries(entries)
  }

  /**
   * Render available synchronous baseline facts in code-unit key order.
   * @param context - scope used for centralized tool-relevance filtering.
   * @returns the complete compact snapshot, or an empty string when none is active.
   */
  render(context: RuntimeFactContext): string {
    if (!this.includeInRuntimeContext) return ''
    const lines: string[] = []
    for (const fact of [...this.facts.values()]
      .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)) {
      if (fact.evaluation !== 'sync'
        || fact.exposure !== 'baseline'
        || !isVisibleRuntimeFact(this.ownerCtx, context, fact.relevance)) continue
      const result = fact.freshness === 'static'
        ? this.staticObservations.get(fact.key) ?? { status: 'unavailable' }
        : this.observeSync(fact, context)
      if (result.status === 'ok') lines.push(`- ${fact.key}: ${String(result.value)}`)
    }
    return lines.length === 0 ? '' : ['Host runtime facts:', ...lines].join('\n')
  }

  private observeSync(fact: RuntimeFact, context: RuntimeFactContext): RuntimeFactObservationResult {
    try {
      return observation(fact.resolveSync?.(context))
    } catch (error: unknown) {
      this.ownerCtx.logger.warn(
        `runtime fact "${fact.key}" owned by "${fact.owner}" failed synchronous evaluation`,
        error,
      )
      return { status: 'unavailable' }
    }
  }

  private async observe(
    fact: RuntimeFact,
    context: RuntimeFactContext,
  ): Promise<RuntimeFactObservationResult> {
    if (fact.evaluation === 'sync') {
      if (fact.freshness === 'static') {
        return this.staticObservations.get(fact.key) ?? { status: 'unavailable' }
      }
      return this.observeSync(fact, context)
    }

    // A static async observation is global only when no caller-specific scope
    // or cancellation authority participates. Scoped/cancellable inspections
    // probe independently so one caller cannot poison or cancel another's
    // registration-lifetime cache.
    const cacheableStatic = fact.freshness === 'static'
      && context.scope === undefined
      && context.signal === undefined
    if (!cacheableStatic) return await this.observeAsync(fact, context)

    const cached = this.staticObservations.get(fact.key)
    if (cached !== undefined) return cached
    const existing = this.pendingStaticObservations.get(fact.key)
    if (existing !== undefined) return await existing

    const pending = this.observeAsync(fact, {})
    this.pendingStaticObservations.set(fact.key, pending)
    try {
      const result = await pending
      // Transient probe failures are never registration-lifetime facts. A
      // later inspection must be allowed to recover; stable ok/unavailable
      // observations may be reused for the registration lifetime.
      if (result.status !== 'probe-failure' && this.facts.get(fact.key) === fact) {
        this.staticObservations.set(fact.key, result)
      }
      return result
    } finally {
      this.pendingStaticObservations.delete(fact.key)
    }
  }

  private async observeAsync(
    fact: RuntimeFact,
    context: RuntimeFactContext,
  ): Promise<RuntimeFactObservationResult> {
    if (isAborted(context.signal)) return { status: 'probe-failure', reason: 'aborted' }
    try {
      const value = await fact.resolveAsync?.(context, context.signal)
      if (isAborted(context.signal)) return { status: 'probe-failure', reason: 'aborted' }
      return observation(value)
    } catch (error: unknown) {
      this.ownerCtx.logger.warn(
        `runtime fact "${fact.key}" owned by "${fact.owner}" failed asynchronous evaluation`,
        error,
      )
      return {
        status: 'probe-failure',
        reason: isAborted(context.signal) ? 'aborted' : 'probe failed',
      }
    }
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false
}

export default RuntimeFacts

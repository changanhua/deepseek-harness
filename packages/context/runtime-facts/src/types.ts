/** Public runtime-fact declarations and observation results. @module @changanhua/dsh-runtime-facts/src/types */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'

/** A dotted lowercase kebab-case runtime fact name. */
export type RuntimeFactKey = Branded<'RuntimeFactKey'>

/** Whether a fact resolver completes synchronously or asynchronously. */
export type RuntimeFactEvaluation = 'sync' | 'async'

/** Whether one observation may be reused for the registration lifetime. */
export type RuntimeFactFreshness = 'static' | 'dynamic'

/** Whether a fact may enter automatic context or only explicit inspection. */
export type RuntimeFactExposure = 'baseline' | 'inspect'

/** Secret-free scalar value carried by a runtime fact. */
export type RuntimeFactValue = string | boolean | number

/** Result of observing one runtime fact. */
export type RuntimeFactObservationResult<T extends RuntimeFactValue = RuntimeFactValue> =
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'unknown' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'probe-failure'; readonly reason?: string }

/** Per-observation scope and cancellation input. */
export interface RuntimeFactContext {
  readonly scope?: ScopeKey
  readonly signal?: AbortSignal
}

/** Tool visibility required before a baseline fact is projected. */
export interface RuntimeFactRelevance {
  readonly tools: readonly string[]
}

/** One owned runtime fact declaration. */
export interface RuntimeFact {
  readonly key: RuntimeFactKey
  readonly owner: string
  readonly description: string
  readonly evaluation: RuntimeFactEvaluation
  readonly freshness: RuntimeFactFreshness
  readonly exposure: RuntimeFactExposure
  readonly relevance?: RuntimeFactRelevance
  readonly resolveSync?: (context: RuntimeFactContext) => RuntimeFactValue | undefined
  readonly resolveAsync?: (
    context: RuntimeFactContext,
    signal?: AbortSignal,
  ) => Promise<RuntimeFactValue | undefined>
}

/** Resolver-free metadata returned by the registry. */
export interface RuntimeFactInfo {
  readonly key: RuntimeFactKey
  readonly owner: string
  readonly description: string
  readonly evaluation: RuntimeFactEvaluation
  readonly freshness: RuntimeFactFreshness
  readonly exposure: RuntimeFactExposure
  readonly relevance?: RuntimeFactRelevance
}

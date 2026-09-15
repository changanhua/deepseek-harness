/**
 * The composite adapter behind one relay route: it advertises the modalities a
 * text-only model cannot accept on its own, derives visual evidence through a
 * separate vision model, and then dispatches the revised request to the
 * declared target route.
 *
 * The target model keeps its honest capability declaration — only the composite
 * route claims image input, and it can only claim it because this adapter really
 * does remove every image before the target sees the request.
 * @module @deepseek-ai/dsh-llm-vision-relay/adapter
 */

import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelContext,
  LlmModelReasoningInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { relayMessages } from './evidence.ts'
import type { EvidenceDeriver, EvidenceRecipe } from './evidence.ts'

/** One relay route: the composite id and the text-only route it dispatches to. */
export interface RelayTarget {
  /** Target route that ultimately answers the request. */
  readonly provider: string
  /** Exact target model id. */
  readonly model: string
  /** Optional display name for the composite model entry. */
  readonly name?: string
}

/**
 * The request controls a caller may set, and the only ones a target route's
 * resolved header may differ over: provider routing is the relay's own decision,
 * while these are the caller's preferences that the target may or may not honour.
 */
export type RelayPreferences = Pick<
  GenerateOptions,
  'reasoningEffort' | 'temperature' | 'maxTokens' | 'stop'
>

/** One composite route whose declared target could not be resolved to a model. */
export interface TargetUnavailable {
  /** Composite model id that stays listed despite the failure. */
  readonly route: string
  /** Declared target provider. */
  readonly provider: string
  /** Declared target model. */
  readonly model: string
  /** What resolving the target reported. */
  readonly reason: unknown
}

/** Construction facts for {@link VisionRelayAdapter}. */
export interface VisionRelayAdapterOptions {
  /** Every composite model id this adapter owns, mapped to its target. */
  readonly targets: ReadonlyMap<string, RelayTarget>
  /** Derives visual evidence and rewrites messages before dispatch. */
  readonly deriver: EvidenceDeriver
  /** Recipe applied to every derivation this adapter performs. */
  readonly recipe: EvidenceRecipe
  /**
   * Prepares the target's own call handle. `preferences` are the caller's
   * request controls, offered to the target so its own resolution decides which
   * of them it can honour, and `config` is what that resolution settled on —
   * the only header its prepared call accepts.
   */
  readonly prepareTarget: (
    target: { provider: string; model: string },
    signal: AbortSignal | undefined,
    preferences: RelayPreferences,
  ) => Promise<{
    config: RelayPreferences & { provider: string; model: string }
    stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>
  }>
  /** Resolves a target route's own metadata, used to inherit its capacities. */
  readonly resolveTargetInfo: (provider: string, model: string, signal?: AbortSignal) => Promise<LlmResolvedModelInfo>
  /**
   * Reports a target route that could not be resolved. One unusable target must
   * not hide its siblings from a selector, so the composite route stays listed
   * and the failure is named here rather than only at call time.
   */
  readonly onTargetUnavailable?: (failure: TargetUnavailable) => void
}

/**
 * A composite route that accepts images by deriving evidence first.
 *
 * `resolveModel` answers with the composite identity plus the target's
 * capacity facts, so a selector shows the target's context window and reasoning
 * levels while the route honestly claims image input.
 */
export class VisionRelayAdapter extends LlmAdapter {
  readonly #options: VisionRelayAdapterOptions
  #targets: ReadonlyMap<string, RelayTarget>
  #recipe: EvidenceRecipe

  constructor(options: VisionRelayAdapterOptions) {
    super()
    this.#options = options
    this.#targets = options.targets
    this.#recipe = options.recipe
  }

  /**
   * Replace the owned composite routes after a settings change.
   * @param targets - the complete next route set.
   */
  setTargets(targets: ReadonlyMap<string, RelayTarget>): void {
    this.#targets = targets
  }

  /**
   * The registry reads provider metadata while it validates a registration,
   * before new targets are installed, so this answer deliberately reads no
   * target state: the provider is a fixed fact of the plugin.
   */
  override providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: 'Vision Relay' }
  }

  /**
   * Every configured composite route, offered as a model of this one provider.
   * A route the settings section dropped is simply absent, which is what makes
   * an empty section offer no model to any picker.
   */
  override listModels(provider: string): Promise<readonly { provider: string; id: string; name: string; inputModalities: readonly ('text' | 'image')[] }[]> {
    const models = [...this.#targets.entries()].map(([id, target]) => ({
      provider,
      id,
      name: target.name ?? `${target.model} + vision relay`,
      inputModalities: ['text', 'image'] as const,
    }))
    return Promise.resolve(models)
  }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const target = this.#targets.get(model)
    if (target === undefined) {
      // An unlisted id is still dispatchable: fall back to the route's own name.
      return { provider, id: model, name: model, inputModalities: ['text', 'image'] }
    }
    let inherited: LlmResolvedModelInfo
    try {
      inherited = await this.#options.resolveTargetInfo(target.provider, target.model, signal)
    } catch (reason) {
      // Cancellation is not a configuration fact: let it propagate untouched.
      if (signal?.aborted === true) throw reason
      this.#options.onTargetUnavailable?.({
        route: model,
        provider: target.provider,
        model: target.model,
        reason,
      })
      // Listed without the target's capacities, so a selector still offers every
      // other route this provider owns; only a call reaching this target fails.
      return { provider, id: model, name: target.name ?? model, inputModalities: ['text', 'image'] }
    }
    const context: LlmModelContext | undefined = inherited.context
    const reasoning: LlmModelReasoningInfo | undefined = inherited.reasoning
    return {
      provider,
      id: model,
      name: target.name ?? `${inherited.name} + vision relay`,
      ...inherited.description === undefined ? {} : { description: inherited.description },
      ...context === undefined ? {} : { context },
      ...inherited.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: inherited.defaultMaxTokens },
      ...reasoning === undefined ? {} : { reasoning },
      // The composite route, not the target, is what accepts images.
      inputModalities: ['text', 'image'],
    }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const target = this.#targets.get(options.model)
    if (target === undefined) {
      throw new Error(
        `llm-vision-relay: unknown relay model "${options.model}"; declare it under routes in the llm-vision-relay settings section`,
      )
    }
    const messages = await relayMessages(
      options.messages,
      this.#options.deriver,
      this.#recipe,
      options.signal,
      options.sessionId,
    )
    // Only the request controls travel to the target: its own resolution decides
    // which of them it can honour, and the header it settles on is the only one
    // its prepared call accepts. Passing the composite route's header through
    // instead would be rejected as a changed config before dispatch.
    const preferences: RelayPreferences = {
      ...options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort },
      ...options.temperature === undefined ? {} : { temperature: options.temperature },
      ...options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
      ...options.stop === undefined ? {} : { stop: options.stop },
    }
    const prepared = await this.#options.prepareTarget(
      { provider: target.provider, model: target.model },
      options.signal,
      preferences,
    )
    yield* prepared.stream({ ...options, ...prepared.config, messages })
  }
}

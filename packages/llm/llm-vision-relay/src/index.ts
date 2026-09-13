/**
 * Register composite vision-relay routes on `ctx.llm`: each route advertises
 * image input because it genuinely removes images, deriving attributable text
 * evidence through a separate vision model before dispatching the request to
 * the declared text-only target.
 *
 * The target keeps its honest capability declaration. Only the composite route
 * claims `image`, and every image is replaced before the target adapter runs —
 * a relay must never forward an image to a route that cannot read it.
 *
 * The row mounts dormant: with no settings section it registers nothing, holds
 * no route, and adds no model to any picker. A `llm-vision-relay:` section in
 * the user settings document is what brings the composite routes into being,
 * and emptying that section takes them away again.
 * @module @deepseek-ai/dsh-llm-vision-relay
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage, LlmError } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { VisionRelayAdapter } from './adapter.ts'
import type { RelayTarget } from './adapter.ts'
import { CANONICAL_EVIDENCE, collectText } from './evidence.ts'
import type { EvidenceDeriver, EvidenceEntry, EvidenceRequest } from './evidence.ts'

export const name = 'llm-vision-relay'
export const inject = ['llm']

const NS = settingsNamespace('llm-vision-relay')
/** The one provider every composite route is served under. */
const RELAY_PROVIDER = 'vision-relay'
/** Bound so one pathological image cannot consume an unbounded relay budget. */
const MAX_EVIDENCE_CHARS = 8000

/** One relay vision route: the model that reads images on behalf of a target. */
export interface RelayModelConfig {
  /** Provider route serving the vision model. */
  provider: string
  /** Exact vision model id. */
  model: string
}

/** One composite route. The settings key is the model id it is selected by. */
export interface RelayRouteConfig {
  /** Display name; absent means the target model name plus the relay suffix. */
  name?: string
  /** Text-only route that ultimately answers. */
  target: RelayModelConfig
}

/** The whole settings section. */
export interface RelaySettings {
  /** Vision model every route derives evidence through. */
  relay?: RelayModelConfig | null
  /** Composite routes this plugin owns, keyed by the model id each offers. */
  routes: Record<string, RelayRouteConfig>
}

const RelayModelSchema: z<RelayModelConfig> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
})

const RelayRouteSchema: z<RelayRouteConfig> = z.object({
  name: z.string(),
  target: RelayModelSchema.required(),
})

export const Config: z<RelaySettings> = z.object({
  // Nullable rather than a bare optional: schemastery resolves an absent
  // `z.object()` against `{}`, which would demand the fields required inside a
  // relay the section never declared and make an empty section invalid. The
  // null default keeps the dormant posture — no relay, no routes — legal while
  // still rejecting a relay that is declared only halfway.
  relay: z.union([RelayModelSchema, z.const(null)]).default(null),
  routes: z.dict(RelayRouteSchema).default({}),
})

/**
 * Register composite vision-relay routes for the configured targets.
 * @param ctx - the plugin context, which owns the route registrations.
 * @param config - the resolved configuration source.
 */
export function apply(ctx: Context, config: RelaySettings): void {
  // The composition entry is read before any settings section attaches, so it
  // is normalized here rather than trusted to carry the schema's defaults.
  let current: RelaySettings = { relay: config.relay ?? null, routes: config.routes ?? {} }
  const options = (): RelaySettings => current

  // Evidence is keyed by image, relay model, and recipe, so a repeat of the same
  // image under a new question reuses one derivation instead of paying again.
  const cache = new Map<string, EvidenceEntry>()

  const derive: EvidenceDeriver = async (request: EvidenceRequest): Promise<EvidenceEntry[]> => {
    const relay = options().relay
    if (relay === undefined || relay === null) {
      // A request can only reach here on a registered route, and no route
      // registers without a relay model; the diagnostic keeps a section edited
      // out from under a live route diagnosable instead of an undefined read.
      throw new LlmError(
        'llm-vision-relay: the settings section declares no relay model to derive evidence with',
        'RELAY_UNCONFIGURED',
      )
    }

    const keyOf = (attachmentId: string): string =>
      `${attachmentId}\u0000${relay.provider}\u0000${relay.model}\u0000${request.recipe.id}`

    const ordered: EvidenceEntry[] = []
    const misses: { key: string; image: (typeof request.images)[number] }[] = []
    for (const image of request.images) {
      const key = keyOf(String(image.attachmentId))
      const hit = cache.get(key)
      if (hit !== undefined) {
        ordered.push(hit)
        continue
      }
      // One placeholder per miss keeps positions aligned with request.images.
      ordered.push(blankEntry(relay, request.recipe.id))
      misses.push({ key, image })
    }
    if (misses.length === 0) return ordered

    // One relay call carries every uncached image: the vision model transcribes
    // them together rather than paying one request per image.
    const content: Message['content'] = [
      {
        type: 'text',
        text: [
          request.recipe.prompt,
          misses.length > 1
            ? `There are ${misses.length} images below; transcribe each one separately, in order, under a "image N:" heading.`
            : '',
        ].filter(line => line.length > 0).join('\n'),
      },
      ...misses.map(miss => ({ type: 'image' as const, attachment: miss.image })),
    ]
    const transcript = await runRelay(ctx, relay, content, request)
    const parts = misses.length > 1 ? splitTranscripts(transcript, misses.length) : [transcript]
    misses.forEach((miss, index) => {
      const fresh: EvidenceEntry = {
        transcript: (parts[index] ?? '').slice(0, MAX_EVIDENCE_CHARS),
        relayProvider: relay.provider,
        relayModel: relay.model,
        recipe: request.recipe.id,
      }
      cache.set(miss.key, fresh)
    })
    // Fill the placeholders with what the batch produced.
    let cursor = 0
    for (let index = 0; index < ordered.length; index++) {
      const existing = ordered[index]
      if (existing !== undefined && existing.transcript.length === 0) {
        const miss = misses[cursor]
        if (miss !== undefined) {
          ordered[index] = cache.get(miss.key) ?? existing
          cursor += 1
        }
      }
    }
    return ordered
  }

  // One warning per unusable route per configuration: a selector may resolve
  // every model on each refresh, and a repeated log would bury the first one.
  const warnedTargets = new Set<string>()

  const adapter = new VisionRelayAdapter({
    targets: new Map(),
    deriver: derive,
    recipe: CANONICAL_EVIDENCE,
    prepareTarget: async (target, signal, preferences) => {
      try {
        return await ctx.llm.prepareCall(
          { provider: target.provider, model: target.model, ...preferences },
          signal,
        )
      } catch (error) {
        // A preference is not a demand: a target that rejects the caller's
        // reasoning effort must still answer, on the effort it does support,
        // rather than failing the turn that the relay exists to serve.
        if (Object.keys(preferences).length === 0 || (error as { code?: unknown }).code !== 'UNSUPPORTED_REASONING_EFFORT') {
          throw error
        }
        ctx.logger.warn(
          `llm-vision-relay: target "${target.provider}/${target.model}" does not support the requested`
          + ' reasoning effort; this turn uses the target\'s own default',
        )
        return ctx.llm.prepareCall({ provider: target.provider, model: target.model }, signal)
      }
    },
    resolveTargetInfo: (provider, model, signal) => ctx.llm.resolveModelInfo(provider, model, signal),
    onTargetUnavailable: (failure) => {
      if (warnedTargets.has(failure.route)) return
      warnedTargets.add(failure.route)
      ctx.logger.warn(
        `llm-vision-relay: route "${failure.route}" declares target "${failure.provider}/${failure.model}",`
        + ' which its adapter cannot resolve; the route stays listed, and a call to it fails',
      )
      ctx.logger.warn(failure.reason)
    },
  })

  // One provider serves every composite route; the route id is the model id.
  // The directory entry is fixed, so a configuration surface can offer this
  // provider before any route exists.
  ctx.llm.registerConfigurableProviders([{
    provider: RELAY_PROVIDER,
    displayName: 'Vision Relay',
    settingsNs: NS,
    settingsPath: [],
    declared: true,
  }])

  // The registration starts absent: the dormant posture is a row that mounts,
  // contributes no route, and holds nothing to release.
  let registration: AdapterRegistrationHandle | undefined
  let applied: string | undefined

  const reconcile = (): void => {
    const resolved = options()
    const targets = new Map<string, RelayTarget>()
    for (const [id, route] of Object.entries(resolved.routes)) {
      if (id.length === 0) continue
      // A relay whose target is itself would recurse without ever reaching a model.
      if (route.target.provider === RELAY_PROVIDER) {
        throw new LlmError(
          `llm-vision-relay: route "${id}" targets the relay provider itself; a relay target must be a non-relay route`,
          'RELAY_CYCLE',
        )
      }
      targets.set(id, {
        provider: route.target.provider,
        model: route.target.model,
        name: route.name ?? `${route.target.model} + vision relay`,
      })
    }

    // Everything above is pure, so a refused section changes nothing below.
    const fact = JSON.stringify({ relay: resolved.relay, routes: [...targets.entries()] })
    if (fact === applied) return

    // The provider set never changes, so this registration is a one-time fact
    // and a `replace` here only announces the new model catalog to the pickers
    // that observe `llm/adapters-updated`.
    if (registration === undefined) {
      // Dormant bare mount: nothing registers until a section supplies routes.
      if (targets.size > 0) registration = ctx.llm.registerAdapter([RELAY_PROVIDER], adapter)
    } else {
      registration.replace([RELAY_PROVIDER])
    }
    // The adapter answers `listModels` and `stream` from this map, and the
    // registration now holds the routing that maps onto it.
    adapter.setTargets(targets)
    // A changed route set may have repaired a target that was unusable before,
    // so the next failure for any route is worth reporting again.
    warnedTargets.clear()
    applied = fact
  }

  /**
   * Apply the current section, keeping the previous routes on a refusal. The
   * settings write is stored either way, so a section the registry rejects must
   * not take working routes down with it — and without this containment the
   * refusal would only reach the operator as a generic watcher failure.
   */
  const guarded = (): void => {
    try {
      reconcile()
    } catch (error) {
      ctx.logger.error('llm-vision-relay: keeping the previously registered routes after a refused update')
      ctx.logger.error(error)
    }
  }

  // The composition entry is authoritative until a settings section attaches,
  // and installSettingsSection never runs without a settings service — so the
  // first application is owned here rather than left to the settings seam.
  guarded()
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      const resolved = source()
      current = { relay: resolved.relay ?? null, routes: resolved.routes ?? {} }
    },
    onChange: guarded,
  })
}

/** A placeholder entry for an image whose transcript could not be obtained. */
function blankEntry(relay: { provider: string; model: string }, recipe: string): EvidenceEntry {
  return { transcript: '', relayProvider: relay.provider, relayModel: relay.model, recipe }
}

/**
 * Split one multi-image transcript back into per-image parts.
 * @param transcript - the relay model's combined output.
 * @param count - how many images it covered.
 * @returns one part per image; a transcript that did not follow the heading
 *   convention yields the whole text for the first image and empty parts after.
 */
function splitTranscripts(transcript: string, count: number): string[] {
  const parts = transcript.split(/^\s*image\s+\d+\s*:/imu)
  const body = parts.length > 1 ? parts.slice(1) : [transcript]
  const out: string[] = []
  for (let index = 0; index < count; index++) out.push((body[index] ?? '').trim())
  return out
}

/**
 * Run one relay call and collect its text.
 * @param ctx - plugin context owning the `llm` service.
 * @param relay - relay route to call.
 * @param content - the message blocks carrying the instruction and images.
 * @param request - originating evidence request, for cancellation and session.
 * @returns the relay model's text.
 */
async function runRelay(
  ctx: Context,
  relay: { provider: string; model: string },
  content: Message['content'],
  request: EvidenceRequest,
): Promise<string> {
  const prepared = await ctx.llm.prepareCall(
    { provider: relay.provider, model: relay.model },
    request.signal,
  )
  const options: GenerateOptions = {
    ...prepared.config,
    messages: [createUserMessage({ content, source: { kind: 'user' } })],
    ...request.sessionId === undefined ? {} : { sessionId: request.sessionId },
    ...request.signal === undefined ? {} : { signal: request.signal },
  }
  return collectText(prepared.stream(options))
}

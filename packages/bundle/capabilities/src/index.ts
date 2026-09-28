/**
 * The capability-host bundle's closed preset roster.
 *
 * The bundle owns the absolute location of its two preset directories. Keeping
 * that path here lets an installed package discover its assets without relying
 * on the current working directory or a user-writable preset root.
 * @module @changanhua/dsh-capabilities
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import AgentPresets, { type Config as AgentPresetsConfig } from '@deepseek-ai/dsh-agent-presets'

/** Preset configuration is validated against the fixed bundle roster at construction. */
export type Config = AgentPresetsConfig

/** Bundle-owned, read-only preset directory resolved in source and built layouts. */
export const CAPABILITY_PRESET_ROOT = fileURLToPath(new URL('../presets/', import.meta.url))

const PRESET_CONFIG: Config = {
  default: 'choice',
  roots: [{ path: CAPABILITY_PRESET_ROOT, trust: 'system' }],
  includeShippedRoot: false,
  includeUserRoot: false,
}

/** Agent preset registry restricted to this bundle's lazy capability presets. */
export default class CapabilityPresets extends AgentPresets {
  constructor(ctx: Context, config: Config) {
    super(ctx, PRESET_CONFIG)
    if (config.default !== PRESET_CONFIG.default
      || config.roots.length !== 0
      ||  config.includeShippedRoot
      ||  config.includeUserRoot) {
      throw new Error('dsh-capabilities accepts only its bundle-owned preset roster')
    }
  }
}

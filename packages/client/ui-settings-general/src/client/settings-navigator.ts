/**
 * The settings shell's implementation of the `settingsNavigator` contract
 * declared by ui-settings. The shell owns the panel's open/active state, so
 * this service is the only channel a feature controller (like
 * ui-settings-skills) uses to command SettingsRoot from outside the shell's
 * React tree: it broadcasts an `open(id)` intent to the current SettingsRoot,
 * which applies it through the same state mutation a nav click or an
 * onboarding `openSection` uses.
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNavigator } from '@deepseek-ai/dsh-client-ui-settings/client'

/** One SettingsRoot's handler for an external open-intent. */
export type SettingsOpenListener = (id: string) => void

/**
 * Broadcasts section-open intents to the mounted SettingsRoot. Keeping the
 * listener inside the shell component lets the contract stay dependency-free:
 * ui-settings declares the type, this class provides it.
 */
export class SettingsNavigatorService extends Service implements SettingsNavigator {
  private readonly listeners = new Set<SettingsOpenListener>()

  /**
   * Register the service under the `settingsNavigator` Context key.
   * @param ctx - the providing plugin's context.
   */
  constructor(ctx: Context) {
    super(ctx, 'settingsNavigator')
  }

  /** Open the settings panel on one registered section id. */
  open(id: string): void {
    for (const listener of [...this.listeners]) listener(id)
  }

  /**
   * Bind one SettingsRoot to receive open-intents. Only the shell mounts the
   * panel, so exactly one live subscriber is expected per host; a stale
   * component's disposer drops it.
   * @param listener - handler that opens a section on this SettingsRoot.
   * @returns the disposer removing the listener.
   */
  subscribe(listener: SettingsOpenListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

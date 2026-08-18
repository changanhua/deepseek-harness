/**
 * The generic "open one registered Settings section" contract that the
 * settings domain BASE declares and the shell provides. It stays in
 * ui-settings (not the shell) because a feature that owns a section must be
 * able to type its navigation call without depending on any `ui-*`
 * presentation package — exactly the dependency rule that keeps the
 * settings slot types here. The shell (ui-settings-general) supplies the
 * implementation and wires it into SettingsRoot; the value stays absent
 * until that shell mounts, so callers must tolerate an undefined navigate
 * face on a host that forgoes the panel.
 */

/**
 * Drive the existing SettingsRoot to open one registered section. Unknown
 * ids are a no-op at the shell (it falls back to the first row); the caller
 * opens only ids it registered or a sibling registered by a peer.
 */
export interface SettingsNavigator {
  /** Open the settings panel on the named section id. */
  open(id: string): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Present once the settings shell mounts (ui-settings-general); absent
     * before it or when no shell is composed. A feature controller calls
     * `open('skills')` through this face rather than reaching into the
     * shell's React state.
     */
    settingsNavigator: SettingsNavigator
  }
}

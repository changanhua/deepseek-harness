import type { SettingsNavigator } from '@deepseek-ai/dsh-client-ui-settings/client'

/**
 * Route a browser hash to the settings shell without coupling the shell
 * component to browser globals. The navigator retains an intent raised before
 * SettingsRoot mounts, so initial boot and later hash changes share one path.
 */
export function installSettingsDeepLink(navigator: SettingsNavigator, surface: Window): () => void {
  const navigate = (): void => {
    const sectionId = new URLSearchParams(surface.location.hash.slice(1)).get('settings')
    if (sectionId === null || sectionId.length === 0 || sectionId.length > 128) return
    navigator.open(sectionId)
  }
  surface.addEventListener('hashchange', navigate)
  navigate()
  return () => { surface.removeEventListener('hashchange', navigate) }
}

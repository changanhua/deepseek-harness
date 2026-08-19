/**
 * Skills management feature plugin, browser half (§5). It provisions one
 * shared viewing state (the adopted session, §3.4), one apply-private
 * snapshot controller (the `skillManagement.snapshot` remote), and registers
 * the session title-bar Popover (§5.1) and the Settings Skills section (§5.2).
 * The inject face carries only plain callbacks plus the snapshot/adopted
 * hooks compartment; components never see the controller, the ctx, or a
 * hand-made hook. Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the settings section + conversation header action slot
// declarations, the locale Context merge, and the api-remotes forwarded key face.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSkillsSnapshotController } from './skills-snapshot.ts'
import { createSkillsFeatureController } from './skills-feature-store.ts'
import { SkillsSection } from './SkillsSection.tsx'
import { SkillsPopover } from './SkillsPopover.tsx'
import type { SkillsFeatureInjected } from './feature-types.ts'
import { NS, en, zh, type SkillsKey } from './locales.ts'

export type {
  SkillsFeatureInjected, SkillsFeatureHooks, SkillsSectionProps, SkillsPopoverProps,
} from './feature-types.ts'
export type { SkillsSnapshotState } from './skills-snapshot.ts'
export type { SkillsFeatureState } from './skills-feature-store.ts'
export type { SkillsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Skills management feature copy. */
    'settings.skills': SkillsKey
  }
}

/** The section id this feature owns; also the `settingsNavigator.open` target. */
const SKILLS_SECTION_ID = 'skills'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * ui-settings and ui-conversation; their activation order relative to this
 * one is NOT constrained, so registrations depend on each slot through
 * `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the Skills section and the header Popover once their slot
 * declarations are on the ledger; connection reset clears the snapshot slot.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-skills: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const snapshot = createSkillsSnapshotController(connection.api)
  // One shared viewing source for both registrations: an adoption made in the
  // header Popover is visible to the Settings section (§3.4). The value rides
  // the inject `hooks` compartment (not a `store` seat): the two slots live in
  // different scopes (root settings section vs per-session header action), and
  // the slot system pins a shared store handle to one scope.
  const feature = createSkillsFeatureController()
  // One bound translator serves both the nav-label thunk and any future copy.
  const t = ctx.locale.bind(NS)
  const openManagement = (): void => { ctx.settingsNavigator?.open(SKILLS_SECTION_ID) }

  ctx.effect(() => {
    const disposers = [
      ctx.on('connection/reset', () => { snapshot.reset() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-settings-skills: invalidations')

  const injected = (): SkillsFeatureInjected => ({
    load: sessionId => snapshot.load(sessionId),
    retry: () => snapshot.retry(),
    reset: () => snapshot.reset(),
    openManagement,
    adopt: (sessionId) => { feature.adopt(sessionId) },
    followCurrent: () => { feature.followCurrent() },
    hooks: { snapshot: snapshot.source, adopted: feature.source },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SKILLS_SECTION_ID,
    order: 15,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, SkillsSection))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'skills',
    order: 10,
    locale: NS,
    inject: injected,
  }, SkillsPopover))
}

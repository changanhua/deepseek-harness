/**
 * Browser half of the Work Observatory: a headless main-document activity
 * producer plus a read-only settings section over the Host range Remote.
 * The tracker is app-scope and independent of the section lifecycle.
 */
import type { WorkObservatoryRange } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: mounts the generated Work Observatory Remote contribution on ctx.remote.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installActivityTracker } from './activity-tracker.ts'
import { WorkObservatorySection } from './WorkObservatorySection.tsx'
import type { WorkObservatorySectionInjected } from './WorkObservatorySection.tsx'
import type { WorkObservatoryKey } from './locales.ts'
import { en, zh } from './locales.ts'

export type { WorkObservatorySectionInjected, WorkObservatorySectionProps } from './WorkObservatorySection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Work Observatory settings section copy. */
    'settings.workObservatory': WorkObservatoryKey
  }
}

/** Required services: slots, locale, and the generated Work Observatory Remote. */
export const inject = ['slots', 'locale', 'remote', 'remote.workObservatory']

/**
 * Install the app-scope tracker and register the read-only settings section.
 * @param ctx - Client context carrying the generated Work Observatory Remote.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('settings.workObservatory', { zh, en }), 'work-observatory: section dictionaries')

  ctx.effect(
    () => installActivityTracker({
      observeClient: observation => ctx.remote.workObservatory.observeClient(observation)
        .then((result) => {
          if (!result.ok) throw result.error
        }),
      onError: error => ctx.logger.warn(`work observatory: observation failed: ${String(error)}`),
    }),
    'work-observatory: activity tracker',
  )

  const sectionInjected = (): WorkObservatorySectionInjected => ({
    // Plain callback over the BFF Remote; the section never sees ctx or a service object.
    readRange: async (from: number, to: number): Promise<WorkObservatoryRange> => {
      const result = await ctx.remote.workObservatory.range({ from, to })
      if (!result.ok) throw result.error
      return result.value
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'work-observatory',
    order: 80,
    label: () => ctx.locale.bind('settings.workObservatory')('nav'),
    locale: 'settings.workObservatory',
    inject: sectionInjected,
  }, WorkObservatorySection))
}

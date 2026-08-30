/** Personal Delivery workbench browser plugin. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-delivery-remote/remote'
import type { DeliveryNavInjected, DeliveryWorkspaceInjected } from './contract.ts'
import { DeliveryNavEntry } from './DeliveryNavEntry.tsx'
import { DeliveryWorkbench } from './DeliveryWorkbench.tsx'
import { en, NS, zh, type DeliveryKey } from './locales.ts'
import { createDeliveryRuntimeController } from './runtime-controller.ts'

export type {
  DeliveryNavEntryProps,
  DeliveryWorkspaceHooks,
  DeliveryWorkspaceInjected,
  DeliveryWorkspaceProps,
} from './contract.ts'
export type { DeliveryKey } from './locales.ts'
export type { DeliveryRuntimeState } from './runtime-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Personal Delivery workbench copy. */
    delivery: DeliveryKey
  }
}

/** Services used by the two slot entries and generated Delivery Remote. */
export const inject = ['slots', 'locale', 'remote', 'remote.delivery']

/** Register the Delivery module and lifecycle-owned Host projection. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-delivery: dictionaries')
  const runtime = createDeliveryRuntimeController(ctx.remote.delivery)
  ctx.effect(() => {
    runtime.load()
    return () => { runtime.dispose() }
  }, 'ui-delivery: Host projection lifecycle')

  const workspaceInjected = (): DeliveryWorkspaceInjected => ({
    hooks: { delivery: runtime.source },
    refresh: () => { runtime.load() },
    cancel: () => { runtime.cancel() },
    importIssue: input => runtime.importIssue(input),
    createPacket: input => runtime.createPacket(input),
    startChange: input => runtime.startChange(input),
    startVerification: input => runtime.startVerification(input),
    selectPacket: (packetId) => { runtime.selectPacket(packetId) },
    readEvidence: input => runtime.readEvidence(input),
    recordDecision: input => runtime.recordDecision(input),
  })
  const navInjected = (): DeliveryNavInjected => ({ hooks: { delivery: runtime.source } })

  ctx.slots.inject('shell.view', () => ctx.slots.register({
    name: 'shell.view',
    id: 'delivery',
    locale: NS,
    inject: workspaceInjected,
  }, DeliveryWorkbench))

  ctx.slots.inject('sidebar.modules', () => ctx.slots.register({
    name: 'sidebar.modules',
    id: 'delivery-module',
    order: 8,
    locale: NS,
    inject: navInjected,
  }, DeliveryNavEntry))
}

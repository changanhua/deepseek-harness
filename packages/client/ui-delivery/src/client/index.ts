/** Personal Delivery workbench browser plugin. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import deliveryRemote from '@deepseek-ai/dsh-delivery-remote/remote'
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
export const inject = ['slots', 'locale', 'remote']

/** Register the Delivery module and lifecycle-owned Host projection. */
function registerUi(ctx: ClientContext): void {
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
    createCase: input => runtime.createCase(input),
    reviseCase: input => runtime.reviseCase(input),
    recordRequirementDecision: input => runtime.recordRequirementDecision(input),
    publishIssue: input => runtime.publishIssue(input),
    resolvePublication: input => runtime.resolvePublication(input),
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

/** Mount the generated Delivery Remote contribution before registering its consumers. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(deliveryRemote)
  const ui = ctx.inject(['slots', 'locale', 'remote', 'remote.delivery'], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}

/** Architecture workspace browser plugin. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-host-plugin-inventory/remote'
import { ArchitectureNavEntry } from './ArchitectureNavEntry.tsx'
import { ArchitectureWorkspace } from './ArchitectureWorkspace.tsx'
import { architectureCatalog } from './catalog.generated.ts'
import type { ArchitectureNavInjected, ArchitectureWorkspaceInjected } from './contract.ts'
import { en, NS, zh, type ArchitectureKey } from './locales.ts'
import {
  createArchitectureRuntimeController,
} from './runtime-controller.ts'

export type {
  ArchitectureNavEntryProps,
  ArchitectureNavInjected,
  ArchitectureWorkspaceHooks,
  ArchitectureWorkspaceInjected,
  ArchitectureWorkspaceProps,
} from './contract.ts'
export type { ArchitectureCatalog, ArchitectureFace, ArchitecturePackage } from './catalog.ts'
export type { ArchitectureKey } from './locales.ts'
export type { ArchitectureRuntimeState } from './runtime-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Architecture workspace copy. */
    architecture: ArchitectureKey
  }
}

/** Services used by the locale, Runtime snapshot, and two slot entries. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']

/** Register the full-page Architecture workspace and persistent sidebar entry. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-architecture: dictionaries')
  const runtime = createArchitectureRuntimeController(ctx.remote.pluginInventory)
  ctx.effect(() => {
    runtime.load()
    return () => { runtime.dispose() }
  }, 'ui-architecture: Runtime snapshot lifecycle')

  const workspaceInjected = (): ArchitectureWorkspaceInjected => ({
    catalog: architectureCatalog,
    refresh: () => { runtime.load() },
    hooks: { runtime: runtime.source },
  })
  const navInjected = (): ArchitectureNavInjected => ({ catalog: architectureCatalog })

  ctx.slots.inject('shell.view', () => ctx.slots.register({
    name: 'shell.view',
    id: 'architecture',
    locale: NS,
    inject: workspaceInjected,
  }, ArchitectureWorkspace))

  ctx.slots.inject('sidebar.modules', () => ctx.slots.register({
    name: 'sidebar.modules',
    id: 'architecture-module',
    order: 7,
    locale: NS,
    inject: navInjected,
  }, ArchitectureNavEntry))
}

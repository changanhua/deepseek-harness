import { fileURLToPath } from 'node:url'
import { z } from 'zod'

export const connectorVersion = '0.3.1'
export const extensionRuntimeSchema = z.object({ version: z.string().min(1).max(64) }).strict()
const runtimeSchema = z.object({
  version: z.string().min(1).max(64), protocolVersion: z.literal(1),
  modulePath: z.string().min(1).max(8192), processId: z.number().int().positive(), startedAt: z.iso.datetime(),
}).strict()
const statusSchema = z.object({
  relay: runtimeSchema.optional(),
  instances: z.array(z.object({
    installationId: z.uuid(), online: z.boolean(), scopes: z.array(z.string()),
    runtime: extensionRuntimeSchema.nullable().optional(),
    capabilities: z.object({ targetFreeOpen: z.boolean(), actionKinds: z.array(z.string()) }).optional(),
  })),
})

/** Capture the loaded component, not another release found on disk. */
export function runtimeIdentity(moduleUrl: string) {
  return { version: connectorVersion, protocolVersion: 1 as const, modulePath: fileURLToPath(moduleUrl),
    processId: process.pid, startedAt: new Date().toISOString() }
}

/** Missing diagnostics are unknown; extension and connector versions are independent. */
export function diagnoseStatus(value: unknown, mcp: ReturnType<typeof runtimeIdentity>) {
  const status = statusSchema.parse(value)
  const issues: { component: 'relay' | 'extension'; code: string; installationId?: string }[] = []
  if (!status.relay) issues.push({ component: 'relay', code: 'runtime_unknown' })
  else if (status.relay.version !== mcp.version) issues.push({ component: 'relay', code: 'connector_version_mismatch' })
  if (!status.instances.length) issues.push({ component: 'extension', code: 'no_connected_installation' })
  for (const instance of status.instances) {
    const add = (code: string) => issues.push({ component: 'extension', installationId: instance.installationId, code })
    if (!instance.online) { add('offline'); continue }
    if (!instance.runtime) add('runtime_unknown')
    if (!instance.capabilities?.targetFreeOpen || !instance.capabilities.actionKinds.includes('tab_open')) add('target_free_open_unavailable')
  }
  return { instances: status.instances, connector: { mcp, relay: status.relay ?? null }, issues }
}

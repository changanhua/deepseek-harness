/** Load metadata without importing capability implementations or mounting presets. */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import type { CapabilityBinding, CapabilityDeclaration } from './types.ts'

/** A validated, immutable deployment row. */
export interface CatalogEntry extends CapabilityDeclaration {
  readonly preset: string
  readonly digest: string
}

/** Stable structural digest independent of object property insertion order. */
export function declarationDigest(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical)
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]))
    }
    return item
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

/** Import a declaration through the same installed module world as the Loader. */
async function importDeclaration(ctx: Context, specifier: string): Promise<unknown> {
  if (ctx.baseUrl === undefined) throw new Error('mcp-server requires a Loader base URL')
  if (ctx.loader.internal) return ctx.loader.internal.import(specifier, ctx.baseUrl, {})
  const url = specifier.startsWith('.') || specifier.startsWith('file:')
    ? new URL(specifier, ctx.baseUrl).href
    : pathToFileURL(createRequire(ctx.baseUrl).resolve(specifier)).href
  return import(/* @vite-ignore */ url)
}

/** Validate declarations once at the trusted configuration boundary. */
export async function loadCatalog(ctx: Context, bindings: readonly CapabilityBinding[]): Promise<readonly CatalogEntry[]> {
  const names = new Set<string>(['dsh_capabilities'])
  const entries: CatalogEntry[] = []
  for (const binding of bindings) {
    const namespace = await importDeclaration(ctx, binding.declaration)
    if (namespace === null || typeof namespace !== 'object' || !('describe' in namespace) || typeof namespace.describe !== 'function') {
      throw new Error(`mcp-server: declaration ${binding.declaration} must export describe(options)`)
    }
    const describe = namespace.describe as (options: CapabilityBinding['options']) => unknown
    const candidate = describe(binding.options ?? {})
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('mcp-server: declaration must be an object')
    const declaration = candidate as CapabilityDeclaration
    if (typeof declaration.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(declaration.name) || names.has(declaration.name)) {
      throw new Error(`mcp-server: invalid or duplicate capability name ${declaration.name}`)
    }
    if (typeof declaration.description !== 'string' || declaration.description.length === 0) throw new Error('mcp-server: capability description is required')
    assertSupportedJsonSchema(declaration.parameters)
    assertSupportedJsonSchema(declaration.outputSchema)
    if (declaration.parameters.type !== 'object') throw new Error('mcp-server: input schema must have an object root')
    const snapshot = JSON.parse(JSON.stringify(declaration)) as CapabilityDeclaration
    names.add(snapshot.name)
    entries.push(Object.freeze({ ...snapshot, preset: binding.preset, digest: declarationDigest(snapshot) }))
  }
  return Object.freeze(entries)
}

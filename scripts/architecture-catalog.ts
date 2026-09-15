/** Build-time package catalog consumed by the Architecture workspace. */

import { globSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

const PACKAGE_PREFIXES = ['@deepseek-ai/dsh-', '@changanhua/dsh-'] as const

function packageShort(name: string): string | undefined {
  const prefix = PACKAGE_PREFIXES.find(candidate => name.startsWith(candidate))
  return prefix === undefined ? undefined : name.slice(prefix.length)
}

export type ArchitectureFace = 'bundle' | 'client' | 'package' | 'remote' | 'tool'

export interface ArchitecturePackage {
  readonly name: string
  readonly short: string
  readonly group: string
  readonly path: string
  readonly source: string
  readonly description: string
  /** Full npm identities of in-repo peer dependencies. */
  readonly dependencies: readonly string[]
  readonly faces: readonly ArchitectureFace[]
}

export interface ArchitectureProfile {
  readonly name: string
  readonly bundles: readonly string[]
  readonly source: string
}

export interface ArchitectureBundle {
  readonly name: string
  readonly short: string
  readonly path: string
  readonly description: string
  readonly packages: readonly string[]
  readonly source: string
}

export interface ArchitectureCatalog {
  readonly schemaVersion: 3
  readonly profiles: readonly ArchitectureProfile[]
  readonly bundles: readonly ArchitectureBundle[]
  readonly packages: readonly ArchitecturePackage[]
}

/** Read the shipped Profile templates from the boot source of this checkout. */
function collectArchitectureProfiles(root: string): ArchitectureProfile[] {
  const source = 'packages/boot/app-boot/src/profile.ts'
  const file = readFileSync(resolve(root, source), 'utf8')
  const marker = file.indexOf('export const PROFILE_TEMPLATES')
  if (marker < 0) throw new Error(`architecture-catalog: ${source} has no PROFILE_TEMPLATES export`)
  const section = file.slice(marker, file.indexOf('\n}\n', marker) + 3)
  const profiles: ArchitectureProfile[] = []
  const profilePattern = /\n\s{2}(?:'([^']+)'|([A-Za-z0-9-]+)):\s*\{\s*bundles:\s*\[([\s\S]*?)\]/g
  for (const match of section.matchAll(profilePattern)) {
    const name = match[1] ?? match[2]
    const bundles = [...(match[3] ?? '').matchAll(/'([^']+)'/g)]
      .map(item => item[1])
      .filter((value): value is string => value !== undefined)
    if (name === undefined || bundles.length === 0) throw new Error(`architecture-catalog: invalid Profile template in ${source}`)
    profiles.push({ name, bundles, source })
  }
  if (profiles.length === 0) throw new Error(`architecture-catalog: no Profile templates found in ${source}`)
  return profiles
}

/** Collect the current checkout's formal `packages/<group>/<leaf>` manifests. */
export function collectArchitectureCatalog(root: string): ArchitectureCatalog {
  const bundleDependencies = new Map<string, readonly string[]>()
  const packages = globSync('packages/*/*/package.json', { cwd: root })
    .map(path => path.split(sep).join('/'))
    .sort()
    .flatMap((manifestPath): ArchitecturePackage[] => {
      const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8')) as {
        name?: string
        description?: string
        peerDependencies?: Record<string, string>
        dependencies?: Record<string, string>
        exports?: Record<string, unknown>
        dsh?: { bundle?: unknown; client?: unknown }
      }
      if (manifest.name === undefined) return []
      const short = packageShort(manifest.name)
      if (short === undefined) return []
      const [, group, leaf] = manifestPath.split('/')
      if (group === undefined || leaf === undefined) {
        throw new Error(`architecture-catalog: unexpected package path ${manifestPath}`)
      }
      if (manifest.description === undefined || manifest.description.trim() === '') {
        throw new Error(`architecture-catalog: ${manifest.name} declares no description`)
      }
      const faces: ArchitectureFace[] = []
      if (manifest.dsh?.client !== undefined) faces.push('client')
      if (manifest.dsh?.bundle !== undefined) faces.push('bundle')
      if (manifest.exports?.['./remote'] !== undefined || manifest.exports?.['./typert'] !== undefined) faces.push('remote')
      if (short.startsWith('tool-')) faces.push('tool')
      if (faces.length === 0) faces.push('package')
      return [{
        name: manifest.name,
        short,
        group,
        path: dirname(manifestPath).split(sep).join('/'),
        source: manifestPath,
        description: manifest.description,
        dependencies: Object.keys(manifest.peerDependencies ?? {})
          .filter(name => packageShort(name) !== undefined)
          .sort(),
        faces,
      }]
    })
  const packageNames = new Set(packages.map(pkg => pkg.name))
  for (const manifestPath of globSync('packages/*/*/package.json', { cwd: root }).map(path => path.split(sep).join('/')).sort()) {
    const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8')) as {
      name?: string
      description?: string
      dependencies?: Record<string, string>
      dsh?: { bundle?: unknown }
    }
    if (manifest.name === undefined || manifest.dsh?.bundle === undefined) continue
    bundleDependencies.set(manifest.name, Object.keys(manifest.dependencies ?? {}).filter(name => packageNames.has(name)).sort())
  }
  for (const pkg of packages) {
    for (const dependency of pkg.dependencies) {
      if (!packageNames.has(dependency)) {
        throw new Error(`architecture-catalog: ${pkg.name} references missing in-repo peer ${dependency}`)
      }
    }
  }
  const bundles: ArchitectureBundle[] = packages
    .filter(pkg => pkg.faces.includes('bundle'))
    .map(pkg => ({
      name: pkg.name,
      short: pkg.short,
      path: pkg.path,
      description: pkg.description,
      packages: bundleDependencies.get(pkg.name) ?? [],
      source: pkg.source,
    }))
  const bundleNames = new Set(bundles.map(bundle => bundle.name))
  const profiles = collectArchitectureProfiles(root)
  for (const profile of profiles) {
    for (const bundle of profile.bundles) {
      if (!bundleNames.has(bundle)) {
        throw new Error(`architecture-catalog: Profile ${profile.name} references missing Bundle ${bundle}`)
      }
    }
  }
  return { schemaVersion: 3, profiles, bundles, packages }
}

/** Render the deterministic browser module committed beside the feature. */
export function renderArchitectureCatalogModule(catalog: ArchitectureCatalog): string {
  const quote = (value: string): string => `'${value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')}'`
  const lines = [
    '// Generated by scripts/gen-architecture-catalog.ts. Do not edit by hand.',
    "import type { ArchitectureCatalog } from './catalog.ts'",
    '',
    '/** Package declarations from the checkout that built this Client artifact. */',
    'export const architectureCatalog: ArchitectureCatalog = {',
    '  schemaVersion: 3,',
    '  profiles: [',
  ]
  for (const profile of catalog.profiles) {
    lines.push(
      '    {',
      `      name: ${quote(profile.name)},`,
      '      bundles: [',
      ...profile.bundles.map(bundle => `        ${quote(bundle)},`),
      '      ],',
      `      source: ${quote(profile.source)},`,
      '    },',
    )
  }
  lines.push(
    '  ],',
    '  bundles: [',
  )
  for (const bundle of catalog.bundles) {
    lines.push(
      '    {',
      `      name: ${quote(bundle.name)},`,
      `      short: ${quote(bundle.short)},`,
      `      path: ${quote(bundle.path)},`,
      `      description: ${quote(bundle.description)},`,
      '      packages: [',
      ...bundle.packages.map(pkg => `        ${quote(pkg)},`),
      '      ],',
      `      source: ${quote(bundle.source)},`,
      '    },',
    )
  }
  lines.push(
    '  ],',
    '  packages: [',
  )
  for (const pkg of catalog.packages) {
    lines.push(
      '    {',
      `      name: ${quote(pkg.name)},`,
      `      short: ${quote(pkg.short)},`,
      `      group: ${quote(pkg.group)},`,
      `      path: ${quote(pkg.path)},`,
      `      source: ${quote(pkg.source)},`,
      `      description: ${quote(pkg.description)},`,
      '      dependencies: [',
      ...pkg.dependencies.map(dependency => `        ${quote(dependency)},`),
      '      ],',
      '      faces: [',
      ...pkg.faces.map(face => `        ${quote(face)},`),
      '      ],',
      '    },',
    )
  }
  lines.push('  ],', '}', '')
  return lines.join('\n')
}

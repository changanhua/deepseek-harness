/**
 * Shared workspace-package graph discovery and Mermaid identifier helpers for
 * the generated module graph and relationship-diagram generators. Each caller
 * supplies its own group ordering because the documents use different visual
 * priorities; manifest parsing and dependency-safe ordering have one owner.
 */

import { globSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

const PACKAGE_PREFIXES = ['@deepseek-ai/dsh-', '@changanhua/dsh-'] as const

function packageShort(name: string): string | undefined {
  const prefix = PACKAGE_PREFIXES.find(candidate => name.startsWith(candidate))
  return prefix === undefined ? undefined : name.slice(prefix.length)
}

/** One harness package and its in-repo peer-dependency edges. */
export interface PackageGraphNode {
  /** Package name with its supported DSH scope prefix removed. */
  short: string
  /** Full npm package name. */
  name: string
  /** Package group from `packages/<group>/<pkg>`. */
  group: string
  /** Repo-relative package directory. */
  rel: string
  /** Full npm names of in-repo peer dependencies, sorted by display name. */
  deps: string[]
}

/**
 * Read every harness package manifest and return dependency-first graph nodes.
 * @param root - absolute repository root.
 * @param groupOrder - caller-specific tiebreak order for packages in the same dependency layer.
 * @param gate - command name used in structural error messages.
 * @returns package nodes ordered after their in-repo dependencies, except for
 *   stable back edges inside a dependency cycle.
 */
export function collectPackageGraph(root: string, groupOrder: readonly string[], gate: string): PackageGraphNode[] {
  const packages: PackageGraphNode[] = []
  for (const rel of globSync('packages/*/*/package.json', { cwd: root }).map(path => path.split(sep).join('/')).sort()) {
    const json = JSON.parse(readFileSync(resolve(root, rel), 'utf8')) as {
      name: string
      peerDependencies?: Record<string, string>
    }
    const short = packageShort(json.name)
    if (short === undefined) continue
    const [, group, leaf] = rel.split('/')
    if (group === undefined || leaf === undefined) throw new Error(`${gate}: unexpected package path ${rel}`)
    const dependencies = Object.keys(json.peerDependencies ?? {})
      .map(name => ({ name, short: packageShort(name) }))
      .filter((dependency): dependency is { name: string; short: string } => dependency.short !== undefined)
      .sort((left, right) => left.short.localeCompare(right.short) || left.name.localeCompare(right.name))
    packages.push({
      short,
      name: json.name,
      group,
      rel: dirname(rel),
      deps: dependencies.map(dependency => dependency.name),
    })
  }
  return topoSort(packages, groupOrder, gate)
}

function topoSort(packages: PackageGraphNode[], groupOrder: readonly string[], gate: string): PackageGraphNode[] {
  const byName = new Map(packages.map(pkg => [pkg.name, pkg]))
  if (byName.size !== packages.length) throw new Error(`${gate}: duplicate full npm package identity in package graph`)
  for (const pkg of packages) {
    for (const dependency of pkg.deps) {
      if (!byName.has(dependency)) {
        throw new Error(`${gate}: ${pkg.name} references missing in-repo peer ${dependency}`)
      }
    }
  }
  const remaining = new Map(byName)
  const placed = new Set<string>()
  const out: PackageGraphNode[] = []
  while (remaining.size > 0) {
    let ready = [...remaining.values()]
      .filter(pkg => pkg.deps.every(dep => placed.has(dep)))
      .sort((a, b) => comparePackages(a, b, groupOrder))
    if (ready.length === 0) {
      const cycle = sinkCycles(remaining)
        .map(component => component.sort((a, b) => comparePackages(a, b, groupOrder)))
        .sort((a, b) => comparePackages(a[0], b[0], groupOrder))[0]
      if (cycle === undefined) throw new Error(`${gate}: could not order package dependency graph`)
      ready = cycle
    }
    for (const pkg of ready) {
      out.push(pkg)
      placed.add(pkg.name)
      remaining.delete(pkg.name)
    }
  }
  return out
}

type PackageGraphComponent = [PackageGraphNode, ...PackageGraphNode[]]

function sinkCycles(remaining: ReadonlyMap<string, PackageGraphNode>): PackageGraphComponent[] {
  let nextIndex = 0
  const indices = new Map<string, number>()
  const lowLinks = new Map<string, number>()
  const stack: PackageGraphNode[] = []
  const stacked = new Set<string>()
  const components: PackageGraphComponent[] = []

  const visit = (pkg: PackageGraphNode): void => {
    const index = nextIndex
    nextIndex += 1
    indices.set(pkg.name, index)
    lowLinks.set(pkg.name, index)
    stack.push(pkg)
    stacked.add(pkg.name)
    for (const dependency of pkg.deps) {
      const target = remaining.get(dependency)
      if (target === undefined) continue
      if (!indices.has(target.name)) {
        visit(target)
        lowLinks.set(pkg.name, Math.min(requiredValue(lowLinks, pkg.name), requiredValue(lowLinks, target.name)))
      } else if (stacked.has(target.name)) {
        lowLinks.set(pkg.name, Math.min(requiredValue(lowLinks, pkg.name), requiredValue(indices, target.name)))
      }
    }
    if (lowLinks.get(pkg.name) !== indices.get(pkg.name)) return
    const first = stack.pop()
    if (first === undefined) throw new Error('package graph traversal lost its active component')
    stacked.delete(first.name)
    const component: PackageGraphComponent = [first]
    let member = first
    while (member !== pkg) {
      const next = stack.pop()
      if (next === undefined) throw new Error('package graph traversal lost its active component')
      stacked.delete(next.name)
      component.push(next)
      member = next
    }
    components.push(component)
  }

  for (const pkg of remaining.values()) {
    if (!indices.has(pkg.name)) visit(pkg)
  }
  return components.filter((component) => {
    const names = new Set(component.map(pkg => pkg.name))
    const first = component[0]
    const cyclic = component.length > 1 || first.deps.includes(first.name)
    return cyclic && component.every(pkg => pkg.deps.every(dep => !remaining.has(dep) || names.has(dep)))
  })
}

function requiredValue<K, V>(values: ReadonlyMap<K, V>, key: K): V {
  const value = values.get(key)
  if (value === undefined) throw new Error('package graph traversal lost an indexed node')
  return value
}

function comparePackages(a: PackageGraphNode, b: PackageGraphNode, groupOrder: readonly string[]): number {
  const groupA = groupOrder.indexOf(a.group)
  const groupB = groupOrder.indexOf(b.group)
  const normA = groupA === -1 ? Number.MAX_SAFE_INTEGER : groupA
  const normB = groupB === -1 ? Number.MAX_SAFE_INTEGER : groupB
  return normA - normB || a.group.localeCompare(b.group) || a.short.localeCompare(b.short) || a.name.localeCompare(b.name)
}

/** Stable Mermaid id for a graph value. */
export function graphNodeId(prefix: string, value: string): string {
  return `${prefix}_${value.replace(/[^a-zA-Z0-9_]/g, '_')}`
}

/** Escape a value embedded in a quoted Mermaid label. */
export function escapeMermaidLabel(value: string): string {
  return value.replace(/"/g, '\\"')
}

/** Build-time package graph exposed to the Architecture client. */

export type ArchitectureFace = 'bundle' | 'client' | 'package' | 'remote' | 'tool'

/** One formal workspace package and its manifest-derived dependency facts. */
export interface ArchitecturePackage {
  readonly name: string
  readonly short: string
  readonly group: string
  readonly path: string
  /** The manifest that supplied this package's build facts. */
  readonly source: string
  readonly description: string
  /** Full npm identities of in-repo peer dependencies. */
  readonly dependencies: readonly string[]
  readonly faces: readonly ArchitectureFace[]
}

/** One shipped Profile template and its ordered Bundle layers. */
export interface ArchitectureProfile {
  readonly name: string
  readonly bundles: readonly string[]
  /** Source file that declares the template. */
  readonly source: string
}

/** One Bundle manifest and the formal workspace packages it directly carries. */
export interface ArchitectureBundle {
  readonly name: string
  readonly short: string
  readonly path: string
  readonly description: string
  readonly packages: readonly string[]
  /** Manifest that declares the Bundle. */
  readonly source: string
}

/** Versioned build-time catalog embedded in the Client bundle. */
export interface ArchitectureCatalog {
  readonly schemaVersion: 3
  readonly profiles: readonly ArchitectureProfile[]
  readonly bundles: readonly ArchitectureBundle[]
  readonly packages: readonly ArchitecturePackage[]
}

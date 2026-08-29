/** Build-time package graph exposed to the Architecture client. */

export type ArchitectureFace = 'bundle' | 'client' | 'package' | 'remote' | 'tool'

/** One formal workspace package and its manifest-derived dependency facts. */
export interface ArchitecturePackage {
  readonly name: string
  readonly short: string
  readonly group: string
  readonly path: string
  readonly description: string
  readonly dependencies: readonly string[]
  readonly faces: readonly ArchitectureFace[]
}

/** Versioned build-time catalog embedded in the Client bundle. */
export interface ArchitectureCatalog {
  readonly schemaVersion: 1
  readonly packages: readonly ArchitecturePackage[]
}

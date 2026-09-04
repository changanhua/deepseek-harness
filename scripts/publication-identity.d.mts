export interface PublicationIdentityContext {
  readonly githubActions?: string | undefined
  readonly packageNames: readonly string[]
  readonly repository?: string | undefined
}

export interface PublicationIdentityRegistry {
  readonly personalPackages: readonly {
    readonly publishPolicy: string
    readonly targetName: string
  }[]
  readonly personalRepository: string
  readonly personalScope: string
  readonly upstreamRepository: string
  readonly upstreamScope: string
}

export function assertPublicationIdentity(
  context: PublicationIdentityContext,
  registry: PublicationIdentityRegistry,
): void

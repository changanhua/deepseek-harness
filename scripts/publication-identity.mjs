/** Shared fail-closed repository and npm-scope publication policy. */

/**
 * Refuse a registry write unless GitHub Actions is running in the repository
 * that owns every requested package name.
 *
 * This is a repository guardrail, not registry authentication. npm credentials
 * and trusted-publisher policy remain the external authority.
 * @param {{githubActions?: string, packageNames: readonly string[], repository?: string}} context Publication context.
 * @param {{personalPackages: readonly {publishPolicy: string, targetName: string}[], personalRepository: string, personalScope: string, upstreamRepository: string, upstreamScope: string}} registry Package identity registry.
 */
export function assertPublicationIdentity(context, registry) {
  if (context.githubActions !== 'true') {
    throw new Error('GitHub Actions context is required before package publication');
  }
  if (context.repository === undefined || context.repository.trim() === '') {
    throw new Error('repository identity is required before package publication');
  }
  const normalizedRepository = context.repository.trim().toLowerCase();
  for (const name of context.packageNames) {
    if (name.startsWith(`${registry.upstreamScope}/`)) {
      if (normalizedRepository !== registry.upstreamRepository.toLowerCase()) {
        throw new Error(`${name} may only be published from ${registry.upstreamRepository}`);
      }
      continue;
    }
    if (name.startsWith(`${registry.personalScope}/`)) {
      if (normalizedRepository !== registry.personalRepository.toLowerCase()) {
        throw new Error(`${name} may only be published from ${registry.personalRepository}`);
      }
      const identity = registry.personalPackages.find((entry) => entry.targetName === name);
      if (identity === undefined) {
        throw new Error(`${name} has no publication owner in downstream/package-identities.json`);
      }
      if (identity.publishPolicy !== 'personal') {
        throw new Error(`${name} is blocked until its rescope is complete`);
      }
      continue;
    }
    throw new Error(`${name} has no publication owner in downstream/package-identities.json`);
  }
}

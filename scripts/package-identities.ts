/** Personal-distribution package provenance and fail-closed publication identity. */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  assertPublicationIdentity as assertSharedPublicationIdentity,
  type PublicationIdentityContext,
} from './publication-identity.mjs'

const REGISTRY_PATH = 'downstream/package-identities.json'
const SHA_PATTERN = /^[0-9a-f]{40}$/u

export interface PersonalPackageIdentity {
  readonly directory: string
  /** Package name used before the downstream rescope. */
  readonly legacyName: string
  readonly sourceName: string
  readonly sourceIdentity: 'personal'
  readonly publicationPolicy: 'blocked-until-release-verified' | 'personal'
  readonly releaseFamily: null | 'personal'
  readonly blockers: readonly string[]
}

export interface PackageIdentityRegistry {
  readonly schemaVersion: 2
  readonly versionPolicy: 'preserve-existing-during-rescope'
  readonly personalScope: string
  readonly personalRepository: string
  readonly personalRepositoryUrl: string
  readonly upstreamScope: string
  readonly upstreamRepository: string
  readonly upstreamRepositoryUrl: string
  readonly supportedUpstreamCommit: string
  readonly observedUpstreamCommit: string
  readonly unlistedPackageOrigin: 'upstream'
  readonly vendorPathPrefix: 'vendor/'
  readonly personalPackages: readonly PersonalPackageIdentity[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, field: string, label: string, errors: string[]): string | undefined {
  const value = record[field]
  if (typeof value === 'string' && value !== '') return value
  errors.push(`${label}.${field} must be a non-empty string`)
  return undefined
}

/** Validate the registry without consulting a checkout. */
export function validatePackageIdentityRegistry(input: unknown): string[] {
  if (!isRecord(input)) return ['package identity registry must be a JSON object']
  const errors: string[] = []
  if (input.schemaVersion !== 2) errors.push('schemaVersion must be 2')
  if (input.versionPolicy !== 'preserve-existing-during-rescope') {
    errors.push('versionPolicy must be preserve-existing-during-rescope')
  }
  const personalScope = requiredString(input, 'personalScope', 'registry', errors)
  const personalRepository = requiredString(input, 'personalRepository', 'registry', errors)
  const personalRepositoryUrl = requiredString(input, 'personalRepositoryUrl', 'registry', errors)
  const upstreamScope = requiredString(input, 'upstreamScope', 'registry', errors)
  const upstreamRepository = requiredString(input, 'upstreamRepository', 'registry', errors)
  const upstreamRepositoryUrl = requiredString(input, 'upstreamRepositoryUrl', 'registry', errors)
  const supportedUpstreamCommit = requiredString(input, 'supportedUpstreamCommit', 'registry', errors)
  const observedUpstreamCommit = requiredString(input, 'observedUpstreamCommit', 'registry', errors)

  if (personalScope !== undefined && !/^@[a-z0-9][a-z0-9._-]*$/u.test(personalScope)) {
    errors.push(`personalScope is not an npm scope: ${personalScope}`)
  }
  if (upstreamScope !== undefined && !/^@[a-z0-9][a-z0-9._-]*$/u.test(upstreamScope)) {
    errors.push(`upstreamScope is not an npm scope: ${upstreamScope}`)
  }
  if (personalRepository !== undefined
    && personalRepositoryUrl !== `git+https://github.com/${personalRepository}.git`) {
    errors.push('personalRepositoryUrl must match personalRepository')
  }
  if (upstreamRepository !== undefined
    && upstreamRepositoryUrl !== `git+https://github.com/${upstreamRepository}.git`) {
    errors.push('upstreamRepositoryUrl must match upstreamRepository')
  }
  if (supportedUpstreamCommit !== undefined && !SHA_PATTERN.test(supportedUpstreamCommit)) {
    errors.push('supportedUpstreamCommit must be a lowercase 40-character commit SHA')
  }
  if (observedUpstreamCommit !== undefined && !SHA_PATTERN.test(observedUpstreamCommit)) {
    errors.push('observedUpstreamCommit must be a lowercase 40-character commit SHA')
  }
  if (input.unlistedPackageOrigin !== 'upstream') {
    errors.push('unlistedPackageOrigin must remain upstream; personal origin is always explicit')
  }
  if (input.vendorPathPrefix !== 'vendor/') errors.push('vendorPathPrefix must be vendor/')
  if (!Array.isArray(input.personalPackages)) {
    errors.push('personalPackages must be an array')
    return errors
  }

  const directories = new Set<string>()
  const legacyNames = new Set<string>()
  const sourceNames = new Set<string>()
  let previousDirectory = ''
  for (const [index, candidate] of input.personalPackages.entries()) {
    const label = `personalPackages[${String(index)}]`
    if (!isRecord(candidate)) {
      errors.push(`${label} must be an object`)
      continue
    }
    const directory = requiredString(candidate, 'directory', label, errors)
    const legacyName = requiredString(candidate, 'legacyName', label, errors)
    const sourceName = requiredString(candidate, 'sourceName', label, errors)
    if (candidate.sourceIdentity !== 'personal') errors.push(`${label}.sourceIdentity must be personal`)
    if (candidate.publicationPolicy !== 'blocked-until-release-verified' && candidate.publicationPolicy !== 'personal') {
      errors.push(`${label}.publicationPolicy is invalid`)
    }
    if (candidate.releaseFamily !== null && candidate.releaseFamily !== 'personal') {
      errors.push(`${label}.releaseFamily must be null or personal`)
    }
    if (candidate.publicationPolicy === 'blocked-until-release-verified' && candidate.releaseFamily !== null) {
      errors.push(`${label}.releaseFamily must remain null while publication is blocked`)
    }
    if (candidate.publicationPolicy === 'personal' && candidate.releaseFamily !== 'personal') {
      errors.push(`${label}.releaseFamily must be personal before publication is enabled`)
    }
    if (!Array.isArray(candidate.blockers)
      || candidate.blockers.some(blocker => typeof blocker !== 'string' || blocker === '')) {
      errors.push(`${label}.blockers must be an array of non-empty strings`)
    } else if (candidate.publicationPolicy === 'blocked-until-release-verified' && candidate.blockers.length === 0) {
      errors.push(`${label}.blockers must explain why publication is blocked`)
    } else if (candidate.publicationPolicy === 'personal' && candidate.blockers.length > 0) {
      errors.push(`${label}: publishable package must have no blockers`)
    }
    if (directory !== undefined) {
      if (!/^packages\/[a-z0-9-]+\/[a-z0-9-]+$/u.test(directory)) {
        errors.push(`${label}.directory must name one packages/<group>/<package> directory`)
      }
      if (directories.has(directory)) errors.push(`duplicate personal package directory: ${directory}`)
      directories.add(directory)
      if (previousDirectory !== '' && directory < previousDirectory) {
        errors.push('personalPackages must be sorted by directory')
      }
      previousDirectory = directory
    }
    if (legacyName !== undefined) {
      if (upstreamScope !== undefined && !legacyName.startsWith(`${upstreamScope}/`)) {
        errors.push(`${label}.legacyName must start with ${upstreamScope}/`)
      }
      if (legacyNames.has(legacyName)) errors.push(`duplicate legacy package name: ${legacyName}`)
      legacyNames.add(legacyName)
    }
    if (sourceName !== undefined) {
      if (personalScope !== undefined && !sourceName.startsWith(`${personalScope}/`)) {
        errors.push(`${label}.sourceName must start with ${personalScope}/`)
      }
      if (sourceNames.has(sourceName)) errors.push(`duplicate source package name: ${sourceName}`)
      sourceNames.add(sourceName)
    }
  }
  return errors
}

/** Read and validate the personal-distribution identity registry. */
export function loadPackageIdentities(root: string = resolve(import.meta.dirname, '..')): PackageIdentityRegistry {
  const path = resolve(root, REGISTRY_PATH)
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const errors = validatePackageIdentityRegistry(parsed)
  if (errors.length > 0) throw new Error(`invalid ${REGISTRY_PATH}:\n${errors.join('\n')}`)
  return parsed as PackageIdentityRegistry
}

/** Check registry entries against the current package manifests. */
export function checkPackageIdentities(root: string = resolve(import.meta.dirname, '..')): string[] {
  const registry = loadPackageIdentities(root)
  const errors: string[] = []
  for (const identity of registry.personalPackages) {
    const manifestPath = resolve(root, identity.directory, 'package.json')
    if (!existsSync(manifestPath)) {
      errors.push(`${identity.directory}: registered personal package manifest is missing`)
      continue
    }
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!isRecord(manifest)) {
      errors.push(`${identity.directory}/package.json must be a JSON object`)
      continue
    }
    const name = manifest.name
    if (name !== identity.sourceName) {
      errors.push(`${identity.directory}: personal package must use ${identity.sourceName}`)
    }
    const repository = manifest.repository
    if (!isRecord(repository) || repository.url !== registry.personalRepositoryUrl
      || repository.directory !== identity.directory) {
      errors.push(`${identity.directory}: personal package repository must use ${registry.personalRepositoryUrl}`)
    }
    if (identity.publicationPolicy === 'blocked-until-release-verified') {
      if (manifest.private !== true) {
        errors.push(`${identity.directory}: blocked personal package must set \"private\": true`)
      }
      if (manifest.publishConfig !== undefined) {
        errors.push(`${identity.directory}: blocked personal package must omit publishConfig`)
      }
    } else {
      if (manifest.private === true) {
        errors.push(`${identity.directory}: publishable personal package must not set \"private\": true`)
      }
      const publishConfig = manifest.publishConfig
      if (!isRecord(publishConfig) || publishConfig.access !== 'public') {
        errors.push(`${identity.directory}: publishable personal package must set publishConfig.access to public`)
      }
    }
  }
  return errors
}

/**
 * Refuse a registry write outside the Actions repository that owns every package.
 * This guard prevents repository-tooling mistakes; registry credentials remain authoritative.
 */
export function assertPublicationIdentity(
  context: PublicationIdentityContext,
  registry: PackageIdentityRegistry = loadPackageIdentities(),
): void {
  assertSharedPublicationIdentity(context, registry)
}

function main(): void {
  try {
    const registry = loadPackageIdentities()
    const errors = checkPackageIdentities()
    if (errors.length > 0) throw new Error(errors.join('\n'))
    console.log(
      `package identities: ${String(registry.personalPackages.length)} personal package(s),`
      + ` source scope ${registry.personalScope}, publication remains policy-gated`,
    )
  } catch (error) {
    console.error(`package identities: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()

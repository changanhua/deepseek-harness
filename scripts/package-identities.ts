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
  readonly origin: 'personal'
  readonly currentName: string
  readonly targetName: string
  readonly publishPolicy: 'blocked-until-rescoped' | 'personal'
}

export interface PackageIdentityRegistry {
  readonly schemaVersion: 1
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
  if (input.schemaVersion !== 1) errors.push('schemaVersion must be 1')
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
  const currentNames = new Set<string>()
  const targetNames = new Set<string>()
  let previousDirectory = ''
  for (const [index, candidate] of input.personalPackages.entries()) {
    const label = `personalPackages[${String(index)}]`
    if (!isRecord(candidate)) {
      errors.push(`${label} must be an object`)
      continue
    }
    const directory = requiredString(candidate, 'directory', label, errors)
    const currentName = requiredString(candidate, 'currentName', label, errors)
    const targetName = requiredString(candidate, 'targetName', label, errors)
    if (candidate.origin !== 'personal') errors.push(`${label}.origin must be personal`)
    if (candidate.publishPolicy !== 'blocked-until-rescoped' && candidate.publishPolicy !== 'personal') {
      errors.push(`${label}.publishPolicy is invalid`)
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
    if (currentName !== undefined) {
      if (upstreamScope !== undefined && !currentName.startsWith(`${upstreamScope}/`)) {
        errors.push(`${label}.currentName must start with ${upstreamScope}/ during migration`)
      }
      if (currentNames.has(currentName)) errors.push(`duplicate current package name: ${currentName}`)
      currentNames.add(currentName)
    }
    if (targetName !== undefined) {
      if (personalScope !== undefined && !targetName.startsWith(`${personalScope}/`)) {
        errors.push(`${label}.targetName must start with ${personalScope}/`)
      }
      if (targetNames.has(targetName)) errors.push(`duplicate target package name: ${targetName}`)
      targetNames.add(targetName)
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
    if (identity.publishPolicy === 'blocked-until-rescoped') {
      if (name !== identity.currentName) {
        errors.push(`${identity.directory}: blocked package must retain ${identity.currentName} until its rescope PR`)
      }
      continue
    }
    if (name !== identity.targetName) {
      errors.push(`${identity.directory}: personal package must use ${identity.targetName}`)
    }
    const repository = manifest.repository
    if (!isRecord(repository) || repository.url !== registry.personalRepositoryUrl
      || repository.directory !== identity.directory) {
      errors.push(`${identity.directory}: personal package repository must use ${registry.personalRepositoryUrl}`)
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
      + ` target scope ${registry.personalScope}, publication blocked until explicit rescope`,
    )
  } catch (error) {
    console.error(`package identities: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()

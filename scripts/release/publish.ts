/**
 * Publish one packed release family from the tarballs the pack step produced.
 *
 * Publication is decided per package against the registry, never from a list of
 * "what this release includes": a version the registry lacks is published, a
 * version whose published tarball has the same integrity is skipped, and a
 * version whose published tarball differs fails the run — that last case means
 * the content changed without a version bump
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 *
 * Skipping on identical integrity is what makes re-running the publish step over
 * the same artifact safe.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { assertPublicationIdentity } from '../package-identities.ts'
import {
  releaseFamily,
  tarballName,
  type ReleaseFamily,
  type ReleaseMember,
} from './families.ts'
import { attempt, attemptEchoed, isEntry } from './process.ts'
import { packedPackage, readPublishOrder } from './tarball.ts'

/**
 * Registry codes that answer a write which did not settle, rather than a
 * rejection of what was sent. `E409 Failed to save packument` is the one this
 * sequence actually hits: publishing several packages in a row can outrun the
 * registry's own processing. A rejected payload (`E403` over an existing
 * version, a malformed manifest) never clears on a retry and must surface.
 */
const TRANSIENT_PUBLISH_CODES = ['E409', 'E429', 'E500', 'E502', 'E503', 'E504', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'] as const

/** How many times one tarball's publish is attempted before the run fails. */
const PUBLISH_ATTEMPTS = 4

/**
 * Shortest gap between two publishes, and the first retry backoff.
 *
 * The registry needs a moment to commit a packument before the next write; back
 * to back publishes are what produce `E409`.
 */
const PUBLISH_SPACING_MS = 2_000

/** One tarball expected or found in a packed release directory. */
export interface PackedReleaseEntry {
  readonly filename: string
  readonly manifest: Readonly<Record<string, unknown>>
  readonly name: string
  readonly version: string
}

/** Manifest sections that affect the installed runtime closure. */
const PACKED_RUNTIME_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const

/**
 * Resolve the only packed sequence the current source tree is allowed to publish.
 *
 * This deliberately reruns the family gates at publish time. A packed directory
 * is an artifact, not authority: an old or hand-assembled directory must not
 * bypass a dependency-closure or version rule added after it was produced.
 * @param family - release family selected by the workflow.
 * @param members - current source members of that family.
 * @returns Expected tarball identities in publish order.
 */
export function expectedPackedReleaseEntries(
  family: ReleaseFamily,
  members: readonly ReleaseMember[],
): PackedReleaseEntry[] {
  family.verifyVersions(members)
  const plan = family.publishOrder(members)
  if (plan.order.length !== members.length) {
    throw new Error(
      `release family ${family.id}: publish order covers ${String(plan.order.length)}`
      + ` of ${String(members.length)} members`,
    )
  }
  return plan.order.map(member => ({
    filename: tarballName(member),
    manifest: member.manifest,
    name: member.name,
    version: member.version,
  }))
}

/** Assert the order file names exactly the current family's tarballs. */
function assertPackedReleaseFilenames(
  expected: readonly PackedReleaseEntry[],
  filenames: readonly string[],
): void {
  if (filenames.length !== expected.length) {
    throw new Error(
      `packed release expected ${String(expected.length)} tarball(s), got ${String(filenames.length)}`,
    )
  }
  for (const [index, entry] of expected.entries()) {
    const filename = filenames[index]
    if (filename !== entry.filename) {
      throw new Error(
        `packed release position ${String(index + 1)} has filename ${JSON.stringify(filename)},`
        + ` expected ${JSON.stringify(entry.filename)}`,
      )
    }
  }
}

/**
 * Assert packed tarballs exactly match the current source set and publish order.
 * @param expected - entries resolved from the current source family.
 * @param actual - identities read from the packed directory and tarballs.
 */
export function assertPackedReleaseEntries(
  family: ReleaseFamily,
  expected: readonly PackedReleaseEntry[],
  actual: readonly PackedReleaseEntry[],
): void {
  assertPackedReleaseFilenames(expected, actual.map(entry => entry.filename))
  for (const [index, entry] of expected.entries()) {
    const packed = actual[index]
    if (packed === undefined) throw new Error(`packed release position ${String(index + 1)} is missing`)
    if (packed.name !== entry.name) {
      throw new Error(
        `packed release position ${String(index + 1)} has package name ${packed.name}, expected ${entry.name}`,
      )
    }
    if (packed.version !== entry.version) {
      throw new Error(
        `packed release position ${String(index + 1)} has version ${packed.version}, expected ${entry.version}`,
      )
    }
  }

  // The tarball is the payload that reaches npm, so apply the family closure
  // to its manifest too. Checking only the checkout would let a same-name,
  // same-version stale artifact carry a newly forbidden runtime edge.
  const packedMembers = actual.map((entry, index): ReleaseMember => ({
    directory: `packed:${String(index + 1)}:${entry.filename}`,
    manifest: entry.manifest,
    name: entry.name,
    version: entry.version,
  }))
  const packedOrder = family.publishOrder(packedMembers).order.map(member => member.name)
  const actualOrder = actual.map(entry => entry.name)
  if (packedOrder.join('\n') !== actualOrder.join('\n')) {
    throw new Error(
      `packed release runtime dependencies require order ${packedOrder.join(', ')},`
      + ` but publish-order.txt declares ${actualOrder.join(', ')}`,
    )
  }

  // pnpm rewrites workspace ranges while packing, so compare dependency names
  // rather than raw range text. Any added or removed runtime edge means these
  // tarballs were not packed from the current source manifests.
  for (const [index, entry] of expected.entries()) {
    const packed = actual[index]
    if (packed === undefined) throw new Error(`packed release position ${String(index + 1)} is missing`)
    for (const section of PACKED_RUNTIME_SECTIONS) {
      const sourceNames = dependencyNames(entry.manifest, section)
      const packedNames = dependencyNames(packed.manifest, section)
      if (sourceNames.join('\n') !== packedNames.join('\n')) {
        throw new Error(
          `packed release position ${String(index + 1)} ${entry.name} has stale ${section}`
          + `\n  source: ${sourceNames.join(', ') || '(none)'}`
          + `\n  packed: ${packedNames.join(', ') || '(none)'}`,
        )
      }
    }
  }
}

/** Sorted dependency names from one manifest section. */
function dependencyNames(manifest: Readonly<Record<string, unknown>>, section: string): string[] {
  const value = manifest[section]
  if (value === undefined) return []
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`packed release manifest ${section} must be an object`)
  }
  return Object.keys(value).sort()
}

/** What the registry knows about one version. */
type RegistryState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly integrity: string }

/**
 * Whether a failed publish is worth another attempt.
 * @param output - combined npm output.
 * @returns True when the registry reported a write it did not commit.
 */
function isTransientFailure(output: string): boolean {
  return TRANSIENT_PUBLISH_CODES.some(code => output.includes(`code ${code}`))
}

/**
 * The subresource integrity string npm records for a tarball.
 * @param tarball - absolute tarball path.
 * @returns A `sha512-<base64>` string.
 */
function integrityOf(tarball: string): string {
  return `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`
}

/**
 * Ask the registry whether a version exists, and with what integrity.
 * @param name - package name.
 * @param version - package version.
 * @returns The registry state for that version.
 */
function registryState(name: string, version: string): RegistryState {
  const result = attempt('npm', ['view', `${name}@${version}`, 'dist.integrity', '--json'])
  if (result.status !== 0) {
    const output = `${result.stdout}${result.stderr}`
    if (output.includes('E404') || output.includes('404 Not Found')) return { kind: 'absent' }
    throw new Error(`npm view ${name}@${version} failed:\n${output}`)
  }
  const parsed: unknown = JSON.parse(result.stdout)
  if (typeof parsed !== 'string' || parsed === '') {
    throw new Error(`registry reported no dist.integrity for ${name}@${version}`)
  }
  return { kind: 'present', integrity: parsed }
}

/**
 * Publish one tarball, retrying a registry write that did not settle.
 *
 * Every retry re-reads the registry first, because `E409` can answer a write
 * that landed anyway: republishing a version that now exists fails permanently,
 * so the same integrity appearing under the failed attempt counts as success.
 * @param tarball - absolute tarball path.
 * @param name - package name the tarball declares.
 * @param version - package version the tarball declares.
 */
async function publishTarball(tarball: string, name: string, version: string): Promise<void> {
  // A prerelease version never takes the latest dist-tag.
  const tagArgs = version.includes('-') ? ['--tag', 'next'] : []
  for (let tries = 1; tries <= PUBLISH_ATTEMPTS; tries += 1) {
    // No --access: the sequences do not share one access level, so a
    // command-line flag could not serve both and would override the manifest
    // that does. Each packed manifest decides, and
    // check-workspace-constraints holds every manifest to its sequence's level.
    const result = attemptEchoed('npm', ['publish', tarball, ...tagArgs])
    const output = `${result.stdout}${result.stderr}`
    if (result.status === 0) return

    const settled = registryState(name, version)
    if (settled.kind === 'present' && settled.integrity === integrityOf(tarball)) {
      console.log(`release publish: ${name}@${version} landed despite a reported failure, continuing`)
      return
    }
    if (tries === PUBLISH_ATTEMPTS || !isTransientFailure(output)) {
      throw new Error(`npm publish ${name}@${version} failed:\n${output}`)
    }
    const backoff = PUBLISH_SPACING_MS * 2 ** (tries - 1)
    console.log(
      `release publish: ${name}@${version} hit a transient registry failure`
      + ` (attempt ${String(tries)} of ${String(PUBLISH_ATTEMPTS)}), retrying in ${String(backoff)}ms`,
    )
    await sleep(backoff)
  }
}

/** Publish the family named by `--family` from the directory named by `--from`. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { family: { type: 'string' }, from: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.family === undefined || values.from === undefined) {
    throw new Error('usage: publish.ts --family <dsh|vendor> --from <packed directory>')
  }

  const family = releaseFamily(values.family)
  const root = process.cwd()
  const expected = expectedPackedReleaseEntries(family, family.members(root))
  const directory = resolve(root, values.from)

  // Every entry in the order settles as either published or already present, so
  // one counter answers "how far along is this run" for whoever is watching a
  // release that takes minutes per family.
  const order = readPublishOrder(directory)
  // Reject unexpected filenames before opening an archive. Besides making the
  // set exact, this keeps an order file from directing tar at a path outside
  // the pack directory.
  assertPackedReleaseFilenames(expected, order)
  const entries = order.map((filename) => {
    const tarball = join(directory, filename)
    return { filename, tarball, ...packedPackage(tarball) }
  })
  assertPackedReleaseEntries(family, expected, entries)
  assertPublicationIdentity({
    githubActions: process.env.GITHUB_ACTIONS,
    packageNames: entries.map(entry => entry.name),
    repository: process.env.GITHUB_REPOSITORY,
  })
  const total = String(order.length)
  let published = 0
  let skipped = 0
  for (const [index, entry] of entries.entries()) {
    const progress = `[${String(index + 1)}/${total}]`
    const { name, tarball, version } = entry
    const state = registryState(name, version)
    if (state.kind === 'present') {
      const local = integrityOf(tarball)
      if (state.integrity !== local) {
        throw new Error(
          `${name}@${version} is already published with different content`
          + `\n  registry: ${state.integrity}\n  packed:   ${local}`
          + '\nBump the version, or investigate why the build is not reproducible.',
        )
      }
      console.log(`release publish: ${progress} ${name}@${version} already published, skipping`)
      skipped += 1
      continue
    }
    // Space out the writes: the gap belongs between publishes, so a run that
    // only skips does not wait at all.
    if (published > 0) await sleep(PUBLISH_SPACING_MS)
    await publishTarball(tarball, name, version)
    console.log(`release publish: ${progress} ${name}@${version} published`)
    published += 1
  }

  console.log(
    `release publish: family ${family.id}, ${total} member(s),`
    + ` ${String(published)} published, ${String(skipped)} already present`,
  )
}

if (isEntry(import.meta.url)) await main()

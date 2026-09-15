/** Personal-distribution package provenance and publication-boundary policy. */

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertPublicationIdentity,
  checkPackageIdentities,
  loadPackageIdentities,
  validatePackageIdentityRegistry,
} from './package-identities.ts'

const root = resolve(import.meta.dirname, '..')

describe('package identity registry', () => {
  it('classifies the rescoped tree and keeps every personal package source-only', () => {
    const registry = loadPackageIdentities(root)

    expect(checkPackageIdentities(root)).toEqual([])
    expect(registry.schemaVersion).toBe(2)
    expect(registry.personalScope).toBe('@changanhua')
    expect(registry.personalPackages).toHaveLength(41)
    expect(registry.versionPolicy).toBe('preserve-existing-during-rescope')
    expect(new Set(registry.personalPackages.map(entry => entry.sourceName)).size).toBe(41)
    expect(registry.personalPackages.every(entry => entry.sourceIdentity === 'personal')).toBe(true)
    expect(registry.personalPackages.every(entry => entry.sourceName.startsWith('@changanhua/'))).toBe(true)
    expect(registry.personalPackages.every(entry => entry.legacyName.startsWith('@deepseek-ai/'))).toBe(true)
    expect(registry.personalPackages.every(entry => entry.publicationPolicy === 'blocked-until-release-verified')).toBe(true)
    expect(registry.personalPackages.every(entry => entry.releaseFamily === null)).toBe(true)

    for (const identity of registry.personalPackages) {
      const manifest = JSON.parse(readFileSync(resolve(root, identity.directory, 'package.json'), 'utf8')) as {
        name?: string
        private?: boolean
        publishConfig?: unknown
        repository?: { url?: string; directory?: string }
      }
      expect(manifest.name).toBe(identity.sourceName)
      expect(manifest.private).toBe(true)
      expect(manifest.publishConfig).toBeUndefined()
      expect(manifest.repository).toMatchObject({
        url: registry.personalRepositoryUrl,
        directory: identity.directory,
      })
    }
  })

  it('rejects a personal source name outside the configured scope and duplicate identities', () => {
    const registry = loadPackageIdentities(root)
    const [first, second] = registry.personalPackages
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (first === undefined || second === undefined) return

    expect(validatePackageIdentityRegistry({
      ...registry,
      personalPackages: [
        { ...first, sourceName: '@someone-else/dsh-personal-delivery' },
        { ...second, sourceName: '@someone-else/dsh-personal-delivery' },
      ],
    })).toEqual(expect.arrayContaining([
      expect.stringMatching(/must start with @changanhua\//),
      expect.stringMatching(/duplicate source package name/),
    ]))
  })

  it('keeps direct personal identities out of the Python distribution entry inputs', () => {
    const registry = loadPackageIdentities(root)
    const closure = [
      'python/sdk-runtime/package.json',
      'scripts/build-exe-for-python-sdk.ts',
    ].map(file => readFileSync(resolve(root, file), 'utf8')).join('\n')

    for (const identity of registry.personalPackages) {
      expect(closure).not.toContain(identity.sourceName)
    }
  })

  it('does not assign a release family while publication remains blocked', () => {
    const registry = loadPackageIdentities(root)
    const [first] = registry.personalPackages
    expect(first).toBeDefined()
    if (first === undefined) return

    expect(validatePackageIdentityRegistry({
      ...registry,
      personalPackages: [{ ...first, releaseFamily: 'personal', blockers: [] }],
    })).toEqual(expect.arrayContaining([
      expect.stringMatching(/releaseFamily must remain null/),
      expect.stringMatching(/blockers must explain/),
    ]))

    expect(validatePackageIdentityRegistry({
      ...registry,
      personalPackages: [{ ...first, publicationPolicy: 'personal' }],
    })).toEqual(expect.arrayContaining([
      expect.stringMatching(/releaseFamily must be personal/),
      expect.stringMatching(/publishable package must have no blockers/),
    ]))
  })
})

describe('publication identity firewall', () => {
  it('allows official names only from the official repository', () => {
    expect(() => {
      assertPublicationIdentity({
        githubActions: 'true',
        packageNames: ['@deepseek-ai/dsh'],
        repository: 'deepseek-ai/deepseek-harness',
      })
    }).not.toThrow()
    expect(() => {
      assertPublicationIdentity({
        githubActions: 'true',
        packageNames: ['@deepseek-ai/dsh'],
        repository: 'changanhua/deepseek-harness',
      })
    }).toThrow(/@deepseek-ai\/dsh.*deepseek-ai\/deepseek-harness/)
  })

  it('allows a personal name only after its registry policy is promoted and fails closed without repository identity', () => {
    const registry = loadPackageIdentities(root)
    const [first] = registry.personalPackages
    expect(first).toBeDefined()
    if (first === undefined) return

    expect(() => {
      assertPublicationIdentity({
        githubActions: 'true',
        packageNames: [first.sourceName],
        repository: 'changanhua/deepseek-harness',
      })
    }).toThrow(/blocked until its release verification/)
    expect(() => {
      assertPublicationIdentity({
        githubActions: 'true',
        packageNames: [first.sourceName],
        repository: 'changanhua/deepseek-harness',
      }, {
        ...registry,
        personalPackages: [{
          ...first,
          publicationPolicy: 'personal',
          releaseFamily: 'personal',
          blockers: [],
        }],
      })
    }).not.toThrow()
    expect(() => {
      assertPublicationIdentity({
        githubActions: 'true',
        packageNames: [first.sourceName],
        repository: 'deepseek-ai/deepseek-harness',
      })
    }).toThrow(new RegExp(`${first.sourceName}.*changanhua/deepseek-harness`))
    expect(() => {
      assertPublicationIdentity({ githubActions: 'true', packageNames: ['@deepseek-ai/dsh'] })
    }).toThrow(/repository identity is required/)
  })

  it('does not treat a locally spoofed repository variable as GitHub Actions identity', () => {
    expect(() => {
      assertPublicationIdentity({
        packageNames: ['@deepseek-ai/dsh'],
        repository: 'deepseek-ai/deepseek-harness',
      })
    }).toThrow(/GitHub Actions context is required/)
  })

  it('rejects packages outside both owned scopes', () => {
    expect(() => {
      assertPublicationIdentity({
        githubActions: 'true',
        packageNames: ['unscoped-package'],
        repository: 'changanhua/deepseek-harness',
      })
    }).toThrow(/no publication owner/)
  })

  it('rejects a personal baseline that would also move the official dsh dist-tag', () => {
    const registry = loadPackageIdentities(root)
    const [first] = registry.personalPackages
    expect(first).toBeDefined()
    if (first === undefined) return

    expect(() => {
      assertPublicationIdentity({
        githubActions: 'true',
        packageNames: [first.sourceName, '@deepseek-ai/dsh'],
        repository: 'changanhua/deepseek-harness',
      }, {
        ...registry,
        personalPackages: [{
          ...first,
          publicationPolicy: 'personal',
          releaseFamily: 'personal',
          blockers: [],
        }],
      })
    }).toThrow(/@deepseek-ai\/dsh.*deepseek-ai\/deepseek-harness/)
  })

  it('runs before every JavaScript publication path can reach a registry write', () => {
    const cases = [
      { file: 'scripts/release/verify.ts', operation: 'verifyTag(' },
      { file: 'scripts/release/publish.ts', operation: 'registryState(' },
      { file: 'scripts/publish-npm-baseline.ts', operation: 'this.pingRegistry()' },
      { file: 'native/landlock-run/scripts/publish-release.mjs', operation: 'registryState(' },
    ]
    for (const { file, operation } of cases) {
      const source = readFileSync(resolve(root, file), 'utf8')
      const guard = source.lastIndexOf('assertPublicationIdentity(', source.lastIndexOf(operation))
      expect(guard, `${file} must call the identity firewall before ${operation}`).toBeGreaterThanOrEqual(0)
    }
    const baseline = readFileSync(resolve(root, 'scripts/publish-npm-baseline.ts'), 'utf8')
    const baselineGuard = baseline.slice(
      baseline.indexOf('assertPublicationIdentity('),
      baseline.indexOf('this.pingRegistry()'),
    )
    expect(baselineGuard).toContain('RELEASE_ENTRY_PACKAGE')

    const native = readFileSync(resolve(root, 'native/landlock-run/scripts/publish-release.mjs'), 'utf8')
    expect(native).toContain("from '../../../scripts/publication-identity.mjs'")
  })

  it('does not document a direct Landlock npm-publish bypass', () => {
    const releaseGuide = readFileSync(resolve(root, 'native/landlock-run/docs/release.md'), 'utf8')
    expect(releaseGuide).not.toMatch(/\bnpm publish\b/)
  })

  it('release verification fails for the ownership rule rather than a runtime wiring error', () => {
    const result = spawnSync(process.execPath, [
      '--import',
      'tsx/esm',
      resolve(root, 'scripts/release/verify.ts'),
      '--family',
      'dsh',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY: 'changanhua/deepseek-harness',
        RELEASE_PUBLISH: 'true',
      },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/@deepseek-ai\/dsh.*deepseek-ai\/deepseek-harness/)
    expect(result.stderr).not.toContain('ReferenceError')
  })
})

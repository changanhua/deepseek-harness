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
  it('classifies the current tree and gives every confirmed personal package a unique @changanhua target', () => {
    const registry = loadPackageIdentities(root)

    expect(checkPackageIdentities(root)).toEqual([])
    expect(registry.personalScope).toBe('@changanhua')
    expect(registry.personalPackages).toHaveLength(41)
    expect(new Set(registry.personalPackages.map(entry => entry.targetName)).size).toBe(41)
    expect(registry.personalPackages.every(entry => entry.origin === 'personal')).toBe(true)
    expect(registry.personalPackages.every(entry => entry.targetName.startsWith('@changanhua/'))).toBe(true)
    expect(registry.personalPackages.every(entry => entry.publishPolicy === 'blocked-until-rescoped')).toBe(true)
  })

  it('rejects a personal target outside the configured scope and duplicate targets', () => {
    const registry = loadPackageIdentities(root)
    const [first, second] = registry.personalPackages
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (first === undefined || second === undefined) return

    expect(validatePackageIdentityRegistry({
      ...registry,
      personalPackages: [
        { ...first, targetName: '@someone-else/dsh-personal-delivery' },
        { ...second, targetName: '@someone-else/dsh-personal-delivery' },
      ],
    })).toEqual(expect.arrayContaining([
      expect.stringMatching(/must start with @changanhua\//),
      expect.stringMatching(/duplicate target package name/),
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
        packageNames: [first.targetName],
        repository: 'changanhua/deepseek-harness',
      })
    }).toThrow(/blocked until its rescope/)
    expect(() => {
      assertPublicationIdentity({
        githubActions: 'true',
        packageNames: [first.targetName],
        repository: 'changanhua/deepseek-harness',
      }, {
        ...registry,
        personalPackages: [{ ...first, publishPolicy: 'personal' }],
      })
    }).not.toThrow()
    expect(() => {
      assertPublicationIdentity({
        githubActions: 'true',
        packageNames: [first.targetName],
        repository: 'deepseek-ai/deepseek-harness',
      })
    }).toThrow(new RegExp(`${first.targetName}.*changanhua/deepseek-harness`))
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
        packageNames: [first.targetName, '@deepseek-ai/dsh'],
        repository: 'changanhua/deepseek-harness',
      }, {
        ...registry,
        personalPackages: [{ ...first, publishPolicy: 'personal' }],
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

import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import {
  excludedFromPersonalRescope,
  loadPersonalPackageRenames,
  normalizePersonalManifest,
  personalPackageRenamesFromRegistry,
  rescopePersonalPackages,
  rewritePersonalPackageText,
  type PersonalPackageRename,
} from './rescope-personal-packages.ts'

const RENAMES: readonly PersonalPackageRename[] = [
  {
    directory: 'packages/delivery/delivery',
    legacyName: '@deepseek-ai/dsh-delivery',
    sourceName: '@changanhua/dsh-delivery',
  },
  {
    directory: 'packages/delivery/delivery-local',
    legacyName: '@deepseek-ai/dsh-delivery-local',
    sourceName: '@changanhua/dsh-delivery-local',
  },
]

describe('personal package rescope', () => {
  it('finds no eligible legacy package identity in the current checkout', () => {
    expect(rescopePersonalPackages(resolve(import.meta.dirname, '..'))).toEqual({ files: [], replacements: 0 })
  })

  it('rewrites complete package-name tokens, including subpaths, longest name first', () => {
    const result = rewritePersonalPackageText(
      "import '@deepseek-ai/dsh-delivery-local/client'\n"
      + "import '@deepseek-ai/dsh-delivery'\n"
      + 'const names = ["@deepseek-ai/dsh-delivery", "@deepseek-ai/dsh-delivery-local"]\n',
      RENAMES,
    )

    expect(result.text).toBe(
      "import '@changanhua/dsh-delivery-local/client'\n"
      + "import '@changanhua/dsh-delivery'\n"
      + 'const names = ["@changanhua/dsh-delivery", "@changanhua/dsh-delivery-local"]\n',
    )
    expect(result.replacements).toBe(4)
  })

  it('does not replace prefixes, prose fragments, or already-rescoped names', () => {
    const input = [
      '@deepseek-ai/dsh-delivery-locality',
      'prefix@deepseek-ai/dsh-delivery',
      '@deepseek-ai/dsh-delivery_suffix',
      '@changanhua/dsh-delivery',
    ].join('\n')

    expect(rewritePersonalPackageText(input, RENAMES)).toEqual({ text: input, replacements: 0 })
  })

  it('uses the registry-v3 sourceName and sourceIdentity fields', () => {
    expect(personalPackageRenamesFromRegistry({
      schemaVersion: 3,
      personalRepositoryUrl: 'git+https://github.com/changanhua/deepseek-harness.git',
      personalPackages: [{
        directory: 'packages/delivery/delivery',
        legacyName: '@deepseek-ai/dsh-delivery',
        sourceName: '@changanhua/dsh-delivery',
        sourceIdentity: 'personal',
      }],
    }).renames).toEqual(RENAMES.slice(0, 1))
    const currentRegistry = loadPersonalPackageRenames(resolve(import.meta.dirname, '..'))
    expect(currentRegistry.renames.every(rename => rename.legacyName.startsWith('@deepseek-ai/'))).toBe(true)
    expect(excludedFromPersonalRescope('downstream/package-identities.json')).toBe(true)
    expect(excludedFromPersonalRescope('pnpm-lock.yaml')).toBe(true)
    expect(excludedFromPersonalRescope('scripts/rescope-personal-packages.spec.ts')).toBe(true)
    expect(excludedFromPersonalRescope('docs/specs/release-contract.md')).toBe(true)
    expect(excludedFromPersonalRescope('docs/plans/rescope.md')).toBe(true)
    expect(excludedFromPersonalRescope('packages/client/ui-delivery/locales.i18n.yaml')).toBe(true)
    expect(excludedFromPersonalRescope('packages/client/ui-delivery/src/catalog.generated.ts')).toBe(true)
    expect(excludedFromPersonalRescope('.agents/notes/implemented/process/record.md')).toBe(true)
    expect(excludedFromPersonalRescope('docs/catalogs/commands.md')).toBe(true)
    expect(excludedFromPersonalRescope('packages/delivery/delivery/src/index.ts')).toBe(false)
    expect(excludedFromPersonalRescope('docs/cookbook/delivery.md')).toBe(false)
  })

  it('normalizes a registered manifest into a non-publishable personal source package', () => {
    const manifest = normalizePersonalManifest(JSON.stringify({
      name: '@deepseek-ai/dsh-delivery',
      publishConfig: { access: 'public' },
      repository: 'https://example.invalid/old.git',
      dependencies: { '@deepseek-ai/dsh-delivery-local': 'workspace:^' },
    }), RENAMES[0]!, 'git+https://github.com/changanhua/deepseek-harness.git', RENAMES)

    expect(JSON.parse(manifest)).toEqual({
      name: '@changanhua/dsh-delivery',
      dependencies: { '@changanhua/dsh-delivery-local': 'workspace:^' },
      private: true,
      repository: {
        type: 'git',
        url: 'git+https://github.com/changanhua/deepseek-harness.git',
        directory: 'packages/delivery/delivery',
      },
    })
  })
})

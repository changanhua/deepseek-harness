/** Experimental-package publication and dependency constraints. */

import { describe, expect, it } from 'vitest'
import {
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  checkWorkspaceManifest,
  expectedDshPackageFiles,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

const experimental: WorkspaceManifest = {
  dir: 'packages/experimental/prototype',
  manifest: { name: '@deepseek-ai/dsh-experimental-prototype', private: true },
}

describe('experimental workspace constraints', () => {
  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@deepseek-ai/dsh-prototype' },
    })).toEqual([
      '@deepseek-ai/dsh-prototype: experimental package name must start with "@deepseek-ai/dsh-experimental-"',
    ])
  })

  it('requires private manifests without publication metadata', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual([
      '@deepseek-ai/dsh-experimental-prototype: experimental package must set "private": true',
      '@deepseek-ai/dsh-experimental-prototype: experimental package must omit publishConfig',
    ])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'packages/core/consumer',
        manifest: {
          name: '@deepseek-ai/dsh-consumer',
          [section]: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@deepseek-ai/dsh-consumer: ${section}.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package`,
      ])
    },
  )

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'packages/core/test-only',
      manifest: {
        name: '@deepseek-ai/dsh-test-only',
        devDependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'packages/experimental/consumer',
      manifest: {
        name: '@deepseek-ai/dsh-experimental-consumer',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'python/sdk-runtime',
      manifest: {
        name: '@deepseek-ai/dsh-python-runtime',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@deepseek-ai/dsh-python-runtime: dependencies.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package',
    ])
  })
})

describe('package payload constraints', () => {
  it('includes a declared profile patch without a package-name allowlist', () => {
    expect(expectedDshPackageFiles({
      name: '@deepseek-ai/dsh-private-profile',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })).toEqual([
      'lib/index.js',
      'lib/invariant.js',
      'cordis.patch.yml',
      'lib/types/**/*.d.ts',
    ])
  })

  it('keys personal payload exceptions by stable source directory', () => {
    expect(expectedDshPackageFiles({ name: '@changanhua/dsh-task-queue-executor-dsh' },
      'packages/task-queue/task-queue-executor-dsh')).toContain('worker.cordis.patch.yml')
  })

  it('keeps rescoped personal packages private while applying the DSH package shape', () => {
    const manifest = {
      name: '@changanhua/dsh-task-queue',
      version: '9.8.7-personal.1',
      private: true,
      type: 'module',
      main: 'lib/index.js',
      types: 'lib/types/index.d.ts',
      exports: {
        '.': {
          types: './lib/types/index.d.ts',
          default: './lib/index.js',
        },
      },
      files: [
        'lib/index.js',
        'lib/invariant.js',
        'lib/brand.js',
        'lib/types/**/*.d.ts',
      ],
      repository: {
        type: 'git',
        url: 'git+https://github.com/changanhua/deepseek-harness.git',
        directory: 'packages/task-queue/task-queue',
      },
      peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
      devDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
    }

    expect(checkWorkspaceManifest({ dir: 'packages/task-queue/task-queue', manifest })).toEqual([])
    expect(checkWorkspaceManifest({
      dir: 'packages/task-queue/task-queue',
      manifest: { ...manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual(expect.arrayContaining([
      expect.stringMatching(/personal source package must set \"private\": true/),
      expect.stringMatching(/personal source package must omit publishConfig/),
    ]))
  })
})

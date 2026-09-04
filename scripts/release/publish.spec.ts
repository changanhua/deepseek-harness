/** Publish-time validation of a packed release against the current checkout. */

import { describe, expect, it } from 'vitest'
import { releaseFamily, type ReleaseMember } from './families.ts'
import { assertPackedReleaseEntries, expectedPackedReleaseEntries } from './publish.ts'

/** A synthetic release member with the fields publish validation consumes. */
function member(
  directory: string,
  name: string,
  version = '0.0.1',
  manifest: Record<string, unknown> = {},
): ReleaseMember {
  return { directory, name, version, manifest }
}

describe('release publish preflight', () => {
  it('blocks an official publish when the current source closure reaches a personal package', () => {
    const official = member('packages/a/official', '@deepseek-ai/dsh-official', '0.0.1', {
      dependencies: { '@changanhua/dsh-personal': 'workspace:^' },
    })

    expect(() => expectedPackedReleaseEntries(releaseFamily('dsh'), [official]))
      .toThrow(/@deepseek-ai\/dsh-official.*@changanhua\/dsh-personal.*source-only/)
  })

  it('blocks a same-name same-version tarball whose manifest reaches a personal package', () => {
    const family = releaseFamily('dsh')
    const official = member('packages/a/official', '@deepseek-ai/dsh-official')
    const expected = expectedPackedReleaseEntries(family, [official])
    const packed = [{
      ...expected[0]!,
      manifest: { dependencies: { '@changanhua/dsh-personal': '0.0.1' } },
    }]

    expect(() => { assertPackedReleaseEntries(family, expected, packed) })
      .toThrow(/@deepseek-ai\/dsh-official.*@changanhua\/dsh-personal.*source-only/)
  })

  it('requires the packed set, order, filename, name, and version to match the current family', () => {
    const family = releaseFamily('vendor')
    const library = member('vendor/library', '@deepseek-ai/library', '1.2.3')
    const consumer = member('vendor/consumer', '@deepseek-ai/consumer', '4.5.6', {
      dependencies: { '@deepseek-ai/library': '^1.2.3' },
    })
    const expected = expectedPackedReleaseEntries(family, [consumer, library])

    expect(expected.map(({ filename, name, version }) => ({ filename, name, version }))).toEqual([
      { filename: 'deepseek-ai-library-1.2.3.tgz', name: '@deepseek-ai/library', version: '1.2.3' },
      { filename: 'deepseek-ai-consumer-4.5.6.tgz', name: '@deepseek-ai/consumer', version: '4.5.6' },
    ])
    expect(() => { assertPackedReleaseEntries(family, expected, expected) }).not.toThrow()

    expect(() => { assertPackedReleaseEntries(family, expected, expected.slice(0, 1)) }).toThrow(/expected 2.*got 1/)
    expect(() => { assertPackedReleaseEntries(family, expected, [...expected].reverse()) }).toThrow(/position 1/)
    expect(() => {
      assertPackedReleaseEntries(family, expected, [
        { ...expected[0]!, filename: 'manual.tgz' },
        expected[1]!,
      ])
    }).toThrow(/filename/)
    expect(() => {
      assertPackedReleaseEntries(family, expected, [
        { ...expected[0]!, name: '@deepseek-ai/other' },
        expected[1]!,
      ])
    }).toThrow(/package name/)
    expect(() => {
      assertPackedReleaseEntries(family, expected, [
        { ...expected[0]!, version: '1.2.2' },
        expected[1]!,
      ])
    }).toThrow(/version/)
  })
})

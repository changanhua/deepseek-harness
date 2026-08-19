// @vitest-environment jsdom
/**
 * Skill grouping rules for the Capability Skills tab: prefixes with at least
 * GROUP_MIN_MEMBERS items become collapsible groups, smaller prefixes fold
 * into the flat "other" bucket, and groups order by descending size. The
 * grouping function is pure so it is tested directly.
 */
import { describe, expect, it } from 'vitest'
import { buildSkillGroups } from '../src/client/CapabilityWorkspace.tsx'

const t = ((key: string) => {
  const dict: Record<string, string> = { 'skill.group.other': '其他' }
  return dict[key] ?? key
}) as (key: string) => string

function skill(name: string): never {
  return {
    key: { kind: 'skill', name },
    title: name,
    subtitle: `desc of ${name}`,
    tags: ['user-dsh', 'filesystem'],
  } as never
}

describe('buildSkillGroups', () => {
  it('keeps a prefix with 4+ members as one collapsible group', () => {
    const rows = ['arkcli-a', 'arkcli-b', 'arkcli-c', 'arkcli-d'].map(skill)
    const groups = buildSkillGroups(rows, t)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: 'arkcli', count: 4, collapsible: true })
  })

  it('folds sub-threshold prefixes into the flat other bucket', () => {
    const rows = ['gh-cli', 'lark-cli'].map(skill)
    const groups = buildSkillGroups(rows, t)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: 'other', count: 2, collapsible: false })
  })

  it('keeps the other bucket flat when a prefix stays under the threshold', () => {
    const rows = [
      skill('arkcli-a'),
      skill('arkcli-b'),
      skill('arkcli-c'),
      skill('gh-cli'),
    ]
    const groups = buildSkillGroups(rows, t)
    // 3-member arkcli prefix drops into other; no collapsible group exists.
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: 'other', count: 4, collapsible: false })
  })

  it('orders named groups by descending count and places other last', () => {
    const rows = [
      skill('byted-x'),
      skill('byted-y'),
      skill('byted-z'),
      skill('byted-w'),
      skill('arkcli-1'),
      skill('arkcli-2'),
      skill('arkcli-3'),
      skill('arkcli-4'),
      skill('arkcli-5'),
      skill('solo-1'),
    ]
    const groups = buildSkillGroups(rows, t)
    expect(groups.map(g => g.key)).toEqual(['arkcli', 'byted', 'other'])
    expect(groups[0]).toMatchObject({ count: 5, collapsible: true })
    expect(groups[1]).toMatchObject({ count: 4, collapsible: true })
    expect(groups[2]).toMatchObject({ key: 'other', count: 1, collapsible: false })
  })

  it('omits the other bucket when every skill fits a named group', () => {
    const rows = ['arkcli-1', 'arkcli-2', 'arkcli-3', 'arkcli-4'].map(skill)
    const groups = buildSkillGroups(rows, t)
    expect(groups.map(g => g.key)).toEqual(['arkcli'])
  })

  it('ignores non-skill items', () => {
    const rows = [
      skill('arkcli-1'),
      skill('arkcli-2'),
      skill('arkcli-3'),
      skill('arkcli-4'),
      { key: { kind: 'tool', name: 'write' }, title: 'write', subtitle: '', tags: [] } as never,
    ]
    const groups = buildSkillGroups(rows, t)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: 'arkcli', count: 4 })
  })

  it('returns an empty list for no skills', () => {
    expect(buildSkillGroups([], t)).toEqual([])
  })
})

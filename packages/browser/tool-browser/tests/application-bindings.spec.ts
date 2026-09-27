import { describe, expect, it } from 'vitest'
import { bindSnapshotControls } from '../src/application-bindings.ts'
import type { BrowserBindingRequest } from '../src/types.ts'

const page = { tabId: 3, frameId: 0, documentId: 'doc', url: 'https://github.com/team/repo/issues/new' }
const field = { snapshotId: 'snapshot', elementId: 'title', role: 'textbox', tag: 'input', label: 'Add a title',
  attributes: { name: 'issue[title]' }, state: { disabled: false, readOnly: false } }
const receipt = { outcome: 'observed' as const, requestId: 'read', installationId: 'chrome',
  value: { page, snapshotId: 'snapshot', offset: 0, nextOffset: null, elementsTruncated: false, scanTruncated: false,
    textScope: 'page', elements: [field] } }
const binding: BrowserBindingRequest = { key: 'issue.title', pageUrl: page.url,
  alternatives: [{ role: 'textbox', tag: 'input', name: 'issue[title]' }] }

describe('application meanings bound to a fresh browser snapshot', () => {
  it('retains the exact read source and tolerates wording changes without inventing a reference', () => {
    const result = bindSnapshotControls(receipt, [binding])
    expect(result.source).toEqual({ requestId: 'read', installationId: 'chrome', page, snapshotId: 'snapshot' })
    expect(result.results).toEqual([{ key: 'issue.title', status: 'bound', matchCount: 1,
      candidates: [{ page, snapshotId: 'snapshot', elementId: 'title' }] }])
  })

  it('reports repeated controls as ambiguous and uses context only when supplied explicitly', () => {
    const duplicate = { ...field, elementId: 'comment-title', context: 'Comment form' }
    const observation = { ...receipt, value: { ...receipt.value, elements: [{ ...field, context: 'New issue' }, duplicate] } }
    expect(bindSnapshotControls(observation, [binding]).results[0]?.status).toBe('ambiguous')
    expect(bindSnapshotControls(observation, [{ ...binding, alternatives: [{ ...binding.alternatives[0]!, context: 'New issue' }] }]).results[0])
      .toMatchObject({ status: 'bound', candidates: [{ elementId: 'title' }] })
  })

  it.each([
    { scanTruncated: true }, { elementsTruncated: true }, { nextOffset: 64 }, { offset: 10 }, { textScope: 'matched-controls' },
  ])('does not claim uniqueness on a partial read: %j', (partial) => {
    expect(bindSnapshotControls({ ...receipt, value: { ...receipt.value, ...partial } }, [binding]).results[0]?.status).toBe('incomplete')
  })

  it('requires exact page scope, including repository and query', () => {
    for (const url of ['https://github.com/other/repo/issues/new', `${page.url}?template=bug`]) {
      expect(bindSnapshotControls(receipt, [{ ...binding, pageUrl: url }]).results[0]?.status).toBe('page-mismatch')
    }
  })

  it('rejects failed reads and mixed or repeated snapshot references', () => {
    expect(bindSnapshotControls({ ...receipt, outcome: 'unknown' }, [binding]).source).toBeNull()
    for (const elements of [[{ ...field, snapshotId: 'old' }], [field, field]]) {
      expect(bindSnapshotControls({ ...receipt, value: { ...receipt.value, elements } }, [binding]).results[0]?.status).toBe('unavailable')
    }
  })

  it('does not select a disabled or readonly field', () => {
    for (const state of [{ disabled: true }, { readOnly: true }]) {
      expect(bindSnapshotControls({ ...receipt, value: { ...receipt.value, elements: [{ ...field, state }] } }, [binding]).results[0]?.status).toBe('missing')
    }
  })

  it('deduplicates matching alternatives and resolves links only within their exact observed URL', () => {
    const link = { ...field, role: 'link', attributes: { href: '/team/repo/issues' } }
    const alternatives = [{ role: 'link', href: 'https://github.com/team/repo/issues' }, { role: 'link', href: '/team/repo/issues' }]
    expect(bindSnapshotControls({ ...receipt, value: { ...receipt.value, elements: [link] } }, [{ ...binding, alternatives }]).results[0])
      .toMatchObject({ status: 'bound', matchCount: 1 })
    expect(bindSnapshotControls({ ...receipt, value: { ...receipt.value, elements: [{ ...link, attributes: { href: 'https://example.org/team/repo/issues' } }] } },
      [{ ...binding, alternatives }]).results[0]?.status).toBe('missing')
  })

  it('bounds duplicate definitions and ambiguous candidate lists', () => {
    expect(() => bindSnapshotControls(receipt, [binding, binding])).toThrow('Invalid browser binding descriptors')
    const oversized = Array.from({ length: 16 }, (_, index) => ({ ...binding, key: `field-${index}`,
      alternatives: Array.from({ length: 4 }, () => ({ role: 'textbox', label: '中文'.repeat(128) })) }))
    expect(() => bindSnapshotControls(receipt, oversized)).toThrow('Invalid browser binding descriptors')
    const elements = Array.from({ length: 12 }, (_, index) => ({ ...field, elementId: `title-${index}` }))
    const result = bindSnapshotControls({ ...receipt, value: { ...receipt.value, elements } }, [binding]).results[0]!
    expect(result.matchCount).toBe(12)
    expect(result.candidates).toHaveLength(4)
  })
})

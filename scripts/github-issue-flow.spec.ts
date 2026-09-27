import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = await readFile(new URL('../.agents/skills/github-issues/scripts/issue-flow.js', import.meta.url), 'utf8')
const run = new Function(`${source}\nreturn runGitHubIssueFlow`)()
const model = JSON.parse(await readFile(new URL('../.agents/skills/github-issues/references/application-model.json', import.meta.url), 'utf8'))
const root = 'https://github.test/team/repo'
const input = { repository: root, title: 'Exact issue title', body: '  First line\n\nSecond line  ', submit: true }
const query = `is:issue in:title "${input.title}"`
const searchUrl = `${root}/issues?q=${encodeURIComponent(query)}`

type FixtureOptions = {
  duplicate?: boolean
  incomplete?: boolean
  wrongCountQuery?: boolean
  duplicateField?: boolean
  readbackMismatch?: boolean
  unknown?: boolean
  recoveryFails?: boolean
  choose?: boolean
  validation?: boolean
}
type FlowAction = { kind: string; element?: { elementId: string }; value?: string; url?: string }

function fixture(options: FixtureOptions = {}) {
  let page = { tabId: 1, frameId: 0, documentId: 'search', url: searchUrl }, counter = 0, submits = 0
  const fields = { title: '', body: '' }
  const actions: FlowAction[] = [], queries: string[] = []
  const receipt = (value: unknown) => ({ outcome: 'observed', installationId: 'installation', requestId: `r${++counter}`, value })
  const snapshot = (values: boolean) => {
    const snapshotId = `s${counter}`
    const element = (id: string, role: string, attributes: Record<string, string>, label = '', extra = {}) => ({
      elementId: id, snapshotId, role, tag: role === 'textbox' ? id === 'body' ? 'textarea' : 'input' : role === 'link' ? 'a' : 'button',
      attributes, label, state: {}, ...extra,
    })
    let elements: unknown[] = [], text = ''
    if (page.documentId === 'search') {
      const q = options.wrongCountQuery ? 'is:issue' : query
      elements = ['open', 'closed'].map(state => element(state, 'link', { href: `${root}/issues?q=${encodeURIComponent(`${q} state:${state}`)}` }, `${state} (0)`))
      elements.push(element('new', 'link', { href: `${root}/issues/new${options.choose ? '/choose' : ''}` }, 'New issue'))
      if (options.duplicate) elements.push(element('duplicate', 'link', { href: `${root}/issues/9` }, input.title))
    } else if (page.documentId === 'new') {
      elements = [element('title', 'textbox', { name: 'title' }, 'Title', values ? { value: options.readbackMismatch ? 'changed' : fields.title, valueTruncated: false } : {}),
        element('body', 'textbox', { name: 'body' }, 'Body', values ? { value: fields.body, valueTruncated: false } : {}),
        element('submit', 'button', { type: 'submit' }, 'Create issue')]
      if (options.duplicateField) elements.push(element('other-title', 'textbox', { name: 'title' }, 'Other title'))
    } else text = `${input.title} Created`
    return { page, snapshotId, elements, offset: 0, nextOffset: options.incomplete ? 128 : null,
      elementsTruncated: !!options.incomplete, scanTruncated: false, textScope: 'page', textTruncated: false, text }
  }
  const io = {
    read: async (_page: unknown, values: boolean) => receipt(snapshot(values)),
    act: async (action: FlowAction) => {
      actions.push(action)
      if (action.kind === 'navigate') page = { ...page, documentId: 'detail', url: action.url! }
      if (action.kind === 'fill') fields[action.element!.elementId as keyof typeof fields] = action.value!
      if (action.element?.elementId === 'new') page = { ...page, documentId: options.choose ? 'choose' : 'new', url: `${root}/issues/new${options.choose ? '/choose' : ''}` }
      if (action.element?.elementId === 'submit') {
        submits++
        if (options.unknown) return { outcome: 'unknown', requestId: 'submission-id', reason: 'connection_lost' }
        if (!options.validation) page = { ...page, documentId: 'detail', url: `${root}/issues/10` }
      }
      return receipt({ transition: { sameTab: { kind: 'unchanged', page } } })
    },
    status: async (id: string) => { queries.push(id); if (options.recoveryFails) throw new Error('unavailable'); return { outcome: 'unknown' } },
  }
  return { io, run: (overrides = {}) => run(io, model, { ...input, page, ...overrides }), actions, queries, submitted: () => submits }
}

describe('GitHub Issue caller-owned deterministic flow', () => {
  it('rejects an issue-list path supplied as a repository root before any action', async () => {
    const test = fixture()
    await expect(test.run({ repository: `${root}/issues` })).rejects.toThrow('invalid_repository')
    expect(test.actions).toEqual([])
  })
  it('fills both fields, explicitly reads exact multiline values, submits once and returns detail for Agent verification', async () => {
    const test = fixture()
    const result = await test.run()
    expect(result).toMatchObject({ status: 'submitted-readback-required', detailUrl: `${root}/issues/10`, search: { query, open: 0, closed: 0 } })
    expect(test.actions.filter(action => action.kind === 'fill').map(action => action.value)).toEqual([input.title, input.body])
    expect(test.submitted()).toBe(1)
  })
  it('returns a verified draft without submitting when the user requested draft only', async () => {
    const test = fixture()
    expect(await test.run({ submit: false })).toMatchObject({ status: 'draft-verified' })
    expect(test.submitted()).toBe(0)
  })
  it('reads an exact matching existing issue and preserves its search request source', async () => {
    const test = fixture({ duplicate: true })
    expect(await test.run()).toMatchObject({ status: 'existing', url: `${root}/issues/9`, search: { requestId: 'r1' } })
    expect(test.actions).toHaveLength(1)
    expect(test.submitted()).toBe(0)
  })
  it.each([
    [{ incomplete: true }, 'incomplete_duplicate_search'],
    [{ wrongCountQuery: true }, 'duplicate_search_requires_comparison'],
    [{ duplicateField: true }, 'ambiguous_binding:issue.title'],
    [{ readbackMismatch: true }, 'form_readback_mismatch'],
    [{ choose: true }, 'template_selection_required'],
  ])('hands unresolved conditions to the Agent without submitting: %s', async (options, reason) => {
    const test = fixture(options)
    expect(await test.run()).toMatchObject({ status: 'needs-agent', reason })
    expect(test.submitted()).toBe(0)
  })
  it.each([false, true])('queries the original unknown request and never resubmits, even if recovery fails (%s)', async (recoveryFails) => {
    const test = fixture({ unknown: true, recoveryFails })
    const result = await test.run()
    expect(result).toMatchObject({ status: 'needs-agent', stage: 'submit', failed: { requestId: 'submission-id', outcome: 'unknown' } })
    expect(result).toStrictEqual(JSON.parse(JSON.stringify(result)))
    expect(test.queries).toEqual(['submission-id'])
    expect(test.submitted()).toBe(1)
  })
  it('returns a validation page for Agent takeover instead of assuming creation or resubmitting', async () => {
    const test = fixture({ validation: true })
    expect(await test.run()).toMatchObject({ status: 'submitted-readback-required', detailUrl: null })
    expect(test.submitted()).toBe(1)
  })
})

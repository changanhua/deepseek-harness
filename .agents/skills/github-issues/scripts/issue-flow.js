/** Caller-owned flow: all effects use the caller's existing browser tools and request owner. */
async function runGitHubIssueFlow(io, model, input) {
  // This recipe accepts canonical GitHub-style repository roots; unfamiliar URL forms need the Agent.
  const address = /^(https?:\/\/[a-z\d.-]+(?::\d+)?)(\/[a-z\d._-]+\/[a-z\d._-]+)$/iu.exec(input.repository)
  if (!address || address[2].split('/').some(part => part === '.' || part === '..')) throw new Error('invalid_repository')
  const repository = { origin: address[1], pathname: address[2] }
  if (typeof input.title !== 'string' || !input.title.trim() || /[\r\n]/u.test(input.title)
    || typeof input.body !== 'string' || typeof input.submit !== 'boolean') throw new Error('invalid_issue_input')
  const root = input.repository, issues = `${root}/issues`
  // Broad search is safe for titles whose quoting needs site-specific interpretation.
  const query = /["\\]/u.test(input.title) ? 'is:issue' : `is:issue in:title "${input.title}"`
  const searchUrl = `${issues}?q=${encodeURIComponent(query)}`
  const normalize = text => typeof text === 'string' ? text.trim().replace(/\s+/gu, ' ').toLowerCase() : ''
  const absolute = href => typeof href === 'string'
    ? href.startsWith('/') && !href.startsWith('//') ? repository.origin + href : href : ''
  const searchQuery = href => {
    const url = absolute(href)
    if (!url.startsWith(`${issues}?q=`)) return null
    const encoded = url.slice(`${issues}?q=`.length)
    if (/[&#?]/u.test(encoded)) return null
    try { return decodeURIComponent(encoded.replaceAll('+', ' ')) } catch { return null }
  }
  const pageEqual = (a, b) => a && b && ['tabId', 'frameId', 'documentId', 'url'].every(key => a[key] === b[key])
  let stage = 'search', page = input.page, latest, search, submission, lastAction
  const receipts = []
  const stop = (reason, extra = {}) => JSON.parse(JSON.stringify({ status: 'needs-agent', stage, reason, page, receipts, ...extra }))
  const checked = async (receipt) => {
    if (!receipt || receipt.outcome !== 'observed') {
      let recovery
      if (receipt?.outcome === 'unknown' && receipt.requestId) {
        try { recovery = await io.status(receipt.requestId) } catch { recovery = { status: 'unavailable' } }
      }
      throw Object.assign(new Error(receipt?.reason ?? 'browser_result_unavailable'), { receipt, recovery })
    }
    receipts.push({ requestId: receipt.requestId, outcome: receipt.outcome })
    return receipt
  }
  const read = async (values = false) => {
    latest = await checked(await io.read(page, values))
    if (!pageEqual(latest.value?.page, page)) throw new Error('page_changed')
    return latest.value
  }
  const act = async (action) => {
    const result = await checked(await io.act(action))
    lastAction = result
    const transition = result.value?.transition?.sameTab
    if (transition?.page) page = transition.page
    if (transition?.kind === 'unavailable') throw new Error('page_transition_unavailable')
    if (io.afterAction) await io.afterAction(result)
    return result
  }
  const complete = snapshot => snapshot?.offset === 0 && snapshot.nextOffset === null
    && snapshot.elementsTruncated === false && snapshot.scanTruncated === false && snapshot.textScope === 'page'
    && Array.isArray(snapshot.elements) && typeof snapshot.snapshotId === 'string'
    && snapshot.elements.every(element => element.snapshotId === snapshot.snapshotId && typeof element.elementId === 'string')
  const binding = (snapshot, pageKind, key) => {
    if (!complete(snapshot)) throw new Error('incomplete_binding_observation')
    const meanings = model.pages[pageKind]?.controls[key]
    if (!meanings) throw new Error(`missing_application_control:${key}`)
    const found = snapshot.elements.filter(element => element.state?.disabled !== true && element.state?.readOnly !== true
      && meanings.some(description => Object.entries(description).every(([field, expected]) => {
        const value = expected.replaceAll('{repository}', root)
        if (field === 'href') {
          return absolute(element.attributes?.href) === value
        }
        if (field === 'name' || field === 'type') return element.attributes?.[field] === value
        return normalize(element[field]) === normalize(value)
      })))
    if (found.length !== 1) throw new Error(`${found.length ? 'ambiguous' : 'missing'}_binding:${key}`)
    const element = found[0]
    return { control: element, ref: { page: snapshot.page, snapshotId: snapshot.snapshotId, elementId: element.elementId } }
  }
  const detailUrl = href => {
    const url = absolute(href)
    return url.startsWith(`${issues}/`) && /^[1-9]\d*$/u.test(url.slice(`${issues}/`.length)) ? url : null
  }
  try {
    if (searchQuery(page.url) !== query) await act({ kind: 'navigate', page, url: searchUrl })
    const snapshot = await read()
    const searchRequestId = latest.requestId
    if (searchQuery(page.url) !== query) return stop('search_scope_mismatch')
    const existing = snapshot.elements?.filter(element => element.role === 'link' && element.label === input.title
      && detailUrl(element.attributes?.href)) ?? []
    if (existing.length) {
      const urls = [...new Set(existing.map(element => detailUrl(element.attributes.href)))]
      if (urls.length !== 1) return stop('multiple_matching_issues', { matches: urls })
      const url = urls[0]
      await act({ kind: 'navigate', page, url })
      const detail = await read()
      if (page.url !== url || !normalize(detail.text).includes(normalize(input.title))) return stop('existing_detail_unconfirmed')
      return { status: 'existing', url, search: { requestId: searchRequestId, query, title: input.title }, readback: latest, receipts }
    }
    if (!complete(snapshot) || snapshot.textTruncated !== false) return stop('incomplete_duplicate_search')
    const counts = ['open', 'closed'].map(state => {
      const candidates = snapshot.elements.filter(element => {
        if (element.role !== 'link') return false
        return searchQuery(element.attributes?.href) === `${query} state:${state}`
      })
      if (candidates.length !== 1) return null
      const found = new RegExp(`^${state}\\s*\\(\\s*(\\d+)\\s*\\)$`, 'iu').exec(candidates[0].label)
      return found ? Number(found[1]) : null
    })
    // Nonzero result sets, pagination and unfamiliar counters need explicit Agent comparison.
    if (counts.some(count => count !== 0)) return stop('duplicate_search_requires_comparison', { counts, readback: latest })
    search = { requestId: latest.requestId, page, query, title: input.title, open: 0, closed: 0 }
    stage = 'open-form'
    const newIssue = binding(snapshot, 'issues', 'issue.new')
    await act({ kind: 'click', element: newIssue.ref, intent: '打开已查重的目标仓库 Issue 表单' })
    let form = await read()
    if (page.url === `${issues}/new/choose`) return stop('template_selection_required', { search, readback: latest })
    if (page.url !== `${issues}/new`) return stop('issue_form_unrecognized', { search, readback: latest })
    stage = 'fill'
    const title = binding(form, 'new', 'issue.title'), body = binding(form, 'new', 'issue.body')
    binding(form, 'new', 'issue.submit')
    const formPage = page
    for (const [target, value] of [[title, input.title], [body, input.body]]) {
      await act({ kind: 'fill', element: target.ref, value, intent: '填写用户指定的 Issue 内容' })
      if (!pageEqual(page, formPage)) return stop('form_changed_during_fill', { search })
    }
    stage = 'readback'
    form = await read(true)
    if (!pageEqual(page, formPage)) return stop('form_changed_before_readback', { search })
    for (const [key, expected] of [['issue.title', input.title], ['issue.body', input.body]]) {
      const actual = binding(form, 'new', key).control
      if (actual.valueRedacted || actual.valueTruncated !== false || actual.value !== expected) return stop('form_readback_mismatch', { key, search, readback: latest })
    }
    if (!input.submit) return { status: 'draft-verified', page, search, readback: latest, receipts }
    stage = 'submit'
    const submit = binding(form, 'new', 'issue.submit')
    submission = await act({ kind: 'click', element: submit.ref, intent: '按用户创建要求提交已逐字回读的 Issue，仅提交一次' })
    stage = 'detail'
    await read()
    return { status: 'submitted-readback-required', page, search, submission, readback: latest, receipts,
      detailUrl: detailUrl(page.url) }
  } catch (error) {
    return stop(error instanceof Error ? error.message : 'flow_failed', { search, submission,
      failed: error?.receipt, recovery: error?.recovery, lastAction, readback: latest })
  }
}

// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { installSessionDeepLink } from '../src/client/deep-link.ts'

afterEach(() => { history.replaceState({}, '', '/'); vi.restoreAllMocks() })
test('waits for a listed ordinary Session and opens that identity once', () => {
  const id = SessionId('session-requested')
  let snapshot = { ids: [] as typeof id[], byId: {} as Record<string, { origin?: string; sessionId?: typeof id }> }
  let changed = () => {}
  const open = vi.fn()
  history.replaceState({}, '', '/#session=session-requested')
  const remove = installSessionDeepLink({ list: { getSnapshot: () => snapshot,
    subscribe: (fn) => { changed = fn; return () => { changed = () => {} } } }, open }, window)
  expect(open).not.toHaveBeenCalled()
  snapshot = { ids: [id], byId: { [id]: { sessionId: id } } }
  changed(); changed()
  expect(open).toHaveBeenCalledExactlyOnceWith(id)
  remove()
})
test('ignores subagent and unrelated hashes and detaches navigation on disposal', () => {
  const id = SessionId('child')
  const open = vi.fn()
  const session = { list: { getSnapshot: () => ({ ids: [id], byId: { [id]: { origin: 'subagent' } } }), subscribe: () => () => {} }, open }
  const remove = installSessionDeepLink(session, window)
  location.hash = '#session=child'; window.dispatchEvent(new Event('hashchange'))
  location.hash = '#content-entry=other'; window.dispatchEvent(new Event('hashchange'))
  expect(open).not.toHaveBeenCalled()
  remove(); location.hash = '#session=child'; window.dispatchEvent(new Event('hashchange'))
  expect(open).not.toHaveBeenCalled()
})
test('an explicit return to the same Session is handled again without reopening on list refresh', () => {
  const id = SessionId('return-session'); const open = vi.fn(); let changed = () => {}
  history.replaceState({}, '', '/#session=return-session')
  const remove = installSessionDeepLink({ list: { getSnapshot: () => ({ ids: [id], byId: { [id]: {} } }),
    subscribe: (fn) => { changed = fn; return () => {} } }, open }, window)
  changed(); expect(open).toHaveBeenCalledTimes(1)
  history.replaceState({}, '', '/#content-entry=other'); window.dispatchEvent(new Event('hashchange'))
  history.replaceState({}, '', '/#session=return-session'); window.dispatchEvent(new Event('hashchange'))
  changed(); expect(open).toHaveBeenCalledTimes(2)
  remove()
})

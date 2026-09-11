/** @vitest-environment jsdom */
import { describe, expect, test, vi } from 'vitest'
import { renderMonitors } from '../src/sidebar-monitors.js'

const page = { tabId: 1, url: 'https://example.test/a', title: '<img src=x>' }
const state = (monitoring: Record<string, unknown> = {}) => ({
  page,
  connection: { phase: 'connected', baseUrl: 'https://dsh.test', grant: { installationId: 'installation',
    scopes: ['session:interact', 'browser:read', 'browser:observe'], origins: ['https://example.test'] } },
  session: { binding: { baseUrl: 'https://dsh.test', installationId: 'installation', sessionId: 'session-1' } },
  monitoring: { phase: 'ready', monitors: [], pendingCreate: null, error: null, ...monitoring },
})
const monitor = () => ({ id: 'm', revision: 'r', sessionId: 'original-session', title: '监控', url: 'https://example.test/original',
  enabled: true, match: { kind: 'changed' }, nextDue: 1000, outbox: [{ id: 'n', kind: 'changed', message: '通知', createdAt: 1000 }] })
const setup = (value = state()) => {
  const panel = document.createElement('section'); document.body.replaceChildren(panel)
  const sent: unknown[] = []
  const send = vi.fn(async (message: unknown) => { sent.push(message); return { ok: true, state: value } })
  renderMonitors(panel, value, send, vi.fn())
  return { panel, sent, send }
}
function action(panel: HTMLElement, label: string): HTMLButtonElement {
  const node = [...panel.querySelectorAll('button')].find(button => button.textContent === label)
  if (!node) throw new Error('missing button: ' + label)
  return node
}
function field(panel: HTMLElement, id: string): HTMLInputElement {
  const node = panel.querySelector('#' + id)
  if (!(node instanceof HTMLInputElement)) throw new Error('missing input: ' + id)
  return node
}

describe('sidebar monitors', () => {
  test('renders page and notification text as textContent', () => {
    const { panel } = setup(state({ monitors: [{ ...monitor(), title: '<script>x</script>', outbox: [{ id: 'n', message: '<img src=x>' }] }] }))
    expect(panel.textContent).toContain('<script>x</script>')
    expect(panel.textContent).toContain('<img src=x>')
    expect(panel.querySelector('script, img')).toBeNull()
  })

  test('sends a bounded create payload and suppresses repeated clicks while sending', async () => {
    const fixture = setup()
    field(fixture.panel, 'monitor-title').value = 'check'
    field(fixture.panel, 'monitor-minutes').value = '2'
    const create = action(fixture.panel, '创建监控')
    create.click(); create.click(); await Promise.resolve()
    expect(fixture.sent).toEqual([{ type: 'dsh-assistant-monitor-create', page,
      input: { title: 'check', intervalMs: 120000, missedPolicy: 'latest', match: { kind: 'changed' } } }])
    field(fixture.panel, 'monitor-once').click()
    create.click(); await Promise.resolve()
    expect(fixture.sent[1]).toMatchObject({ input: { intervalMs: null } })
  })

  test('pending creation names its original target and still exposes existing notifications', async () => {
    const fixture = setup(state({ monitors: [monitor()], pendingCreate: { baseUrl: 'https://dsh.test', installationId: 'installation',
      input: { url: 'https://fixed.test', sessionId: 'old-session' } } }))
    expect(fixture.panel.textContent).toContain('https://fixed.test')
    expect(fixture.panel.textContent).toContain('old-session')
    expect(action(fixture.panel, '创建监控').disabled).toBe(true)
    action(fixture.panel, '重试原请求').click(); action(fixture.panel, '已读').click(); await Promise.resolve()
    expect(fixture.sent).toContainEqual({ type: 'dsh-assistant-monitor-retry' })
    expect(fixture.sent).toContainEqual({ type: 'dsh-assistant-monitor-acknowledge', id: 'm', noticeId: 'n' })
  })

  test('uses original ids and viewed revisions for controls and opens the notification owner session', async () => {
    const fixture = setup(state({ monitors: [monitor()] }))
    action(fixture.panel, '暂停').click(); action(fixture.panel, '已读').click(); action(fixture.panel, '打开所属会话').click()
    await Promise.resolve()
    expect(fixture.sent).toContainEqual({ type: 'dsh-assistant-monitor-pause', id: 'm', revision: 'r' })
    expect(fixture.sent).toContainEqual({ type: 'dsh-assistant-monitor-acknowledge', id: 'm', noticeId: 'n' })
    expect(fixture.sent).toContainEqual({ type: 'dsh-assistant-open-monitor-session', id: 'm' })
    renderMonitors(fixture.panel, state({ monitors: [{ ...monitor(), authorizationChanged: true }] }), fixture.send, vi.fn())
    action(fixture.panel, '恢复').click(); await Promise.resolve()
    expect(fixture.sent).toContainEqual({ type: 'dsh-assistant-monitor-resume', id: 'm', revision: 'r' })
  })

  test('phase refreshes, new notices, and page changes preserve typed form values and focus', () => {
    const fixture = setup()
    const title = field(fixture.panel, 'monitor-title')
    title.value = '我的条件'; title.dispatchEvent(new Event('input')); title.focus()
    const minutes = field(fixture.panel, 'monitor-minutes'); minutes.value = '5'
    renderMonitors(fixture.panel, state({ phase: 'syncing' }), fixture.send, vi.fn())
    expect(document.activeElement).toBe(title)
    const changed = state({ monitors: [monitor()] }); changed.page = { ...page, url: 'https://example.test/new' }
    renderMonitors(fixture.panel, changed, fixture.send, vi.fn())
    expect(field(fixture.panel, 'monitor-title')).toBe(title)
    expect(title.value).toBe('我的条件')
    expect(minutes.value).toBe('5')
    expect(document.activeElement).toBe(title)
    expect(fixture.panel.textContent).toContain('https://example.test/new')
    expect(fixture.panel.querySelectorAll('[data-notice-id="n"]')).toHaveLength(1)
  })

  test('missing observation permission disables creation and gives an actionable explanation', () => {
    const value = state(); value.connection.grant.scopes = ['session:interact', 'browser:read']
    const fixture = setup(value)
    expect(action(fixture.panel, '创建监控').disabled).toBe(true)
    expect(fixture.panel.textContent).toContain('请先允许监控当前站点')
  })

  test('a later sample refresh preserves unchanged action and notice buttons', () => {
    const first = { ...monitor(), lastSample: { sampledAt: 1000, matched: true } }
    const fixture = setup(state({ monitors: [first] }))
    const pause = action(fixture.panel, '暂停'), ack = action(fixture.panel, '已读')
    ack.focus()
    renderMonitors(fixture.panel, state({ monitors: [{ ...first, nextDue: 4000,
      lastSample: { sampledAt: 3000, matched: true } }] }), fixture.send, vi.fn())
    expect(action(fixture.panel, '暂停')).toBe(pause)
    expect(action(fixture.panel, '已读')).toBe(ack)
    expect(document.activeElement).toBe(ack)
  })
})

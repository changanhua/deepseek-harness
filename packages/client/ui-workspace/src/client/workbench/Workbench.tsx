/** Project-first navigation over the existing live session and workspace sources. */
import { useEffect, useMemo, useRef } from 'react'
import clsx from 'clsx'
import type { WorkbenchNavProps, WorkbenchProps } from './contract.ts'
import { deriveWorkbench } from './model.ts'
import type { WorkbenchItem } from './model.ts'
import type { WorkbenchKey } from './locales.ts'
import type { WorkbenchPage } from './store.ts'
import css from './Workbench.module.css'

const NAVIGATION: readonly Exclude<WorkbenchPage, 'project'>[] = ['overview', 'attention', 'running', 'recent', 'tools']
const MODULES: readonly { id: string; key: 'capability' | 'queue' | 'delivery' | 'architecture' | 'observatory' }[] = [
  { id: 'capability', key: 'capability' },
  { id: 'queue', key: 'queue' },
  { id: 'delivery', key: 'delivery' },
  { id: 'architecture', key: 'architecture' },
  { id: 'work-observatory', key: 'observatory' },
]

/** Simple geometric navigation glyph, independent of labels and business state. */
function Glyph({ page }: { page: WorkbenchPage }) {
  const path = page === 'overview' ? 'M3 10 12 3l9 7v10H3Z M9 20v-7h6v7'
    : page === 'attention' ? 'M4 4h16l2 12v4H2v-4Z M2 15h6l2 3h4l2-3h6'
      : page === 'running' ? 'm8 4 12 8-12 8Z'
        : page === 'recent' ? 'M12 7v6l4 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0'
          : page === 'project' ? 'M3 6h6l2 2h10v12H3Z'
            : 'm12 3 10 5-10 5L2 8Z M2 12l10 5 10-5 M2 16l10 5 10-5'
  return <svg className={css.icon} viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg>
}

/** Primary navigation; initial selection happens once per plugin, not on sidebar remount. */
export function WorkbenchNav({
  wide, activeModule, setActiveModule, useStore, actions, useSessions, useWorkspaces, useSessionPendingInteraction, t,
}: WorkbenchNavProps) {
  const view = useStore(state => state)
  const sessions = useSessions(state => state)
  const workspaces = useWorkspaces(state => state)
  const pending = useSessionPendingInteraction(state => state)
  const overview = useMemo(() => deriveWorkbench(sessions, workspaces, pending), [sessions, workspaces, pending])
  useEffect(() => {
    if (view.initialized) return
    actions.initialize()
    if (activeModule === 'conversation') setActiveModule('workbench')
  }, [activeModule, actions, setActiveModule, view.initialized])
  return <nav className={css.navigation} aria-label={t('home.workspace')}>
    {MODULES.some(module => module.id === activeModule) && <button type="button" className={clsx(css.navItem, !wide && css.rail)}
      aria-label={t('nav.returnToTools')} title={wide ? undefined : t('nav.returnToTools')}
      onClick={() => { actions.navigate('tools'); setActiveModule('workbench') }}>
      <span className={css.backIcon} aria-hidden="true">←</span>{wide && <span>{t('nav.returnToTools')}</span>}
    </button>}
    {NAVIGATION.map((page) => {
      const count = page === 'attention' ? overview.attention.length : page === 'running' ? overview.running.length : undefined
      const label = t(`nav.${page}`)
      return <button key={page} type="button" className={clsx(css.navItem, !wide && css.rail)}
        aria-label={label} aria-current={activeModule === 'workbench' && view.page === page ? 'page' : undefined}
        title={wide ? undefined : label}
        onClick={() => {
          actions.navigate(page)
          if (activeModule !== 'workbench') setActiveModule('workbench')
        }}>
        <Glyph page={page} />{wide && <span className={css.grow}>{label}</span>}
        {wide && count !== undefined && count > 0 && <span className={css.count}>{count}</span>}
      </button>
    })}
  </nav>
}

function statusKey(item: WorkbenchItem): WorkbenchKey {
  if (item.pendingInteraction === 'approval') return 'work.approval'
  if (item.pendingInteraction === 'plan-review') return 'work.plan'
  if (item.pendingInteraction === 'question') return 'work.question'
  if (item.running || item.runningSubagentCount > 0) return 'work.running'
  return item.completed ? 'work.unread' : 'work.idle'
}

/** Main surface: empty/loading/error states are distinct from a ready empty workspace. */
export function Workbench({
  useSessions, useWorkspaces, useSessionPendingInteraction, useModules, useStore,
  actions, openSession, prepareComposer, composer, openModule, t,
}: WorkbenchProps) {
  const sessions = useSessions(state => state)
  const workspaces = useWorkspaces(state => state)
  const pending = useSessionPendingInteraction(state => state)
  const modules = useModules(value => value)
  const view = useStore(state => state)
  const overview = useMemo(() => deriveWorkbench(sessions, workspaces, pending), [sessions, workspaces, pending])
  const project = overview.projects.find(item => item.workspaceId === view.projectId)
  const ready = sessions.phase === 'ready' && workspaces.phase === 'ready'
  const currentBlank = sessions.current !== undefined && sessions.byId[sessions.current]?.blank === true
  const preparedHome = useRef<string>()
  useEffect(() => {
    if (view.page !== 'overview' && view.page !== 'project') { preparedHome.current = undefined; return }
    if (!ready) return
    const key = `${view.page}:${project?.workspaceId ?? ''}`
    if (preparedHome.current === key) return
    preparedHome.current = key
    if (currentBlank && (project === undefined || (sessions.current !== undefined && project.sessionIds.includes(sessions.current)))) return
    prepareComposer(project?.workspaceId)
  }, [ready, view.page, project, currentBlank, sessions.current, prepareComposer])
  const title = view.page === 'overview' ? t('home.title')
    : view.page === 'project' ? project?.title ?? t('nav.project') : t(`nav.${view.page}`)
  const work = (item: WorkbenchItem, card = false) => <button type="button" key={item.id}
    data-workbench-session={item.id} className={card ? css.attentionCard : css.workRow} onClick={() => { openSession(item.id) }}>
    {!card && <span className={css.workIcon}><Glyph page="project" /></span>}
    <span className={css.grow}>
      <span className={css.workTitle}>{item.title}</span>
      <span className={css.workSubtitle}>{item.workspace?.title ?? t('home.ungrouped')}
        {item.runningSubagentCount > 0 && <> · {t('work.subagents', { n: item.runningSubagentCount })}</>}
      </span>
    </span>
    <span className={css.badge} data-state={item.pendingInteraction !== undefined ? 'attention' : item.running ? 'running' : 'idle'}>{t(statusKey(item))}</span>
    <time className={css.time} dateTime={new Date(item.updatedAt).toISOString()}>
      {new Date(item.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
    </time>
    {card && <span className={css.cardAction}>{t('work.open')} →</span>}
  </button>
  const section = (label: string, page?: WorkbenchPage) => <div className={css.sectionHead}>
    <h2>{label}</h2>{page !== undefined && <button type="button" className={css.textButton} onClick={() => { actions.navigate(page) }}>{t('home.all')} →</button>}
  </div>
  const list = (items: readonly WorkbenchItem[], empty: WorkbenchKey) => <div className={css.workList}>
    {items.length > 0 ? items.map(item => work(item)) : <p className={css.empty}>{t(empty)}</p>}
  </div>
  const filtered = (items: readonly WorkbenchItem[]) => items.filter(item => `${item.title} ${item.workspace?.title ?? ''}`.toLocaleLowerCase().includes(view.query.trim().toLocaleLowerCase()))
  const phaseReady = sessions.phase === 'ready' && workspaces.phase === 'ready' && workspaces.state !== 'error'
  const visibleItems = view.page === 'attention' ? overview.attention : view.page === 'running' ? overview.running
    : view.page === 'project' ? overview.items.filter(item => item.workspace?.workspaceId === view.projectId) : overview.items
  return <div className={css.page} data-workbench>
    <header className={css.topbar}><button type="button" onClick={() => { actions.navigate('overview') }}>{t('home.workspace')}</button><span>/</span><span>{title}</span></header>
    <div className={css.content}>
      <div className={css.heading}><span className={css.eyebrow}>{view.page === 'project' ? t('nav.project') : t('home.workspace')}</span><h1>{title}</h1>
        <p>{view.page === 'tools' ? t('tools.subtitle') : view.page === 'project' ? project?.path : t('home.subtitle')}</p>
      </div>
      {view.page === 'tools' ? <div className={css.tools}>
        {MODULES.filter(module => modules.includes(module.id)).map(module => <button key={module.id} type="button" className={css.toolCard} onClick={() => { openModule(module.id) }}>
          <Glyph page={module.id === 'queue' ? 'running' : 'tools'} /><h2>{t(`tools.${module.key}`)}</h2><p>{t(`tools.${module.key}.description`)}</p><span className={css.cardAction}>{t('tools.open')} →</span>
        </button>)}
        {!MODULES.some(module => modules.includes(module.id)) && <p className={css.empty}>{t('tools.empty')}</p>}
      </div> : !phaseReady && overview.items.length === 0 && overview.projects.length === 0 ? <p className={css.empty} role="status">{t(workspaces.state === 'error' ? 'home.unavailable' : 'home.loading')}</p>
        : view.page === 'project' && project === undefined ? <p className={css.empty} role="status">{t('home.projectMissing')}</p>
          : <>
            {!phaseReady && <p role="status" className={css.notice}>{t('home.unavailable')}</p>}
            {(view.page === 'overview' || view.page === 'project') && composer}
            {view.page === 'overview' ? <>
              {section(t('nav.attention'), 'attention')}
              {overview.attention.length > 0 ? <div className={css.attention}>{overview.attention.slice(0, 4).map(item => work(item, true))}</div> : <p className={css.empty}>{t('home.noAttention')}</p>}
              {section(t('nav.recent'), 'recent')}{list(overview.items.slice(0, 6), 'home.empty')}
              {section(t('home.projects'))}<div className={css.projects}>
                {overview.projects.map(item => <button key={item.workspaceId} type="button" className={css.projectCard} onClick={() => { actions.navigate('project', item.workspaceId) }}>
                  <span className={css.projectTitle}><Glyph page="project" />{item.title}</span><span className={css.workSubtitle}>{item.path}</span>
                  <span className={css.projectCount}>{t('home.projectConversations', { n: overview.items.filter(workItem => workItem.workspace?.workspaceId === item.workspaceId).length })}</span>
                </button>)}
                {overview.projects.length === 0 && <p className={css.empty}>{t('home.noProjects')}</p>}
              </div>
            </> : <>
              <label className={css.search}><Glyph page="recent" /><input value={view.query} placeholder={t('home.search')} aria-label={t('home.search')} onChange={(event) => { actions.setQuery(event.target.value) }} /></label>
              {list(filtered(visibleItems), view.query.trim() !== '' ? 'home.noMatches' : view.page === 'attention' ? 'home.noAttention' : view.page === 'running' ? 'home.noRunning' : 'home.empty')}
            </>}
          </>}
    </div>
  </div>
}

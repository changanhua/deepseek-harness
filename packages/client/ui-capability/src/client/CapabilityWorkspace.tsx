/**
 * The center-column Capability workspace: summary cards for Skills / MCP /
 * Tools, a tab bar, a search box, the active tab's list, and a read-only
 * detail drawer for the selected row. Every visible fact is a projection of
 * the shared store's snapshot; the view never fabricates a state the host
 * did not confirm. The detail is read-only — V0 shows runtime truth only.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import clsx from 'clsx'
import {
  IconSearchOutline16,
  IconRefreshOutline16,
  IconChevronDownOutline14,
  IconCloseOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityWorkspaceProps } from './contract/slots.ts'
import type { CapabilityStoreSnapshot } from './store.ts'
import type {
  CapabilityMcpServer,
  CapabilitySkill,
  CapabilityTool,
} from '@deepseek-ai/dsh-host-capability-registry/types'
import css from './CapabilityWorkspace.module.css'

type Tab = 'skills' | 'mcp' | 'tools'

const TABS: Tab[] = ['skills', 'mcp', 'tools']

/** The three row collections the tabs project; a module that exists but is
 * not yet loaded (or errored) is represented as `undefined`. */
type CapabilityRows = {
  readonly skills: readonly CapabilitySkill[]
  readonly mcpServers: readonly CapabilityMcpServer[]
  readonly tools: readonly CapabilityTool[]
}

/**
 * Render the Capability workspace.
 * @param props - shell.view owner share + injected store + locale seat.
 * @returns the workspace element tree.
 */
export function CapabilityWorkspace({ capability, t }: CapabilityWorkspaceProps): ReactNode {
  const snapshot = useSyncExternalStore<CapabilityStoreSnapshot>(capability.subscribe, capability.getSnapshot)
  const [tab, setTab] = useState<Tab>('skills')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SelectionKey | null>(null)

  const data = snapshot.status === 'ready' ? snapshot.snapshot : undefined

  // Re-hydrate on every mount (the frame unmounts inactive module views).
  useEffect(() => {
    const sessionId = snapshot.sessionId
    if (sessionId === undefined && snapshot.status === 'idle') {
      // The first open with no session addressed yet is a no-op until the
      // plugin's load callback addresses one; the plugin body wires that.
    }
  }, [capability, snapshot.status, snapshot.sessionId])

  // Clear the selection when it leaves the filtered list.
  const filtered = useMemo(() => filterByQuery(data, tab, query), [data, tab, query])
  const rows = useMemo(() => toListItems(filtered, t), [filtered, t])
  useEffect(() => {
    if (selected !== null && !rows.some(item => keyEquals(selected, item.key))) setSelected(null)
  }, [selected, rows])

  const skillCount = data?.skills.length ?? 0
  const mcpCount = data?.mcpServers.length ?? 0
  const toolCount = data?.tools.length ?? 0
  const modelVisibleSkills = data?.skills.filter(s => s.invocation.modelInvocable).length ?? 0
  const mcpToolTotal = data?.mcpServers.reduce((sum, s) => sum + s.registeredTools, 0) ?? 0

  return (
    <div className={css.workspace}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>{t('view.title')}</h1>
          <p className={css.subtitle}>{t('view.subtitle')}</p>
        </div>
      </header>

      {snapshot.status === 'loading' ? <p className={css.status}>{t('status.loading')}</p> : null}
      {snapshot.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('status.error')}</p>
          <button type="button" onClick={() => { void capability.retry() }}>{t('status.retry')}</button>
        </div>
      ) : null}

      {snapshot.status === 'ready' ? (
        <>
          <div className={css.cards}>
            <SummaryCard
              label={t('tab.skills')}
              count={skillCount}
              detail={`${modelVisibleSkills} ${t('skill.status.modelVisible')}`}
              scope={t('view.scope.skills')}
              active={tab === 'skills'}
              onClick={() => { setTab('skills'); setSelected(null) }}
            />
            <SummaryCard
              label={t('tab.mcp')}
              count={mcpCount}
              detail={mcpToolTotal > 0 ? `${mcpToolTotal} ${t('mcp.tools')}` : ''}
              scope={t('view.scope.mcp')}
              active={tab === 'mcp'}
              onClick={() => { setTab('mcp'); setSelected(null) }}
            />
            <SummaryCard
              label={t('tab.tools')}
              count={toolCount}
              detail={''}
              scope={t('view.scope.tools')}
              active={tab === 'tools'}
              onClick={() => { setTab('tools'); setSelected(null) }}
            />
          </div>

          <div className={css.tabs}>
            {TABS.map(kind => (
              <button
                key={kind}
                type="button"
                className={clsx(css.tab, tab === kind && css.tabActive)}
                aria-pressed={tab === kind}
                onClick={() => { setTab(kind); setSelected(null) }}
              >
                {t(`tab.${kind}`)}
              </button>
            ))}
            <label className={css.search}>
              <IconSearchOutline16 aria-hidden="true" />
              <span className={css.visuallyHidden}>{t('search.placeholder')}</span>
              <input
                type="search"
                value={query}
                placeholder={t('search.placeholder')}
                aria-label={t('search.placeholder')}
                onChange={(event) => { setQuery(event.currentTarget.value) }}
              />
            </label>
            <button
              type="button"
              className={css.refresh}
              title={t('status.retry')}
              onClick={() => { void capability.retry() }}
            >
              <IconRefreshOutline16 aria-hidden="true" />
            </button>
          </div>

          <div className={css.body}>
            {rows.length === 0 ? (
              <div className={css.empty}>
                {query.trim() !== '' ? t('status.empty.search') : t(`status.empty.${tab === 'mcp' ? 'mcp' : tab === 'tools' ? 'tools' : 'skills'}`)}
              </div>
            ) : (
              <ul className={css.rows}>
                {rows.map(item => (
                  <li key={`${item.key.kind}:${item.key.kind === 'mcp' ? item.key.id : item.key.name}`}>
                    <CapabilityRow
                      item={item}
                      selected={keyEquals(selected, item.key)}
                      onSelect={() => { setSelected(keyEquals(selected, item.key) ? null : item.key) }}
                      t={t}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DetailDrawer
            selection={selected}
            data={data}
            t={t}
            onClose={() => { setSelected(null) }}
          />

          <p className={css.footer}>{t('view.readonly')}</p>
        </>
      ) : null}
    </div>
  )
}

/** Key identifying one row across tabs. */
type SelectionKey =
  | { readonly kind: 'skill'; readonly name: string }
  | { readonly kind: 'mcp'; readonly id: string }
  | { readonly kind: 'tool'; readonly name: string }

/** One normalized list item. */
interface ListItem {
  readonly key: SelectionKey
  readonly title: string
  readonly subtitle: string
  readonly tags: string[]
}

/** Check whether two selection keys are equal. */
function keyEquals(a: SelectionKey | null, b: SelectionKey): boolean {
  if (a === null) return false
  return a.kind === b.kind && (a as { name?: string; id?: string }).name === (b as { name?: string; id?: string }).id
}

/** The raw filtered rows for one tab, before localization. */
type FilteredRows =
  | { readonly kind: 'skills'; readonly rows: readonly CapabilitySkill[] }
  | { readonly kind: 'mcp'; readonly rows: readonly CapabilityMcpServer[] }
  | { readonly kind: 'tools'; readonly rows: readonly CapabilityTool[] }

/** Filter the active tab's rows by the query string, returning raw data. */
function filterByQuery(
  data: CapabilityRows | undefined,
  tab: Tab,
  query: string,
): FilteredRows {
  const empty: FilteredRows = tab === 'skills' ? { kind: 'skills', rows: [] } : tab === 'mcp' ? { kind: 'mcp', rows: [] } : { kind: 'tools', rows: [] }
  if (data === undefined) return empty
  const q = query.trim().toLowerCase()
  if (tab === 'skills') {
    return { kind: 'skills', rows: data.skills.filter(s => q === '' || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) }
  }
  if (tab === 'mcp') {
    return { kind: 'mcp', rows: data.mcpServers.filter(s => q === '' || s.serverName.toLowerCase().includes(q)) }
  }
  return { kind: 'tools', rows: data.tools.filter(tool => q === '' || tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q)) }
}

/** Convert filtered rows into localized list items with selection keys. */
function toListItems(filtered: FilteredRows, t: CapabilityWorkspaceProps['t']): ListItem[] {
  if (filtered.kind === 'skills') {
    return filtered.rows.map(s => ({
      key: { kind: 'skill', name: s.name } as SelectionKey,
      title: s.name,
      subtitle: s.description,
      tags: [s.source, s.provider],
    }))
  }
  if (filtered.kind === 'mcp') {
    return filtered.rows.map(s => ({
      key: { kind: 'mcp', id: s.id } as SelectionKey,
      title: s.serverName,
      subtitle: `mcp__${s.serverName}__*`,
      tags: [s.transport, `${s.registeredTools} ${t('mcp.tools')}`],
    }))
  }
  return filtered.rows.map(tool => ({
    key: { kind: 'tool', name: tool.name } as SelectionKey,
    title: tool.name,
    subtitle: tool.description,
    tags: tool.mcpServer !== undefined ? [`${t('tool.source.mcp')} · ${tool.mcpServer}`] : [t('tool.source.runtime')],
  }))
}

/** One summary card. */
function SummaryCard(props: {
  label: string
  count: number
  detail: string
  scope: string
  active: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      className={clsx(css.card, props.active && css.cardActive)}
      onClick={props.onClick}
    >
      <span className={css.cardLabel}>{props.label}</span>
      <span className={css.cardCount}>{props.count}</span>
      {props.detail !== '' ? <span className={css.cardDetail}>{props.detail}</span> : null}
      <span className={css.cardScope}>{props.scope}</span>
    </button>
  )
}

/** One row in the active tab's list. */
function CapabilityRow(props: {
  item: ListItem
  selected: boolean
  onSelect: () => void
  t: CapabilityWorkspaceProps['t']
}): ReactNode {
  return (
    <button
      type="button"
      className={clsx(css.row, props.selected && css.rowSelected)}
      aria-expanded={props.selected}
      onClick={props.onSelect}
    >
      <div className={css.rowMain}>
        <span className={css.rowTitle}>{props.item.title}</span>
        <span className={css.rowSubtitle}>{props.item.subtitle}</span>
      </div>
      <span className={css.rowTags}>
        {props.item.tags.map(tag => <span key={tag} className={css.tag}>{tag}</span>)}
      </span>
      <IconChevronDownOutline14 className={clsx(css.chevron, props.selected && css.chevronOpen)} size={12} aria-hidden="true" />
    </button>
  )
}

/** The detail drawer for the selected row. */
function DetailDrawer(props: {
  selection: SelectionKey | null
  data: CapabilityRows | undefined
  t: CapabilityWorkspaceProps['t']
  onClose: () => void
}): ReactNode {
  if (props.selection === null || props.data === undefined) return null
  const { selection, data, t, onClose } = props
  return (
    <aside className={css.drawer} data-testid="capability-detail">
      <div className={css.drawerHead}>
        <button type="button" className={css.drawerClose} aria-label={t('detail.close')} onClick={onClose}>
          <IconCloseOutline16 aria-hidden="true" />
        </button>
      </div>
      {selection.kind === 'skill' ? <SkillDetail skill={data.skills.find(s => s.name === selection.name)} t={t} /> : null}
      {selection.kind === 'mcp' ? <McpDetail server={data.mcpServers.find(s => s.id === selection.id)} t={t} /> : null}
      {selection.kind === 'tool' ? <ToolDetail tool={data.tools.find(tool => tool.name === selection.name)} t={t} /> : null}
    </aside>
  )
}

/** Skill detail body. */
function SkillDetail(props: { skill: CapabilitySkill | undefined; t: CapabilityWorkspaceProps['t'] }): ReactNode {
  if (props.skill === undefined) return null
  const { skill, t } = props
  return (
    <div className={css.drawerBody}>
      <h2 className={css.drawerTitle}>{skill.name}</h2>
      <p className={css.drawerDesc}>{skill.description}</p>
      {skill.whenToUse !== undefined ? <p className={css.drawerWhen}>{skill.whenToUse}</p> : null}
      <section className={css.drawerSection}>
        <div className={css.drawerSectionLabel}>{t('skill.status')}</div>
        <ul className={css.statusList}>
          <StatusLine ok label={t('skill.status.discovered')} />
          <StatusLine ok={skill.selected} label={t('skill.status.effective')} />
          <StatusLine ok={skill.invocation.modelInvocable} label={t('skill.status.modelVisible')} />
          <StatusLine ok={skill.invocation.userInvocable} label={t('skill.status.userInvocable')} />
          {!skill.selected ? <StatusLine ok={false} label={t('skill.status.shadowed')} /> : null}
        </ul>
      </section>
      <section className={css.drawerSection}>
        <div className={css.drawerSectionLabel}>{t('skill.source')}</div>
        <dl className={css.kvList}>
          <KvRow label={t('skill.provider')} value={skill.provider} />
          <KvRow label={t('skill.source')} value={skill.source} />
          {skill.originLayerLabel !== undefined ? <KvRow label={t('skill.layer')} value={skill.originLayerLabel} /> : null}
          {skill.path !== undefined ? <KvRow label={t('skill.path')} value={skill.path} /> : null}
        </dl>
      </section>
    </div>
  )
}

/** MCP server detail body. */
function McpDetail(props: { server: CapabilityMcpServer | undefined; t: CapabilityWorkspaceProps['t'] }): ReactNode {
  if (props.server === undefined) return null
  const { server, t } = props
  return (
    <div className={css.drawerBody}>
      <h2 className={css.drawerTitle}>{server.serverName}</h2>
      <section className={css.drawerSection}>
        <dl className={css.kvList}>
          <KvRow label={t('mcp.serverName')} value={server.serverName} />
          <KvRow label={t('mcp.transport')} value={server.transport} />
          <KvRow label={t('mcp.tools')} value={`${server.registeredTools}`} />
          <KvRow label={t('mcp.namespace')} value={`mcp__${server.serverName}__*`} />
        </dl>
      </section>
      <p className={css.drawerNote}>{t('mcp.note.state')}</p>
    </div>
  )
}

/** Tool detail body. */
function ToolDetail(props: { tool: CapabilityTool | undefined; t: CapabilityWorkspaceProps['t'] }): ReactNode {
  if (props.tool === undefined) return null
  const { tool, t } = props
  return (
    <div className={css.drawerBody}>
      <h2 className={css.drawerTitle}>{tool.name}</h2>
      <p className={css.drawerDesc}>{tool.description}</p>
      <section className={css.drawerSection}>
        <dl className={css.kvList}>
          <KvRow label={t('tool.name')} value={tool.name} />
          <KvRow label={t('tool.source')} value={tool.mcpServer !== undefined ? `${t('tool.source.mcp')} · ${tool.mcpServer}` : t('tool.source.runtime')} />
          {tool.mcpRawName !== undefined ? <KvRow label={t('tool.mcp.raw')} value={tool.mcpRawName} /> : null}
        </dl>
      </section>
    </div>
  )
}

/** One key-value row in a detail list. */
function KvRow(props: { label: string; value: string }): ReactNode {
  return (
    <div className={css.kv}>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  )
}

/** One status line with a dot. */
function StatusLine(props: { ok: boolean; label: string }): ReactNode {
  return (
    <li className={css.statusLine}>
      <span className={clsx(css.statusDot, props.ok && css.statusDotOk)} aria-hidden="true" />
      <span>{props.label}</span>
    </li>
  )
}

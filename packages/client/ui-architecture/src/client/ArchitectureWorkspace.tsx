import type { ArchitecturePackage } from './catalog.ts'
import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { IconRefreshOutline16, IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ArchitectureWorkspaceProps } from './contract.ts'
import css from './ArchitectureWorkspace.module.css'

const PHASE_COPY = {
  active: 'runtime.active',
  pending: 'runtime.pending',
  loading: 'runtime.loadingPhase',
  failed: 'runtime.failed',
  unloading: 'runtime.unloading',
} as const

function packageMatches(pkg: ArchitecturePackage, query: string): boolean {
  if (query === '') return true
  return [pkg.name, pkg.short, pkg.path, pkg.description, pkg.group]
    .some(value => value.toLocaleLowerCase().includes(query))
}

export function ArchitectureWorkspace({ catalog, useRuntime, refresh, t }: ArchitectureWorkspaceProps) {
  const runtime = useRuntime(state => state)
  const [group, setGroup] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedName, setSelectedName] = useState(catalog.packages[0]?.name ?? '')
  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const pkg of catalog.packages) counts.set(pkg.group, (counts.get(pkg.group) ?? 0) + 1)
    return [...counts].sort(([a], [b]) => a.localeCompare(b))
  }, [catalog])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const packagesByName = useMemo(
    () => new Map(catalog.packages.map(pkg => [pkg.name, pkg])),
    [catalog],
  )
  const visible = useMemo(
    () => catalog.packages.filter(pkg => (group === null || pkg.group === group) && packageMatches(pkg, normalizedQuery)),
    [catalog, group, normalizedQuery],
  )
  const selected = catalog.packages.find(pkg => pkg.name === selectedName) ?? catalog.packages[0]
  const consumers = useMemo(() => {
    if (selected === undefined) return []
    return catalog.packages.filter(pkg => pkg.dependencies.includes(selected.name))
  }, [catalog, selected])
  const runtimeEntries = runtime.snapshot?.entries ?? []
  const runtimePackages = new Set(runtimeEntries.map(entry => entry.moduleName))
  const composedWorkspacePackages = catalog.packages.filter(pkg => runtimePackages.has(pkg.name)).length
  const activeRuntime = runtimeEntries.filter(entry => entry.fiberPhase === 'active').length
  const selectedRuntime = selected === undefined
    ? undefined
    : runtimeEntries.find(entry => entry.moduleName === selected.name)
  const runtimeLabel = selectedRuntime === undefined
    ? t('runtime.uncomposed')
    : selectedRuntime.fiberPhase === null
      ? t('runtime.unobserved')
      : t(PHASE_COPY[selectedRuntime.fiberPhase])

  return (
    <section className={css.root} aria-label={t('nav.architecture')}>
      <header className={css.header}>
        <div>
          <div className={css.evidenceRow}>
            <span>{t('evidence.catalog')}</span>
            <span>{t('evidence.runtime')}</span>
          </div>
          <h1>{t('view.title')}</h1>
          <p>{t('view.subtitle')}</p>
        </div>
        <button type="button" className={css.refresh} onClick={refresh} disabled={runtime.status === 'loading'}>
          <IconRefreshOutline16 />
          {t('runtime.refresh')}
        </button>
      </header>

      <div className={css.summary}>
        <article><span>{t('summary.packages')}</span><strong data-testid="architecture-package-total">{catalog.packages.length}</strong></article>
        <article><span>{t('summary.groups')}</span><strong>{groups.length}</strong></article>
        <article><span>{t('summary.runtime')}</span><strong>{composedWorkspacePackages}</strong></article>
        <article><span>{t('summary.active')}</span><strong>{activeRuntime}</strong></article>
      </div>

      {runtime.status === 'error' && <div className={css.runtimeError} role="alert">{t('runtime.error')}: {runtime.error}</div>}

      <div className={css.explorer}>
        <nav className={css.groups} aria-label={t('summary.groups')}>
          <button className={clsx(group === null && css.groupActive)} type="button" onClick={() => { setGroup(null) }}>
            {t('group.all')} ({catalog.packages.length})
          </button>
          {groups.map(([name, count]) => (
            <button
              className={clsx(group === name && css.groupActive)}
              type="button"
              key={name}
              aria-label={`${name} (${count})`}
              onClick={() => { setGroup(name) }}
            >
              <span>{name}</span><strong>{count}</strong>
            </button>
          ))}
        </nav>

        <div className={css.fieldPane}>
          <label className={css.search}>
            <IconSearchOutline16 aria-hidden="true" />
            <span className={css.visuallyHidden}>{t('search.label')}</span>
            <input
              type="search"
              aria-label={t('search.label')}
              placeholder={t('search.placeholder')}
              value={query}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </label>
          <div className={css.field} data-testid="architecture-package-field">
            {visible.map(pkg => (
              <button
                type="button"
                key={pkg.name}
                className={clsx(css.packageTile, selected?.name === pkg.name && css.packageSelected)}
                data-face={pkg.faces[0]}
                data-runtime={runtimePackages.has(pkg.name) ? 'composed' : undefined}
                aria-label={`${pkg.short} — ${pkg.description}`}
                onClick={() => { setSelectedName(pkg.name) }}
              >
                <span className={css.packageName}>{pkg.short}</span>
                <span className={css.packageGroup}>{pkg.group}</span>
                {runtimePackages.has(pkg.name) && <span className={css.runtimeDot} aria-hidden="true" />}
              </button>
            ))}
            {visible.length === 0 && <p className={css.empty}>{t('empty')}</p>}
          </div>
        </div>

        <aside className={css.detail} data-testid="architecture-package-detail">
          {selected !== undefined && (
            <>
              <div className={css.detailGroup}>{selected.group}</div>
              <h2>{selected.short}</h2>
              <p className={css.description}>{selected.description}</p>
              <span className={clsx(css.runtimeStatus, selectedRuntime?.fiberPhase === 'active' && css.runtimeActive)}>
                {runtimeLabel}
              </span>
              <dl>
                <div><dt>{t('detail.path')}</dt><dd><code>{selected.path}</code></dd></div>
                <div><dt>{t('detail.faces')}</dt><dd className={css.tags}>{selected.faces.map(face => <span key={face}>{face}</span>)}</dd></div>
                <div><dt>{t('detail.dependencies')}</dt><dd className={css.links}>{selected.dependencies.length === 0 ? t('detail.none') : selected.dependencies.map(dep => <button type="button" key={dep} onClick={() => { setSelectedName(dep) }}>{packagesByName.get(dep)?.short ?? dep}</button>)}</dd></div>
                <div><dt>{t('detail.consumers')}</dt><dd className={css.links}>{consumers.length === 0 ? t('detail.none') : consumers.map(pkg => <button type="button" key={pkg.name} onClick={() => { setSelectedName(pkg.name) }}>{pkg.short}</button>)}</dd></div>
              </dl>
            </>
          )}
        </aside>
      </div>
    </section>
  )
}

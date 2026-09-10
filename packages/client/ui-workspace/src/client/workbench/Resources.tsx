/** Project-local notes, file references and manual service controls. */
import type { WorkbenchProps } from './contract.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { ResourcesState } from './resources-runtime.ts'
import { useState } from 'react'
import type { ResourceInput } from '@deepseek-ai/dsh-api-workspace-controller/types'
import css from './Resources.module.css'

/** Parent-selected project and framework-observed resource snapshot. */
export type ResourcesProps = Pick<WorkbenchProps, 't' | 'resourceAdd' | 'resourceAct' | 'resourceLoad' | 'resourceClosePreview'>
  & { workspaceId: WorkspaceId; state: ResourcesState }

/** Render the minimal project resource entry. */
export function Resources({ workspaceId, state, resourceAdd, resourceAct, resourceLoad, resourceClosePreview, t }: ResourcesProps) {
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<ResourceInput['kind']>('note')
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [path, setPath] = useState('')
  const [cwd, setCwd] = useState('.')
  const [command, setCommand] = useState('')
  const [url, setUrl] = useState('')
  const save = async () => {
    const input: ResourceInput = kind === 'note' ? { kind, name, content }
      : kind === 'file' ? { kind, name, path }
        : { kind, name, cwd, command, ...(url.trim() === '' ? {} : { url: url.trim() }) }
    if (await resourceAdd(workspaceId, input)) {
      setAdding(false); setName(''); setContent(''); setPath(''); setCommand(''); setUrl('')
    }
  }
  return <section className={css.resources} aria-label={t('resources.title')}>
    <div className={css.heading}><h2>{t('resources.title')}</h2><div className={css.actions}>
      <button type="button" disabled={state.busy} onClick={() => { void resourceLoad(workspaceId) }}>{t('resources.refresh')}</button>
      <button type="button" disabled={state.busy} onClick={() => { setAdding(true) }}>{t('resources.add')}</button>
    </div></div>
    <p className={css.hint}>{t('resources.subtitle')}</p>
    {state.error !== undefined && <p role="alert" className={css.error}>{state.error}</p>}
    {state.busy && <p role="status">{t('resources.loading')}</p>}
    {adding && <form className={css.form} onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label>{t('resources.kind')}<select aria-label={t('resources.kind')} value={kind}
        onChange={(event) => { setKind(event.target.value as ResourceInput['kind']) }}>
        <option value="note">{t('resources.note')}</option><option value="file">{t('resources.file')}</option><option value="service">{t('resources.service')}</option>
      </select></label>
      <label>{t('resources.name')}<input value={name} required onChange={(event) => { setName(event.target.value) }} /></label>
      {kind === 'note' && <label>{t('resources.content')}<textarea value={content} rows={6} onChange={(event) => { setContent(event.target.value) }} /></label>}
      {kind === 'file' && <label>{t('resources.path')}<input value={path} required onChange={(event) => { setPath(event.target.value) }} /></label>}
      {kind === 'service' && <>
        <label>{t('resources.cwd')}<input value={cwd} required onChange={(event) => { setCwd(event.target.value) }} /></label>
        <label>{t('resources.command')}<input value={command} required onChange={(event) => { setCommand(event.target.value) }} /></label>
        <label>{t('resources.url')}<input type="url" value={url} onChange={(event) => { setUrl(event.target.value) }} /></label>
        <p className={css.hint}>{t('resources.lifecycle')}</p>
      </>}
      <div className={css.actions}><button type="submit" disabled={state.busy}>{t('resources.save')}</button>
        <button type="button" disabled={state.busy} onClick={() => { setAdding(false) }}>{t('resources.cancel')}</button></div>
    </form>}
    {state.data?.entries.length === 0 && <p className={css.hint}>{t('resources.empty')}</p>}
    {state.data?.entries.map(entry => <article key={entry.id} className={css.entry}>
      <div className={css.heading}><strong>{entry.name}</strong><span>{t(`resources.${entry.kind}`)}</span></div>
      {entry.kind === 'service' ? <>
        <p><span>{t(`resources.status.${entry.status}`)}</span>{entry.pid !== undefined && <> · {t('resources.pid', { pid: entry.pid })}</>}</p>
        <code>{entry.command}</code><p className={css.hint}>{t('resources.cwd')}: {entry.cwd}</p>
        {entry.error !== undefined && <p role="alert">{entry.error}</p>}
        <div className={css.actions}>
          <button type="button" disabled={state.busy} onClick={() => { void resourceAct(workspaceId, entry.id, entry.status === 'running' ? 'stop' : 'start') }}>{t(entry.status === 'running' ? 'resources.stop' : 'resources.start')}</button>
          {entry.url !== undefined && <a href={entry.url} target="_blank" rel="noopener noreferrer">{t('resources.visit')}</a>}
          <button type="button" disabled={state.busy || entry.status === 'running'} onClick={() => { void resourceAct(workspaceId, entry.id, 'remove') }}>{t('resources.remove')}</button>
        </div>
        {entry.logs !== undefined && <details><summary>{t('resources.logs')}</summary>
          {entry.logsTruncated && <p>{t('resources.truncated')}</p>}<pre>{entry.logs || t('resources.noLogs')}</pre></details>}
      </> : <><p className={css.path}>{entry.path}</p><div className={css.actions}>
        <button type="button" disabled={state.busy} onClick={() => { void resourceAct(workspaceId, entry.id, 'read') }}>{t('resources.read')}</button>
        <button type="button" disabled={state.busy} onClick={() => { void resourceAct(workspaceId, entry.id, 'remove') }}>{t('resources.remove')}</button>
      </div></>}
    </article>)}
    {state.preview !== undefined && <div className={css.preview}>
      <div className={css.heading}><strong>{t('resources.preview')}</strong><button type="button" onClick={resourceClosePreview}>{t('resources.close')}</button></div>
      <p className={css.path}>{state.preview.path}</p><pre>{state.preview.text}</pre>
    </div>}
    {state.data !== undefined && <details className={css.hint}><summary>{t('resources.location')}</summary><p className={css.path}>{state.data.configPath}</p><p>{t('resources.retention')}</p></details>}
  </section>
}

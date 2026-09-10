/** Approval and revocation surface over the Host-backed connection projection. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserConnectionView } from './browser-connection.ts'
import { contentErrorKey, type NS } from './locales.ts'
import css from './BrowserConnectionPanel.module.css'

/** The slot receives only a projection and user action callbacks. */
export interface BrowserConnectionInjected {
  hooks: { browserConnection: HostObservable<BrowserConnectionView> }
  approve(): Promise<void>
  reject(): Promise<void>
  revoke(installationId: string): Promise<void>
  close(): void
  reload(): Promise<void>
}

type Props = PropsRuntime<'shell.overlay'> & InjectFace<BrowserConnectionInjected> & PropsLocale<typeof NS>

/** Render an explicit approval or the current authorized installations. */
export function BrowserConnectionPanel({ useBrowserConnection, approve, reject, revoke, close, reload, t }: Props) {
  const view = useBrowserConnection(value => value)
  if (!view.visible) return null
  return (
    <div className={css.backdrop}>
      <section className={css.panel} role="dialog" aria-modal="true" aria-label={t('extension.title')}>
        <h2>{t('extension.title')}</h2>
        {view.busy && <p role="status">{t('extension.pending')}</p>}
        {view.request !== null && (
          <>
            <p>{t('extension.permission')}</p>
            <p>{t('extension.identity')} <code className={css.identity}>{view.request.extensionId}</code></p>
            {view.request.status === 'pending' && (
              <div className={css.actions}>
                <button type="button" disabled={view.busy} onClick={() => { void approve() }}>{t('extension.allow')}</button>
                <button type="button" disabled={view.busy} onClick={() => { void reject() }}>{t('extension.reject')}</button>
              </div>
            )}
            {view.request.status === 'approved' && <p role="status">{t('extension.approved')}</p>}
            {view.request.status === 'rejected' && <p role="status">{t('extension.rejected')}</p>}
          </>
        )}
        {view.requestId === null && !view.busy && view.error === null && view.grants.length === 0 && <p>{t('extension.empty')}</p>}
        {view.requestId === null && view.grants.map(grant => (
          <div className={css.grant} key={grant.installationId}>
            <code className={css.identity}>{grant.extensionId}</code>
            <small>{grant.createdAt}</small>
            <button type="button" disabled={view.busy} onClick={() => { void revoke(grant.installationId) }}>{t('extension.revoke')}</button>
          </div>
        ))}
        {view.error !== null && (
          <div role="alert">
            <p>{t(contentErrorKey(view.error))}</p>
            <button type="button" disabled={view.busy} onClick={() => { void reload() }}>{t('action.retry')}</button>
          </div>
        )}
        <div className={css.actions}><button type="button" onClick={close}>{t('extension.close')}</button></div>
      </section>
    </div>
  )
}

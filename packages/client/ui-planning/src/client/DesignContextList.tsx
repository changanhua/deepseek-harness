import type { DesignContextRecord } from '@changanhua/dsh-planning-remote/types'
import type { PlanningKey } from './locales.ts'

export function DesignContextList({ contexts, t }: { readonly contexts: readonly DesignContextRecord[]
  readonly t: (key: PlanningKey) => string }) {
  return <section aria-label={t('thinking.designContexts')}>
    <h3>{t('thinking.designContexts')}</h3>
    {contexts.length === 0 ? <p>{t('thinking.noDesignContexts')}</p> : <ul>{contexts.map(context => <li key={context.id}>
      <strong>{context.title}</strong><p>{context.body}</p><small>{t('thinking.planningRevision')}: {context.planningRevisionAtCreation} · {t('thinking.caseVersion')}: v{context.caseVersionAtCreation}</small>
    </li>)}</ul>}
  </section>
}

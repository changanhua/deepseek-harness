import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@changanhua/dsh-client-ui-planning/client'
import type {} from '@changanhua/dsh-planning-remote/remote'
import remoteDefinition from '@changanhua/dsh-requirement-assessment-remote/remote'
import { useEffect, useState } from 'react'
import type { RirRemote, WorkspaceReader } from './face.ts'
import { ReviewPanel } from './ReviewPanel.tsx'
import { en, zh, NS, type RirKey } from './locales.ts'
import type { AssessmentSubject } from '@changanhua/dsh-requirement-assessment/types'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { requirementAssessment: RirKey }
}
interface Injected { remote: RirRemote; workspaces: WorkspaceReader }
function ManualWorkspace({ remote, workspaces, t }: Injected & { t: (key: RirKey) => string }) {
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const c = new AbortController()
    void workspaces.workspaces(c.signal).then((result) => {
      if (c.signal.aborted) return
      if (!result.ok) throw new Error(result.error.message)
      setProjects(result.value); setWorkspaceId(result.value[0]?.id ?? '')
    }).catch((e: unknown) => { if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e)) })
    return () =>{  c.abort() }
  }, [workspaces])
  return <section><h2>{t('manual')}</h2>{error && <p role="alert">{error}</p>}
    <label>{t('workspace')}<select value={workspaceId} onChange={(e) =>{  setWorkspaceId(e.target.value) }}>
      {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
    </select></label>
    {workspaceId ? <ReviewPanel key={workspaceId} workspaceId={workspaceId} remote={remote} t={t} /> : <p>{t('noWorkspace')}</p>}
  </section>
}
function SubjectReview({ workspaceId, planId, subject, remote, t }: {
  workspaceId: string
  planId: string
  subject: { kind: 'plan' | 'focus'; id: string }
  remote: RirRemote
  t: (key: RirKey) => string
}) {
  const [open, setOpen] = useState(false)
  const target: AssessmentSubject = subject.kind === 'plan' ? { kind: 'plan', id: subject.id } : { kind: 'focus', id: subject.id, planId }
  return <section><button type="button" onClick={() =>{  setOpen(value => !value) }}>{open ? t('close') : t('title')}</button>
    {open && <ReviewPanel key={`${workspaceId}:${subject.kind}:${subject.id}`} workspaceId={workspaceId} subject={target} remote={remote} t={t} />}
  </section>
}
function Navigation({ setActiveModule, t }: { setActiveModule: (id: string) => void; t: (key: RirKey) => string }) {
  return <button onClick={() =>{  setActiveModule('requirement-assessment') }}>{t('title')}</button>
}
export const inject = ['slots', 'locale', 'remote']
/** Optional presentation owner; registration disposal removes the Planning action and manual view. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(remoteDefinition)
  const fiber = ctx.inject(['slots', 'locale', 'remote.requirementAssessment', 'remote.planning'], (ctx) => {
    ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'RIR dictionaries')
    const injected = (): Injected => ({ remote: ctx.remote.requirementAssessment, workspaces: ctx.remote.planning })
    ctx.slots.inject('shell.view', () => ctx.slots.register({ name: 'shell.view', id: 'requirement-assessment', locale: NS, inject: injected }, ManualWorkspace))
    ctx.slots.inject('sidebar.modules.group', () => ctx.slots.register({ name: 'sidebar.modules.group', id: 'requirement-assessment-nav', locale: NS }, Navigation))
    ctx.slots.inject('planning.subject.actions', () => ctx.slots.register({ name: 'planning.subject.actions', id: 'investment-review', locale: NS, inject: injected }, SubjectReview))
  })
  try { await fiber } catch (e) { await fiber.dispose(); await unmount(); throw e }
  return async () => { await fiber.dispose(); await unmount() }
}

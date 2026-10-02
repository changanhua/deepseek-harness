import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useRef, useState } from 'react'
import type { AssessmentSubject } from '@changanhua/dsh-requirement-assessment/types'
import type { AssessmentView, RirRemote } from './face.ts'
import type { RirKey } from './locales.ts'
import { AssessmentDetail } from './AssessmentDetail.tsx'
import css from './Review.module.css'

function sameSubject(left: AssessmentSubject, right?: AssessmentSubject): boolean {
  return !right || (left.kind === right.kind && left.id === right.id)
}
function previousUserText(view: AssessmentView): string {
  if (view.assessment.subject.kind === 'manual') return view.assessment.actualInput.text
  try {
    const value: unknown = JSON.parse(view.assessment.actualInput.text)
    return value !== null && typeof value === 'object' && 'userStatement' in value && typeof value.userStatement === 'string'
      ? value.userStatement : ''
  } catch { return '' }
}
/** Mounted per project/subject; caller keys the component so navigation cancels outstanding requests. */
export function ReviewPanel({ workspaceId, subject, remote, t }: {
  workspaceId: string
  subject?: AssessmentSubject
  remote: RirRemote
  t: (key: RirKey) => string
}) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [history, setHistory] = useState<AssessmentView[]>([])
  const [selected, setSelected] = useState<AssessmentView>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(false)
  const lifetime = useRef<AbortController | null>(null)
  const active = useRef<AbortController | null>(null)
  const read = useRef<AbortController | null>(null)
  const manualId = useRef(`manual-${randomUUID()}`)
  async function refresh() {
    read.current?.abort()
    const c = new AbortController(); read.current = c
    setLoading(true); setError('')
    try {
      const result = await remote.list({ workspaceId }, c.signal)
      if (c.signal.aborted || lifetime.current?.signal.aborted) return
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      const values = result.value.filter(v => sameSubject(v.assessment.subject, subject))
        .sort((a,b) => b.assessment.createdAt.localeCompare(a.assessment.createdAt))
      setHistory(values)
      setSelected(old => values.find(v => v.assessment.id === old?.assessment.id) ?? values[0])
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (!c.signal.aborted) setLoading(false) }
  }
  useEffect(() => {
    const c = new AbortController(); lifetime.current = c
    void refresh()
    return () => { c.abort(); active.current?.abort(); read.current?.abort() }
  }, [workspaceId, subject?.kind, subject?.id])
  async function review(previous?: AssessmentView) {
    if (active.current || lifetime.current?.signal.aborted) return
    read.current?.abort(); setLoading(false)
    const c = new AbortController(); active.current = c; setPending(true); setError('')
    try {
      const assessedSubject = previous?.assessment.subject ?? subject ?? { kind: 'manual' as const, id: manualId.current, title: title.trim() }
      const suppliedText = previous ? previousUserText(previous) : text
      const result = await remote.review({ workspaceId, requestId: randomUUID(), subject: assessedSubject,
        ...(previous ? { supersedes: previous.assessment.id } : {}),
        ...(suppliedText.trim() ? { text: suppliedText } : {}),
        evidence: previous ? previous.assessment.actualInput.evidence.flatMap(e => e.excerpt !== undefined && e.provenance === 'user_statement' ? [{ source: e.source, excerpt: e.excerpt }] : [])
          : excerpt.trim() ? [{ source: source.trim(), excerpt: excerpt.trim() }] : [],
      }, c.signal)
      if (c.signal.aborted || lifetime.current?.signal.aborted) return
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      setSelected(result.value)
      setHistory(old => [result.value, ...old.filter(v => v.assessment.id !== result.value.assessment.id)])
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (active.current === c) { active.current = null; if (!lifetime.current?.signal.aborted) setPending(false) } }
  }
  return <section className={css.panel}>
    <p>{t('advisory')}</p>
    <form onSubmit={(e) => { e.preventDefault(); void review() }}>
      {!subject && <label>{t('subject')}<input value={title} maxLength={8000} onChange={(e) =>{  setTitle(e.target.value) }} required /></label>}
      <label>{t('text')}<textarea value={text} maxLength={50000} onChange={(e) =>{  setText(e.target.value) }} required={!subject} /></label>
      <label>{t('source')}<input value={source} maxLength={8000} onChange={(e) =>{  setSource(e.target.value) }} required={!!excerpt.trim()} /></label>
      <label>{t('evidence')}<textarea value={excerpt} maxLength={8000} onChange={(e) =>{  setExcerpt(e.target.value) }} /></label>
      <button disabled={pending || (!subject && (!title.trim() || !text.trim()))}>{pending ? t('pending') : t('review')}</button>
      {pending && <button type="button" onClick={() => { active.current?.abort() }}>{t('cancel')}</button>}
    </form>
    <small>{t('retryNotice')}</small>
    {error && <p role="alert">{t('failed')}: {error}</p>}
    <h3>{t('history')}</h3>
    <button disabled={pending || loading} onClick={() => { void refresh() }}>{loading ? t('loading') : t('refresh')}</button>
    {!history.length && !loading && <p>{t('empty')}</p>}
    <ul>{history.map(v => <li key={v.assessment.id}>
      <button onClick={() => { setSelected(v) }}>
        {v.assessment.createdAt} · {v.assessment.evaluation.route} · {t(v.drift)}
      </button></li>)}</ul>
    {selected && <>
      <button disabled={pending} onClick={() => { void review(selected) }}>{t('rerun')}</button><AssessmentDetail view={selected} t={t} /></>}
  </section>
}

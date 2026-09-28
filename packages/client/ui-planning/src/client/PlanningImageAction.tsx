import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PlanningBoardView } from '@changanhua/dsh-planning-remote/types'
import type { PlanningCommand, PlanningMutationResult } from '@changanhua/dsh-planning/types'
import type { RemoteResult } from './runtime-controller.ts'
import { findPlanningImageTarget, imageCaptureCommand } from './image-capture.ts'
import { nextPlanningRequestId } from './request-id.ts'
import type { NS } from './locales.ts'
import css from './PlanningImages.module.css'

export interface PlanningImageActionInjected {
  loadBoard: (signal: AbortSignal) => Promise<RemoteResult<PlanningBoardView>>
  save: (workspaceId: string, command: PlanningCommand) => Promise<RemoteResult<PlanningMutationResult>>
  onSaved: () => void
}
export type PlanningImageActionProps = PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<PlanningImageActionInjected> & PropsLocale<typeof NS>

/** Save settled generated images to an existing plan or a newly named plan. */
export function PlanningImageAction({ messageId, sessionId, useChat, loadBoard, save, onSaved, t }: PlanningImageActionProps) {
  const target = useChat(snapshot => findPlanningImageTarget(snapshot, messageId))
  const [board, setBoard] = useState<PlanningBoardView>()
  const [itemId, setItemId] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const alive = useRef(true)
  const loading = useRef<AbortController>()
  const pending = useRef<{ workspaceId: string; command: PlanningCommand }>()
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; loading.current?.abort() }
  }, [])
  if (target === undefined) return null
  const open = (): void => {
    dialog.current?.showModal()
    if (pending.current !== undefined) return
    setError('')
    setBoard(undefined)
    setTitle(target.name || t('image.unnamed'))
    loading.current?.abort()
    const controller = new AbortController()
    loading.current = controller
    void loadBoard(controller.signal).then((result) => {
      if (!alive.current || controller.signal.aborted) return
      if (result.ok) { setBoard(result.value); setItemId(result.value.items.find(item => item.disposition === 'active')?.id ?? '') }
      else setError(result.error.message)
    }, (reason: unknown) => {
      if (alive.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  const submit = async (): Promise<void> => {
    if (busy || board === undefined) return
    setBusy(true)
    setError('')
    try {
      if (pending.current === undefined) {
        const command = imageCaptureCommand(board, itemId, sessionId, target.seq, title.trim(), nextPlanningRequestId())
        if (command !== undefined) pending.current = { workspaceId: board.workspaceId, command }
      }
      if (pending.current !== undefined) {
        const result = await save(pending.current.workspaceId, pending.current.command)
        if (!result.ok) throw new Error(result.error.message)
      }
      pending.current = undefined
      onSaved()
      if (alive.current) { setSaved(true); dialog.current?.close() }
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (alive.current) setBusy(false) }
  }
  return <span className={css.capture}>
    <button type="button" onClick={open}>{saved ? t('image.saved') : t('image.saveToPlan')}</button>
    <dialog ref={dialog} className={css.picker} aria-label={t('image.saveToPlan')}>
      <h3>{t('image.saveToPlan')} · {target.count}</h3>
      {board === undefined && error === '' && <p role="status">{t('view.loading')}</p>}
      {board !== undefined && <>
        <label>{t('image.choosePlan')}<select value={itemId} disabled={busy || pending.current !== undefined}
          onChange={(event) => { setItemId(event.target.value) }}>
          <option value="">{t('image.newPlan')}</option>
          {board.items.filter(item => item.disposition === 'active').map(item => <option key={item.id} value={item.id}>
            {item.revisions.find(revision => revision.id === item.headRevisionId)?.title}
          </option>)}
        </select></label>
        {itemId === '' && <label>{t('image.title')}<input value={title} disabled={busy || pending.current !== undefined}
          onChange={(event) => { setTitle(event.target.value) }} /></label>}
      </>}
      {error !== '' && <p role="alert">{error}</p>}
      <div className={css.actions}>
        <button type="button" disabled={busy} onClick={() => { loading.current?.abort(); dialog.current?.close() }}>{t('image.close')}</button>
        <button type="button" disabled={busy || board === undefined || (itemId === '' && title.trim() === '')}
          onClick={() => { void submit() }}>{busy ? t('view.saving') : t('image.save')}</button>
      </div>
    </dialog>
  </span>
}

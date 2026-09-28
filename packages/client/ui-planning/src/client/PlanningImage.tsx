import { useEffect, useRef, useState } from 'react'
import type { PlanningKey } from './locales.ts'
import css from './PlanningImages.module.css'

export interface PlanningImageProps {
  readonly workspaceId: string
  readonly image: { attachmentId: string; name?: string | undefined; width: number; height: number }
  readonly read: (workspaceId: string, attachmentId: string) => Promise<string>
  readonly t: (key: PlanningKey) => string
}

/** Lazy, verified plan image with an original-size dialog and explicit read failure. */
export function PlanningImage({ workspaceId, image, read, t }: PlanningImageProps) {
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    let active = true
    setUrl(undefined)
    setError('')
    void read(workspaceId, image.attachmentId).then(
      (value) => { if (active) setUrl(value) },
      (reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) },
    )
    return () => { active = false }
  }, [workspaceId, image.attachmentId, read, attempt])
  const name = image.name || t('image.unnamed')
  return <figure className={css.image}>
    {url === undefined ? error === '' ? <p role="status">{t('image.loading')}</p> : <>
      <p role="alert">{t('image.failed')}: {error}</p>
      <button type="button" onClick={() => { setAttempt(value => value + 1) }}>{t('view.retry')}</button>
    </> : <>
      <button type="button" className={css.thumbnail} aria-label={`${t('image.open')}: ${name}`}
        onClick={() => { dialog.current?.showModal() }}>
        <img src={url} alt={name} width={image.width} height={image.height} />
      </button>
      <dialog ref={dialog} className={css.preview} aria-label={name}>
        <button type="button" onClick={() => { dialog.current?.close() }}>{t('image.close')}</button>
        <img src={url} alt={name} />
      </dialog>
    </>}
    <figcaption>{name} · {image.width} × {image.height}</figcaption>
  </figure>
}

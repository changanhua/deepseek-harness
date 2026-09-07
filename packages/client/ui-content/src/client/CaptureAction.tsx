/**
 * The per-message "capture to library" entry: a single action in the
 * assistant message's IconActions strip. The button renders only when the
 * Chat projection holds a settled, pure-text assistant message for the
 * addressed id — the visibility rule lives in {@link findCaptureTarget}, the
 * Host re-verifies the source on the wire. Repeated clicks while one attempt
 * is in flight share it, so the strip never fires two captures for one
 * message.
 * @module @changanhua/dsh-client-ui-content/client/CaptureAction
 */

import { useEffect, useRef, useState } from 'react'
import { IconPlusOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { captureKey, findCaptureTarget } from './capture-target.ts'
import type { CaptureActionProps } from './contract.ts'
import { contentErrorKey } from './locales.ts'
import css from './CaptureAction.module.css'

/**
 * One message's capture entry.
 * @param props - the owner's message identity, the injected capture verb,
 * the shared library hook, and the copy.
 * @returns the capture button, or nothing when the message is ineligible.
 */
export function CaptureAction({ messageId, sessionId, useChat, useLibrary, capture, t }: CaptureActionProps) {
  // Hooks stay unconditional: the eligibility read runs for every settled
  // message, and the early return below happens after all of them.
  const target = useChat(snapshot => findCaptureTarget(snapshot, messageId))
  const key = target === undefined ? null : captureKey(sessionId, target)
  const capturedEntryId = useLibrary(view =>
    key === null ? undefined : view.captured.get(key))
  const pending = useLibrary(view => key !== null && view.pendingCapture?.key === key)
  const captureBusy = useLibrary(view => view.pendingCapture !== null)
  const [failure, setFailure] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  if (target === undefined) return null

  const captured = capturedEntryId !== undefined
  const label = pending ? t('capture.pending') : captured ? t('capture.captured') : t('capture.action')
  const settledLabel = captured
    ? `${t('capture.captured')}: ${capturedEntryId}`
    : label

  return (
    <>
      <Tooltip label={label} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={settledLabel}
          aria-pressed={captured || undefined}
          data-active={captured || undefined}
          disabled={captureBusy}
          onClick={() => {
            setFailure(null)
            // The store deduplicates concurrent attempts per message, so a
            // double click here cannot mint two operations.
            void capture(target).then((outcome) => {
              if (!alive.current) return
              setFailure(outcome.ok ? null : t(contentErrorKey(outcome.error.code)))
            })
          }}
        >
          <IconPlusOutline16 />
        </button>
      </Tooltip>
      {failure !== null && <span className={css.failure} role="status">{failure}</span>}
    </>
  )
}

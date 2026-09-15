/** Browser title selection follows the active main panel without subscribing the frame. */
import { useEffect } from 'react'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import type { UsePanelInfo } from './service.ts'

/** Props for the browser title projection. */
export type DocumentTitleProps = { useSessions?: UseSessions; usePanelInfo?: UsePanelInfo } & {
  /** Build-configured or localized product title. */
  productTitle: string
}

/**
 * Project the selected durable session title into the browser title and
 * restore the build-selected product title when unmounted.
 * @param props - Selected session title projection.
 * @returns No rendered content.
 */
export function DocumentTitle({ useSessions, usePanelInfo, productTitle }: DocumentTitleProps): null {
  const showSessionTitle = usePanelInfo?.(info => info.activePanelId === null) ?? false
  const title = useSessions?.((state) => {
    const current = state.current
    return !showSessionTitle || current === undefined ? undefined : state.byId[current]?.title
  })
  useEffect(() => {
    document.title = title === undefined ? productTitle : `${title} — ${productTitle}`
    return () => { document.title = productTitle }
  }, [productTitle, title])
  return null
}

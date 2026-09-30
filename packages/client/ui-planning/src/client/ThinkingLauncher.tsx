import { useState } from 'react'
import type { PlanningKey } from './locales.ts'

export interface ThinkingLauncherProps {
  readonly pending: boolean
  readonly error: string | null
  readonly prepare: (question: string) => Promise<boolean>
  readonly t: (key: PlanningKey) => string
}

/** Explicit user trigger for a durable Thinking run; it never starts work on mount. */
export function ThinkingLauncher({ pending, error, prepare, t }: ThinkingLauncherProps) {
  const [question, setQuestion] = useState('')
  return <section aria-label={t('thinking.agent')}>
    <h3>{t('thinking.agent')}</h3>
    <form onSubmit={(event) => {
      event.preventDefault()
      const value = question.trim()
      if (value === '') return
      void prepare(value).then((started) => { if (started) setQuestion('') })
    }}>
      <label>{t('thinking.question')}<textarea value={question} required maxLength={4000} disabled={pending}
        onChange={(event) => { setQuestion(event.target.value) }} /></label>
      <p>{t('thinking.contextSummary')}</p>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={pending || question.trim() === ''}>{t('thinking.start')}</button>
    </form>
  </section>
}

import type { PlanningRuntimeState } from './runtime-controller.ts'
import type { PlanningKey } from './locales.ts'
export function PlanningNavEntry({
  usePlanning,
  setActiveModule,
  refresh,
  t,
}: {
  readonly usePlanning: <T>(selector: (state: PlanningRuntimeState) => T) => T
  readonly setActiveModule: (id: string) => void
  readonly refresh: () => void
  readonly t: (key: PlanningKey) => string
}) {
  const count = usePlanning(state => state.board?.items.length ?? 0)
  return (
    <button
      type="button"
      onClick={() => {
        refresh()
        setActiveModule('planning')
      }}
    >
      {t('nav.planning')} {count === 0 ? '' : `(${count})`}
    </button>
  )
}

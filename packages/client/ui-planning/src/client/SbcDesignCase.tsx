import type { SbcDesignState } from './sbc-design-controller.ts'
import type { SbcExploreOperation } from '@changanhua/dsh-planning-remote/types'
import type { PlanningKey } from './locales.ts'
import { useRef, useState, type CSSProperties } from 'react'
import css from './SbcDesignCase.module.css'
export interface SbcDesignCaseProps {
  state: SbcDesignState
  explore: (operation: SbcExploreOperation) => Promise<void>
  refresh: () => Promise<void>
  close: () => void
  t: (key: PlanningKey) => string
}
const bound = (value: number) => Math.max(0, Math.min(20000, Math.round(value)))
/** Frozen Planning projection; pointer preview is private and only release persists. */
export function SbcDesignCase({ state, explore, refresh, close, t }: SbcDesignCaseProps) {
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null)
  const drag = useRef<{ id: string; pointer: number; left: number; top: number; x: number; y: number } | null>(null)
  const suppressClick = useRef(false)
  const view = state.view
  if (!state.opened) return null
  const saved = view?.case
  const nodes = saved ? [
    { id: `plan:${saved.planId}`, title: saved.baseRevision.title, body: saved.baseRevision.intent },
    ...(saved.baseFocus ? [{ id: `focus:${saved.baseFocus.id}`, title: saved.baseFocus.title, body: saved.baseFocus.objective }] : []),
    ...(saved.baseRevision.stateEntries ?? []).map(entry => ({ id: `entry:${entry.id}`, title: t(`workspace.${entry.kind}`), body: entry.content })),
  ] : []
  const positions = Object.values(saved?.local.positions ?? {})
  return <section className={css.root} aria-label={t('sbc.title')}>
    <header className={css.toolbar}><h3>{t('sbc.title')}</h3>
      <button type="button" disabled={state.pending} onClick={() => { void refresh() }}>{t('sbc.reload')}</button>
      <button type="button" disabled={state.pending || !saved?.history.length || !!state.error} onClick={() => { void explore({ kind: 'undo' }) }}>{t('sbc.undo')}</button>
      <button type="button" onClick={close}>{t('sbc.close')}</button>
    </header>
    <p>{t('sbc.boundary')}</p>
    {state.pending && <p>{t('sbc.saving')}</p>}
    {state.error && <p role="alert">{state.error} · {t('sbc.recover')}</p>}
    {saved && <>
      <p>{t('sbc.base')}: {saved.baseRevision.id}{saved.baseFocus && <> · {t('sbc.focusVersion')}: {saved.baseFocus.version}</>}</p>
      <p>{t('sbc.current')}: {view.currentRevision ?? t('sbc.unavailable')}{view.currentFocusVersion !== null && <> · {t('sbc.focusVersion')}: {view.currentFocusVersion}</>}</p>
      {view.drift && <p role="status">{t('sbc.drift')}</p>}
      <p>{t('sbc.instructions')}</p>
      <div className={css.viewport}><div className={css.canvas} style={{
        '--case-width': `${Math.max(1000, ...positions.map(p => p.x + 320), (preview?.x ?? 0) + 320)}px`,
        '--case-height': `${Math.max(600, ...positions.map(p => p.y + 200), (preview?.y ?? 0) + 200)}px`,
      } as CSSProperties}>
        {nodes.map((node) => {
          const position = preview?.id === node.id ? preview : saved.local.positions[node.id]
          if (!position) return null
          return <button type="button" className={css.node} key={node.id} disabled={state.pending || !!state.error}
            aria-pressed={saved.local.selectedNodeId === node.id} style={{ '--case-x': `${position.x}px`, '--case-y': `${position.y}px` } as CSSProperties}
            onClick={() => {
              if (suppressClick.current) { suppressClick.current = false; return }
              void explore({ kind: 'select', nodeId: node.id })
            }}
            onKeyDown={(event) => {
              const offsets: Record<string, readonly [number, number]> = {
                ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20],
              }
              const offset = offsets[event.key]
              if (!offset) return
              event.preventDefault()
              void explore({ kind: 'move', nodeId: node.id, x: bound(position.x + offset[0]), y: bound(position.y + offset[1]) })
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              suppressClick.current = false
              drag.current = { id: node.id, pointer: event.pointerId,
                left: event.clientX, top: event.clientY, x: position.x, y: position.y }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const start = drag.current
              if (!start || start.pointer !== event.pointerId) return
              setPreview({ id: start.id, x: bound(start.x + event.clientX - start.left), y: bound(start.y + event.clientY - start.top) })
            }}
            onPointerUp={(event) => {
              const start = drag.current
              if (!start || start.pointer !== event.pointerId) return
              drag.current = null
              setPreview(null)
              const x = bound(start.x + event.clientX - start.left), y = bound(start.y + event.clientY - start.top)
              if (x !== start.x || y !== start.y) {
                suppressClick.current = true
                void explore({ kind: 'move', nodeId: start.id, x, y })
              }
            }}
            onPointerCancel={() => { drag.current = null; setPreview(null) }}
            onLostPointerCapture={() => { drag.current = null; setPreview(null) }}>
            <strong>{node.title}</strong><span>{node.body}</span>
          </button>
        })}
      </div></div>
    </>}
  </section>
}

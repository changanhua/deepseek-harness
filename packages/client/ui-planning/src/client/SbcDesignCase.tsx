import type { SbcDesignState } from './sbc-design-controller.ts'
import type { SbcExploreOperation, ThinkingCaseView } from '@changanhua/dsh-planning-remote/types'
import type { PlanningKey } from './locales.ts'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import css from './SbcDesignCase.module.css'
import { ThinkingLauncher } from './ThinkingLauncher.tsx'
import { ThinkingResultPanel } from './ThinkingResultPanel.tsx'
import { DesignContextList } from './DesignContextList.tsx'

type CanvasNode = { id: string; title: string; body?: string | undefined; note?: true }

export interface ThinkingCaseRuntimeState {
  readonly view: ThinkingCaseView | null
  readonly pending: boolean
  readonly error: string | null
}
export interface ThinkingCaseActions {
  readonly state: ThinkingCaseRuntimeState
  readonly prepare: (question: string) => Promise<boolean>
  readonly resume: (runId: string) => Promise<boolean>
  readonly apply: (runId: string, resultId: string, resultVersion: number, kind: 'notes' | 'context',
    acknowledgeStale?: boolean) => Promise<boolean>
  readonly submitProposal: (runId: string, resultId: string, resultVersion: number) => Promise<boolean>
  readonly openSession: (sessionId: string) => void
}
export interface SbcDesignCaseProps {
  state: SbcDesignState
  explore: (operation: SbcExploreOperation) => Promise<void>
  refresh: () => Promise<void>
  close: () => void
  t: (key: PlanningKey) => string
  thinking?: ThinkingCaseActions
}
const bound = (value: number) => Math.max(0, Math.min(20000, Math.round(value)))
/** Frozen Planning projection; pointer preview is private and only release persists. */
export function SbcDesignCase({ state, explore, refresh, close, t, thinking }: SbcDesignCaseProps) {
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null)
  const drag = useRef<{ id: string; pointer: number; left: number; top: number; x: number; y: number } | null>(null)
  const suppressClick = useRef(false)
  const viewport = useRef<HTMLDivElement>(null)
  const editorId = useId()
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null)
  const [editor, setEditor] = useState<{
    id?: string
    title: string
    body: string
    x: number
    y: number
    version: number
  } | null>(null)
  const view = state.view
  useEffect(() => { setEditor(null); setMenu(null) },
    [state.opened, view?.case.workspaceId, view?.case.subject.kind, view?.case.subject.id])
  useEffect(() => {
    if (!editor || !view || view.case.version <= editor.version) return
    const note = view.case.notes?.find(value => value.id === (editor.id ?? view.case.local.selectedNodeId))
    if (note?.title === editor.title.trim() && (note.body ?? '') === editor.body.trim()) setEditor(null)
  }, [view, editor])
  if (!state.opened) return null
  const saved = view?.case
  const disabled = state.pending || !!state.error
  const create = (x = (viewport.current?.scrollLeft ?? 0) + 80,
    y = (viewport.current?.scrollTop ?? 0) + 200 + (saved?.notes?.length ?? 0) % 6 * 24) => {
    if (!saved || disabled) return
    setEditor({ title: '', body: '', x: bound(x), y: bound(y), version: saved.version })
    setMenu(null)
  }
  const edit = (id: string) => {
    const note = saved?.notes?.find(value => value.id === id)
    if (!saved || !note || disabled) return
    setEditor({ id, title: note.title, body: note.body ?? '', x: 0, y: 0, version: saved.version })
    setMenu(null)
  }
  const nodes: CanvasNode[] = saved ? [
    { id: `plan:${saved.planId}`, title: saved.baseRevision.title, body: saved.baseRevision.intent },
    ...(saved.baseFocus ? [{ id: `focus:${saved.baseFocus.id}`, title: saved.baseFocus.title, body: saved.baseFocus.objective }] : []),
    ...(saved.baseRevision.stateEntries ?? []).map(entry => ({ id: `entry:${entry.id}`, title: t(`workspace.${entry.kind}`),
      body: entry.content })),
    ...(saved.notes ?? []).map(note => ({ id: note.id, title: note.title, body: note.body, note: true as const })),
  ] : []
  const positions = Object.values(saved?.local.positions ?? {})
  return <section className={css.root} aria-label={t('sbc.title')}>
    <header className={css.toolbar}><h3>{t('sbc.title')}</h3>
      <button type="button" disabled={disabled || !saved} onClick={() => { create() }}>{t('canvas.create')}</button>
      <button type="button" disabled={disabled || !saved?.notes?.some(note => note.id === saved.local.selectedNodeId)}
        onClick={() => { if (saved?.local.selectedNodeId) edit(saved.local.selectedNodeId) }}>{t('canvas.edit')}</button>
      <button type="button" disabled={state.pending} onClick={() => { void refresh() }}>{t('sbc.reload')}</button>
      <button type="button" disabled={state.pending || !saved?.history.length || !!state.error} onClick={() => { void explore({ kind: 'undo' }) }}>{t('sbc.undo')}</button>
      <button type="button" onClick={close}>{t('sbc.close')}</button>
    </header>
    <p>{t('sbc.boundary')}</p>
    {state.error && <p role="alert">{state.error} · {t('sbc.recover')}</p>}
    {saved && <>
      <p>{t('sbc.base')}: {saved.baseRevision.id}{saved.baseFocus && <> · {t('sbc.focusVersion')}: {saved.baseFocus.version}</>}</p>
      <p>{t('sbc.current')}: {view.currentRevision ?? t('sbc.unavailable')}{view.currentFocusVersion !== null && <> · {t('sbc.focusVersion')}: {view.currentFocusVersion}</>}</p>
      {view.drift && <p role="status">{t('sbc.drift')}</p>}
      <p>{t('sbc.instructions')}</p>
      <div ref={viewport} className={css.viewport} onScroll={() => { setMenu(null) }}>
        {state.pending && <span role="status" className={css.saveStatus}>{t('sbc.saving')}</span>}
        <div className={css.canvas} aria-label={t('canvas.label')}
          onPointerDown={() => { setMenu(null) }} onKeyDown={(event) => { if (event.key === 'Escape') setMenu(null) }}
          onContextMenu={(event) => {
            event.preventDefault()
            if (disabled || event.target !== event.currentTarget) return
            const rect = event.currentTarget.getBoundingClientRect()
            setMenu({ x: bound(event.clientX - rect.left), y: bound(event.clientY - rect.top) })
          }} style={{
            '--case-width': `${Math.max(1000, ...positions.map(p => p.x + 320), (preview?.x ?? 0) + 320)}px`,
            '--case-height': `${Math.max(600, ...positions.map(p => p.y + 200), (preview?.y ?? 0) + 200)}px`,
          } as CSSProperties}>
          {nodes.map((node) => {
            const position = preview?.id === node.id ? preview : saved.local.positions[node.id] ??
            saved.notes?.find(note => note.id === node.id)?.position
            if (!position) return null
            return <div key={node.id}>
              <button type="button" className={`${css.node}${node.note ? ` ${css.note}` : ''}`} disabled={state.pending || !!state.error}
                aria-pressed={saved.local.selectedNodeId === node.id} style={{ '--case-x': `${position.x}px`,
                  '--case-y': `${position.y}px` } as CSSProperties}
                onDoubleClick={() => { if (node.note) edit(node.id) }}
                onContextMenu={(event) => {
                  if (!node.note) return
                  event.preventDefault(); event.stopPropagation()
                  setMenu({ x: position.x, y: position.y, nodeId: node.id })
                }}
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
                  setPreview({ id: start.id, x: bound(start.x + event.clientX - start.left),
                    y: bound(start.y + event.clientY - start.top) })
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
              {node.note && <button type="button" className={css.deleteNote} disabled={state.pending || !!state.error}
                style={{ '--case-x': `${position.x}px`, '--case-y': `${position.y}px` } as CSSProperties}
                aria-label={`${t('thinking.deleteNote')}：${node.title}`} onClick={() => { void explore({ kind: 'delete-note',
                  nodeId: node.id }) }}>×</button>}
            </div>
          })}
          {menu && <div className={css.menu} role="menu" aria-label={t('canvas.actions')}
            style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => { event.stopPropagation() }}>
            <button type="button" role="menuitem" autoFocus onClick={() => { create(menu.x, menu.y) }}>{t('canvas.create')}</button>
            {menu.nodeId && <>
              <button type="button" role="menuitem" onClick={() => { if (menu.nodeId) edit(menu.nodeId) }}>{t('canvas.edit')}</button>
              <button type="button" role="menuitem" onClick={() => {
                if (menu.nodeId) void explore({ kind: 'delete-note', nodeId: menu.nodeId })
                setMenu(null)
              }}>{t('thinking.deleteNote')}</button>
            </>}
          </div>}
        </div></div>
      {editor && <div className={css.editorBackdrop} onKeyDown={(event) => {
        if (event.key === 'Escape' && !state.pending) setEditor(null)
        if (event.key === 'Tab') {
          const controls = event.currentTarget.querySelectorAll<HTMLElement>('input, textarea, button:not(:disabled)')
          const first = controls[0], last = controls[controls.length - 1]
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
        <form role="dialog" aria-modal="true" aria-label={t(editor.id ? 'canvas.edit' : 'canvas.create')}
          className={css.editor} onSubmit={(event) => {
            event.preventDefault()
            if (!editor.title.trim() || disabled) return
            const fields = { title: editor.title.trim(), body: editor.body.trim() }
            void explore(editor.id ? { kind: 'edit-note', nodeId: editor.id, ...fields }
              : { kind: 'create-note', ...fields, x: editor.x, y: editor.y })
          }}>
          <h3>{t(editor.id ? 'canvas.edit' : 'canvas.create')}</h3>
          <div className={css.field}><label htmlFor={`${editorId}-title`}>{t('canvas.title')}</label>
            <input id={`${editorId}-title`} autoFocus required maxLength={2048} value={editor.title}
              onChange={(event) => { setEditor({ ...editor, title: event.target.value }) }} /></div>
          <div className={css.field}><label htmlFor={`${editorId}-body`}>{t('canvas.body')}</label>
            <textarea id={`${editorId}-body`} maxLength={8192} rows={6} value={editor.body}
              onChange={(event) => { setEditor({ ...editor, body: event.target.value }) }} /></div>
          {state.error && <p role="alert">{state.error}</p>}
          <footer><button type="button" disabled={state.pending} onClick={() => { setEditor(null) }}>{t('canvas.cancel')}</button>
            <button type="submit" disabled={disabled || !editor.title.trim()}>{t('canvas.save')}</button></footer>
        </form>
      </div>}
      {thinking && <section className={css.thinking}>
        <ThinkingLauncher pending={thinking.state.pending} error={thinking.state.error} prepare={thinking.prepare} t={t} />
        <ThinkingResultPanel runs={thinking.state.view?.runs ?? []} currentCaseVersion={saved.version}
          currentPlanningRevision={view.currentRevision} pending={thinking.state.pending} error={thinking.state.error}
          apply={thinking.apply} submitProposal={thinking.submitProposal} openSession={thinking.openSession}
          resume={thinking.resume} t={t} />
        <DesignContextList contexts={thinking.state.view?.designContexts ?? []} t={t} />
      </section>}
    </>}
  </section>
}

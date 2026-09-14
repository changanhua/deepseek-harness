// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLayoutStore, DEFAULT_MODULE } from '../src/client/stores.ts'

beforeEach(() => { vi.stubGlobal('innerWidth', 1920) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('createLayoutStore', () => {
  it('starts with official frame state and the conversation module', () => {
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual({
      activeModule: DEFAULT_MODULE,
      layoutInfo: {
        sidebar: 280,
        viewportWidth: 1920,
        narrowExpanded: false,
        rightbar: null,
        rightbarShown: false,
        rightbarTrack: false,
        rightbarFullscreen: false,
        rightbarInstant: false,
      },
    })
  })

  it('creates independent instances without browser persistence', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const a = createLayoutStore().create()
    const b = createLayoutStore().create()
    a.actions.setSidebar(400)
    a.actions.openRightbar(true, false)
    expect(b.store.getSnapshot().layoutInfo.sidebar).toBe(280)
    expect(b.store.getSnapshot().layoutInfo.rightbar).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('uses official sidebar and viewport rules', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(9999)
    expect(store.getSnapshot().layoutInfo.sidebar).toBe(420)
    actions.toggleSidebar()
    expect(store.getSnapshot().layoutInfo.sidebar).toBe(0)
    actions.setViewportWidth(980)
    actions.toggleSidebar()
    expect(store.getSnapshot().layoutInfo.narrowExpanded).toBe(true)
    actions.setViewportWidth(1024)
    expect(store.getSnapshot().layoutInfo.narrowExpanded).toBe(false)
  })

  it('initializes rightbar at 45% and keeps presentation reports independent', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setViewportWidth(1000)
    actions.openRightbar(true, false)
    expect(store.getSnapshot().layoutInfo).toMatchObject({
      rightbar: 450, rightbarShown: true, rightbarTrack: true, rightbarFullscreen: false,
    })
    actions.openRightbar(false, true)
    expect(store.getSnapshot().layoutInfo).toMatchObject({
      rightbar: 450, rightbarShown: true, rightbarTrack: false, rightbarFullscreen: true,
    })
    actions.closeRightbar()
    expect(store.getSnapshot().layoutInfo).toMatchObject({
      rightbar: 450, rightbarShown: false, rightbarTrack: false, rightbarFullscreen: false,
    })
  })

  it('clamps rightbar drag width to 300px and 70% of the frame', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setViewportWidth(1000)
    actions.setRightbar(1)
    expect(store.getSnapshot().layoutInfo.rightbar).toBe(300)
    actions.setRightbar(9999)
    expect(store.getSnapshot().layoutInfo.rightbar).toBe(700)
  })

  it('preserves fullscreen exit geometry until a fresh geometry action', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openRightbar(true, true)
    actions.closeRightbar()
    expect(store.getSnapshot().layoutInfo.rightbarInstant).toBe(true)
    actions.setSidebar(350)
    expect(store.getSnapshot().layoutInfo.rightbarInstant).toBe(false)
  })

  it('maps panel selection onto the retained module ring', () => {
    const { store, actions } = createLayoutStore().create()
    actions.selectPanel('queue')
    expect(store.getSnapshot().activeModule).toBe('queue')
    actions.selectPanel(null)
    expect(store.getSnapshot().activeModule).toBe(DEFAULT_MODULE)
    actions.setActiveModule('content')
    expect(store.getSnapshot().activeModule).toBe('content')
    actions.setActiveModule('content')
    expect(store.getSnapshot().activeModule).toBe(DEFAULT_MODULE)
  })
})

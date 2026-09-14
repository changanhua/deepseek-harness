/** Root-owned frame geometry plus the downstream centre-module selection. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from './service.ts'
import {
  clampWidth, RIGHTBAR_DEFAULT_RATIO, RIGHTBAR_MAX_RATIO, RIGHTBAR_MIN,
  SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

/** Default center module: the conversation surface. */
export const DEFAULT_MODULE = 'conversation'

type LayoutInfo = {
  sidebar: number
  viewportWidth: number
  narrowExpanded: boolean
  rightbar: number | null
  rightbarShown: boolean
  rightbarTrack: boolean
  rightbarFullscreen: boolean
  rightbarInstant: boolean
}

type LayoutState = {
  /** Fork extension: the active centre module, mapped to the official panel face. */
  activeModule: string
  /** Official frame and rightbar presentation state. */
  layoutInfo: LayoutInfo
}

type LayoutActions = {
  selectPanel: (draft: LayoutState, panelId: MainPanelId | null) => void
  setSidebar: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setViewportWidth: (draft: LayoutState, width: number) => void
  setRightbar: (draft: LayoutState, px: number) => void
  openRightbar: (draft: LayoutState, track: boolean, fullscreen: boolean) => void
  closeRightbar: (draft: LayoutState) => void
  setActiveModule: (draft: LayoutState, module: string) => void
  openModule: (draft: LayoutState, module: string) => void
}

/** Create one root-entry layout store. */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions> {
  return defineStore({
    init: (): LayoutState => ({
      activeModule: DEFAULT_MODULE,
      layoutInfo: {
        sidebar: SIDEBAR_DEFAULT,
        viewportWidth: window.innerWidth,
        narrowExpanded: false,
        rightbar: null,
        rightbarShown: false,
        rightbarTrack: false,
        rightbarFullscreen: false,
        rightbarInstant: false,
      },
    }),
    actions: {
      selectPanel: (d, panelId: MainPanelId | null) => { d.activeModule = panelId ?? DEFAULT_MODULE },
      setSidebar: (d, px: number) => {
        d.layoutInfo.rightbarInstant = false
        d.layoutInfo.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX)
      },
      toggleSidebar: (d) => {
        d.layoutInfo.rightbarInstant = false
        if (d.layoutInfo.viewportWidth < SIDEBAR_AUTO_COLLAPSE) {
          d.layoutInfo.narrowExpanded = !d.layoutInfo.narrowExpanded
        } else {
          d.layoutInfo.sidebar = d.layoutInfo.sidebar === 0 ? SIDEBAR_DEFAULT : 0
        }
      },
      setViewportWidth: (d, width: number) => {
        if (d.layoutInfo.viewportWidth === width) return
        d.layoutInfo.rightbarInstant = false
        if ((d.layoutInfo.viewportWidth < SIDEBAR_AUTO_COLLAPSE) !== (width < SIDEBAR_AUTO_COLLAPSE)) {
          d.layoutInfo.narrowExpanded = false
        }
        d.layoutInfo.viewportWidth = width
      },
      setRightbar: (d, px: number) => {
        d.layoutInfo.rightbarInstant = false
        d.layoutInfo.rightbar = clampWidth(px, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, d.layoutInfo.viewportWidth * RIGHTBAR_MAX_RATIO))
      },
      openRightbar: (d, track: boolean, fullscreen: boolean) => {
        const info = d.layoutInfo
        if (!info.rightbarShown || info.rightbarTrack !== track || info.rightbarFullscreen !== fullscreen) {
          info.rightbarInstant = info.rightbarFullscreen && !fullscreen
        }
        if (!info.rightbarShown && info.viewportWidth < SIDEBAR_AUTO_COLLAPSE) info.narrowExpanded = false
        info.rightbar ??= Math.max(RIGHTBAR_MIN, Math.round(info.viewportWidth * RIGHTBAR_DEFAULT_RATIO))
        info.rightbarShown = true
        info.rightbarTrack = track
        info.rightbarFullscreen = fullscreen
      },
      closeRightbar: (d) => {
        const info = d.layoutInfo
        if (info.rightbarShown) info.rightbarInstant = info.rightbarFullscreen
        info.rightbarShown = false
        info.rightbarTrack = false
        info.rightbarFullscreen = false
      },
      setActiveModule: (d, module: string) => {
        d.activeModule = d.activeModule === module ? DEFAULT_MODULE : module
      },
      openModule: (d, module: string) => { d.activeModule = module },
    },
  })
}

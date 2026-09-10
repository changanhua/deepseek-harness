// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { LayoutController } from '../src/client/service.ts'
import { createLayoutStore } from '../src/client/stores.ts'

it('opens the same module repeatedly without toggling back to the conversation', () => {
  const layout = new LayoutController()
  const { store, actions } = createLayoutStore().create()
  layout.attachPanels(actions)
  layout.activateModule('content-library')
  layout.activateModule('content-library')
  expect(store.getSnapshot().activeModule).toBe('content-library')
  actions.activateModule('content-library')
  expect(store.getSnapshot().activeModule).toBe('conversation')
})

it('retains the latest initial navigation until the root entry mounts', () => {
  const layout = new LayoutController()
  layout.activateModule('queue')
  layout.activateModule('content-library')
  const { store, actions } = createLayoutStore().create()
  layout.attachPanels(actions)
  expect(store.getSnapshot().activeModule).toBe('content-library')
})

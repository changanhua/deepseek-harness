// @vitest-environment jsdom
/**
 * CaptureAction rendering over a real library store: only a settled
 * pure-text assistant message offers the entry, a click mints one operation
 * carrying just the session id, event sequence, and operation id, repeated
 * clicks share the in-flight attempt, success settles into a stable
 * "captured" state, and failures render their localized copy inline.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { AssistantMessageNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ContentReceipt } from '@changanhua/dsh-content/types'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { bindSnapshotSelector, chatSnapshot, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { CaptureAction } from '../src/client/CaptureAction.tsx'
import type { CaptureActionProps } from '../src/client/contract.ts'
import { ContentLibraryStore, type ContentLibraryRemote } from '../src/client/controller.ts'
import { contentErrorKey, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const MESSAGE_ID = 'm-1' as MessageId
const NODE_MESSAGE_ID = 'm-1' as MessageId
const SESSION = 's1' as SessionId
const t = makeTranslate(zh, commonZh)

/** One finalized assistant node over the given blocks. */
function node(overrides: Partial<AssistantMessageNode> = {}): AssistantMessageNode {
  return {
    kind: 'assistant', seq: 34, messageId: NODE_MESSAGE_ID, time: 1, turn: 1, step: 2,
    blocks: [{ kind: 'text', text: 'DONE' }],
    ...overrides,
  }
}

/** A Chat projection whose store holds exactly one assistant-step node. */
function chatWith(finalNode: AssistantMessageNode | undefined): ChatSnapshot {
  return chatSnapshot({
    nodes: {
      get: () => undefined,
      values: () => finalNode === undefined ? [] : [{
        key: 'assistant-step:1', kind: 'assistant-step', id: '1', target: 'chat',
        data: { status: 'settled', finalNode },
      } as never],
    },
  })
}

interface RemoteScript {
  capture?: (input: { operationId: string; sessionId: string; messageId: string }) => Promise<RemoteResult<ContentReceipt>>
}

/** A recording remote double; contentRemote reports failures on the carrier. */
function remote(script: RemoteScript = {}) {
  const calls: { method: string; args: unknown }[] = []
  const face: ContentLibraryRemote = {
    status: () => Promise.resolve({
      ok: true as const,
      value: { phase: 'ready', reason: null, limits: { bodyBytes: 1, entryBytes: 1, libraryBytes: 1 } },
    }),
    snapshot: () => Promise.resolve({ ok: true as const, value: { formatVersion: 1, entries: [] } }),
    get: () => Promise.resolve({ ok: true as const, value: null }),
    capture: (input) => {
      calls.push({ method: 'capture', args: { ...input } })
      const scripted = script.capture?.(input)
      return scripted ?? Promise.resolve({
        ok: true as const,
        value: { operationId: input.operationId, entryId: 'source_x', entryRevision: 1, draftRevision: null, versionId: 'v1' },
      })
    },
  }
  return { calls, face }
}

/** Mount the entry against a real store and the given Chat projection. */
function mount(options: { chat?: ChatSnapshot; store?: ContentLibraryStore; remote?: ContentLibraryRemote } = {}) {
  const store = options.store ?? new ContentLibraryStore(options.remote ?? remote().face)
  const useLibrary = bindSnapshotSelector(store)
  const chat = options.chat ?? chatWith(node())
  const useChat = (<T,>(select: (snapshot: ChatSnapshot) => T): T => select(chat)) as never
  // The verb rides the real store, bound to this session exactly as the
  // plugin body binds it.
  const capture = (target: { seq: number; messageId: string }) => store.capture(SESSION, target)
  const props = { messageId: MESSAGE_ID, sessionId: SESSION, useChat, useLibrary, capture, t } as unknown as CaptureActionProps
  return { ui: render(<CaptureAction {...props} />), store }
}

describe('CaptureAction', () => {
  it('offers capture for a settled pure-text assistant message', () => {
    const { ui } = mount()
    expect(ui.getByLabelText(zh['capture.action'])).toBeTruthy()
  })

  it('offers no entry for interrupted, reasoning, mixed, or synthetic messages', () => {
    const interrupted = chatWith(node({ interrupted: true }))
    const reasoning = chatWith(node({ blocks: [{ kind: 'reasoning', text: 'hmm' }, { kind: 'text', text: 'answer' }] }))
    const toolCall = chatWith(node({ blocks: [{ kind: 'tool-call', callId: 'c', name: 'read', argsRaw: '{}' }] }))
    const blank = chatWith(node({ blocks: [{ kind: 'text', text: '  ' }] }))
    const absent = chatWith(undefined)
    for (const chat of [interrupted, reasoning, toolCall, blank, absent]) {
      const { ui, store } = mount({ chat })
      expect(ui.container.querySelector('button')).toBeNull()
      store.dispose()
    }
  })

  it('sends only the session id, event sequence, and operation id, then settles captured', async () => {
    const { calls, face } = remote()
    const { ui } = mount({ remote: face })

    fireEvent.click(ui.getByLabelText(zh['capture.action']))
    await waitFor(() => {
      expect(ui.getByLabelText(`${zh['capture.captured']}: source_x`).getAttribute('aria-pressed')).toBe('true')
    })
    expect(calls).toHaveLength(1)
    const args = calls[0]?.args as { operationId: string; sessionId: string; messageId: string }
    // The wire payload names exactly the three command fields and nothing else.
    expect(Object.keys(args).sort()).toEqual(['messageId', 'operationId', 'sessionId'])
    expect(args).toMatchObject({ sessionId: SESSION, messageId: '34' })
    expect(args.operationId).toMatch(/^capture-ui:s1:34:[0-9a-f-]{36}$/u)
  })

  it('shares one in-flight attempt across repeated clicks', async () => {
    let release: (() => void) | undefined
    let wireCalls = 0
    const { face } = remote({
      capture: () => new Promise<RemoteResult<ContentReceipt>>((resolve) => {
        wireCalls += 1
        release = () => {
          resolve({
            ok: true as const,
            value: { operationId: 'op', entryId: 'source_x', entryRevision: 1, draftRevision: null, versionId: 'v1' },
          })
        }
      }),
    })
    const { ui, store } = mount({ remote: face })
    const button = () => ui.getByLabelText(zh['capture.pending']) as HTMLButtonElement

    fireEvent.click(ui.getByLabelText(zh['capture.action']))
    await waitFor(() => { expect(button().disabled).toBe(true) })
    fireEvent.click(button())
    release?.()
    await waitFor(() => { expect(wireCalls).toBe(1) })
    store.dispose()
  })

  it('renders localized copy for wire failures inline', async () => {
    const { face } = remote({
      capture: () => Promise.resolve({
        ok: false as const,
        error: { code: 'forbidden', message: 'Content operation failed: forbidden', details: {} },
      }),
    })
    const { ui, store } = mount({ remote: face })

    fireEvent.click(ui.getByLabelText(zh['capture.action']))
    const notice = await ui.findByRole('status')
    expect(notice.textContent).toBe(zh['error.forbidden'])
    store.dispose()
  })

  it('maps every Content error code to a dictionary key with a generic fallback', () => {
    expect(contentErrorKey('forbidden')).toBe('error.forbidden')
    expect(contentErrorKey('closed')).toBe('error.closed')
    expect(contentErrorKey('invalid_transition')).toBe('error.invalid_transition')
    expect(contentErrorKey('unavailable')).toBe('error.unavailable')
    expect(contentErrorKey('revision_conflict')).toBe('error.revision_conflict')
    expect(contentErrorKey('mystery-code')).toBe('error.generic')
    for (const code of ['forbidden', 'closed', 'invalid_transition', 'unavailable']) {
      expect(zh[contentErrorKey(code)]).toBeTruthy()
    }
  })
})

import { describe, expect, it, vi } from 'vitest'
import { DshControlPlane } from '../src/control-plane.ts'
import { ControlAttentions } from '../src/attention.ts'

describe('DSH control plane', () => {
  it('binds the run to one session and deduplicates the same prompt request', async () => {
    const create = vi.fn(async () => ({ sessionId: 'session-1', agentPreset: 'cordis' }))
    const prompt = vi.fn(async () => ({ accepted: true as const }))
    const control = new DshControlPlane({
      runId: 'run-1',
      sessions: {
        create,
        prompt,
        cancel: () => ({ accepted: true }),
        inspect: async sessionId => ({ meta: { id: sessionId }, events: [] }),
        getAgent: () => undefined,
      },
    })
    const signal = new AbortController().signal

    await expect(control.handle({
      runId: 'run-1', requestId: 'open-1', method: 'session_open',
      params: { cwd: 'C:/task', sessionId: 'session-1', agentPreset: 'cordis' },
    }, signal)).resolves.toEqual({ sessionId: 'session-1', agentPreset: 'cordis', runId: 'run-1' })

    const request = {
      runId: 'run-1', requestId: 'prompt-1', method: 'session_prompt' as const,
      params: { sessionId: 'session-1', text: '完成网页任务', mode: 'queue' as const },
    }
    await expect(control.handle(request, signal)).resolves.toEqual({ accepted: true })
    await expect(control.handle(request, signal)).resolves.toEqual({ accepted: true })
    expect(prompt).toHaveBeenCalledOnce()
    await expect(control.handle({
      runId: 'run-1', requestId: 'receipt-1', method: 'request_receipt',
      params: { requestId: 'prompt-1' },
    }, signal)).resolves.toEqual({
      requestId: 'prompt-1', found: true, method: 'session_prompt',
      status: 'fulfilled', value: { accepted: true },
    })
    await expect(control.handle({
      runId: 'run-1', requestId: 'receipt-2', method: 'request_receipt',
      params: { requestId: 'missing' },
    }, signal)).resolves.toEqual({ requestId: 'missing', found: false })

    const cancel = {
      runId: 'run-1', requestId: 'cancel-1', method: 'session_cancel' as const,
      params: { sessionId: 'session-1' },
    }
    await expect(control.handle(cancel, signal)).resolves.toEqual({ accepted: true })
    await expect(control.handle(cancel, signal)).resolves.toEqual({ accepted: true })

    await expect(control.handle({
      runId: 'run-1', requestId: 'prompt-2', method: 'session_prompt',
      params: { sessionId: 'session-2', text: '越界', mode: 'queue' },
    }, signal)).rejects.toThrow('session is not bound to this control run')
    await expect(control.handle({
      runId: 'another-run', requestId: 'events-1', method: 'session_events',
      params: { sessionId: 'session-1' },
    }, signal)).rejects.toThrow('runId does not match this control run')
  })

  it('requires a listed installation and tab before taking a browser snapshot', async () => {
    const execute = vi.fn(async (operation: { action: { kind: string } }) => operation.action.kind === 'tabs'
      ? {
        requestId: 'browser-tabs', sessionId: 'session-1', installationId: 'install-1',
        outcome: 'observed', delivery: 'sent',
        value: { tabs: [{ tabId: 7, url: 'https://example.test/article' }] },
      }
      : {
        requestId: 'browser-snapshot', sessionId: 'session-1', installationId: 'install-1',
        outcome: 'observed', delivery: 'sent',
        value: {
          page: { tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/article' },
          text: 'Article', textTruncated: false,
        },
      })
    const control = new DshControlPlane({
      runId: 'run-1',
      sessions: {
        create: async () => ({ sessionId: 'session-1' }),
        prompt: async () => ({ accepted: true }),
        cancel: () => ({ accepted: true }),
        inspect: async sessionId => ({ meta: { id: sessionId }, events: [] }),
        getAgent: () => undefined,
      },
      browser: {
        instances: async () => [{
          installationId: 'install-1', extensionId: 'extension-1', online: true,
          grantEpoch: 1, origins: ['https://example.test'], scopes: ['browser:read'],
        }],
        execute,
      },
    })
    const signal = new AbortController().signal
    await control.handle({
      runId: 'run-1', requestId: 'open-1', method: 'session_open',
      params: { sessionId: 'session-1', cwd: 'C:/task' },
    }, signal)

    await expect(control.handle({
      runId: 'run-1', requestId: 'snapshot-before-tabs', method: 'browser_snapshot',
      params: { sessionId: 'session-1', installationId: 'install-1', tabId: 7, frameId: 0 },
    }, signal)).rejects.toThrow('installation is not bound to this control run')

    await expect(control.handle({
      runId: 'run-1', requestId: 'instances-1', method: 'browser_instances',
      params: { sessionId: 'session-1' },
    }, signal)).resolves.toMatchObject({ instances: [{ installationId: 'install-1' }] })
    await expect(control.handle({
      runId: 'run-1', requestId: 'tabs-1', method: 'browser_tabs',
      params: { sessionId: 'session-1', installationId: 'install-1' },
    }, signal)).resolves.toMatchObject({ outcome: 'observed', value: { tabs: [{ tabId: 7 }] } })
    await expect(control.handle({
      runId: 'run-1', requestId: 'snapshot-unknown-tab', method: 'browser_snapshot',
      params: { sessionId: 'session-1', installationId: 'install-1', tabId: 8, frameId: 0 },
    }, signal)).rejects.toThrow('page is not present in the latest browser tab observation')
    await expect(control.handle({
      runId: 'run-1', requestId: 'snapshot-1', method: 'browser_snapshot',
      params: { sessionId: 'session-1', installationId: 'install-1', tabId: 7, frameId: 0, tree: true },
    }, signal)).resolves.toMatchObject({
      outcome: 'observed',
      value: { page: { tabId: 7, frameId: 0, documentId: 'doc-1' } },
    })
    await expect(control.handle({
      runId: 'run-1', requestId: 'inspect-1', method: 'browser_entry_inspect',
      params: {
        sessionId: 'session-1', installationId: 'install-1',
        regionSelector: 'main', selector: ':scope article', titleSelector: 'h2', linkSelector: 'a',
      },
    }, signal)).resolves.toMatchObject({ outcome: 'observed' })
    expect(execute).toHaveBeenLastCalledWith({
      sessionId: 'session-1', installationId: 'install-1',
      action: {
        kind: 'entry_inspect',
        page: { tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/article' },
        regionSelector: 'main', selector: ':scope article', titleSelector: 'h2', linkSelector: 'a',
      },
    }, signal)
  })

  it('waits for idle and exports only Host-observed evidence for the bound session', async () => {
    const events = [
      { seq: 0, type: 'turn/start', time: 1, data: { turn: 0 } },
      { seq: 1, type: 'assistant/message', time: 2, data: { content: [] } },
      { seq: 2, type: 'turn/end', time: 3, data: { turn: 0, reason: { kind: 'completed' } } },
    ]
    const agent = {
      status: 'running' as 'idle' | 'running',
      whenIdle: vi.fn(async () => { agent.status = 'idle' }),
    }
    const control = new DshControlPlane({
      runId: 'run-1',
      sessions: {
        create: async () => ({ sessionId: 'session-1' }),
        prompt: async () => ({ accepted: true }),
        cancel: () => ({ accepted: true }),
        inspect: async sessionId => ({ meta: { id: sessionId, cwd: 'C:/task' }, events }),
        getAgent: sessionId => sessionId === 'session-1' ? agent : undefined,
      },
      cordis: {
        inventory: () => [
          { pluginId: 'collect-1', agentId: 'session-1', packages: [], activeRun: { pluginRunId: 'run-9', packageId: 'pkg-1' } },
          { pluginId: 'other-1', agentId: 'session-2', packages: [] },
        ],
      },
    })
    const signal = new AbortController().signal
    await control.handle({
      runId: 'run-1', requestId: 'open-1', method: 'session_open',
      params: { sessionId: 'session-1', cwd: 'C:/task' },
    }, signal)

    await expect(control.handle({
      runId: 'run-1', requestId: 'wait-1', method: 'session_wait',
      params: { sessionId: 'session-1', afterSeq: 0, timeoutMs: 1000 },
    }, signal)).resolves.toEqual({
      sessionId: 'session-1', status: 'idle', cursor: 2, timedOut: false,
      phase: 'completed', attention: [], latestSeq: 2, hasMore: false,
      events: events.slice(1),
    })
    expect(agent.whenIdle).toHaveBeenCalledOnce()

    await expect(control.handle({
      runId: 'run-1', requestId: 'events-1', method: 'session_events',
      params: { sessionId: 'session-1', afterSeq: 1, limit: 1 },
    }, signal)).resolves.toEqual({ sessionId: 'session-1', cursor: 2, latestSeq: 2, hasMore: false, events: [events[2]] })
    await expect(control.handle({
      runId: 'run-1', requestId: 'cordis-1', method: 'cordis_inspect',
      params: { sessionId: 'session-1' },
    }, signal)).resolves.toEqual({ plugins: [{
      pluginId: 'collect-1', agentId: 'session-1', packages: [],
      activeRun: { pluginRunId: 'run-9', packageId: 'pkg-1' },
    }] })
    await expect(control.handle({
      runId: 'run-1', requestId: 'evidence-1', method: 'evidence_export',
      params: { sessionId: 'session-1' },
    }, signal)).resolves.toMatchObject({
      runId: 'run-1',
      binding: { sessionId: 'session-1' },
      session: { meta: { id: 'session-1' }, cursor: 2, events },
      cordis: { plugins: [{ pluginId: 'collect-1' }] },
      operations: { writes: 1, waits: 1 },
    })
  })

  it('observes the current phase and exposes an unanswered user question', async () => {
    const attention = new ControlAttentions()
    const answering = attention.ask('session-1', { questions: [{ id: 'next', question: '继续吗？' }] })
    const events = [
      { seq: 0, type: 'turn/start', time: 1, data: { turn: 0 } },
      {
        seq: 1,
        type: 'tool/call',
        time: 2,
        data: {
          turn: 0,
          step: 1,
          callId: 'question-1',
          name: 'ask_user_question',
          arguments: JSON.stringify({ questions: [{ id: 'next', question: '继续吗？' }] }),
        },
      },
    ]
    const control = new DshControlPlane({
      runId: 'run-1',
      attention,
      sessions: {
        create: async () => ({ sessionId: 'session-1' }),
        prompt: async () => ({ accepted: true }),
        cancel: () => ({ accepted: true }),
        inspect: async sessionId => ({ meta: { id: sessionId }, events }),
        getAgent: () => ({ status: 'running' as const, whenIdle: async () => {} }),
      },
    })
    const signal = new AbortController().signal
    await control.handle({
      runId: 'run-1', requestId: 'open-1', method: 'session_open',
      params: { sessionId: 'session-1', cwd: 'C:/task' },
    }, signal)

    await expect(control.handle({
      runId: 'run-1', requestId: 'observe-1', method: 'session_observe',
      params: { sessionId: 'session-1' },
    }, signal)).resolves.toEqual({
      runId: 'run-1',
      sessionId: 'session-1',
      status: 'running',
      phase: 'waiting_for_attention',
      cursor: 1,
      attention: [{
        kind: 'user_question',
        attentionId: expect.any(String) as string,
        questions: [{ id: 'next', question: '继续吗？' }],
      }],
    })
    attention.answer('session-1', attention.list('session-1')[0]!.attentionId, { answers: [{ id: 'next', selected: [] }] })
    await answering
  })

  it('answers the pending user question through the bound control run', async () => {
    const attention = new ControlAttentions()
    const answering = attention.ask('session-1', {
      questions: [{ id: 'next', question: '继续吗？', options: [{ label: '继续' }] }],
    })
    const attentionId = attention.list('session-1')[0]!.attentionId
    const control = new DshControlPlane({
      runId: 'run-1',
      attention,
      sessions: {
        create: async () => ({ sessionId: 'session-1' }),
        prompt: async () => ({ accepted: true }),
        cancel: () => ({ accepted: true }),
        inspect: async sessionId => ({ meta: { id: sessionId }, events: [] }),
        getAgent: () => undefined,
      },
    })
    const signal = new AbortController().signal
    await control.handle({
      runId: 'run-1', requestId: 'open-1', method: 'session_open',
      params: { sessionId: 'session-1', cwd: 'C:/task' },
    }, signal)

    const request = {
      runId: 'run-1', requestId: 'answer-1', method: 'session_attention_answer',
      params: {
        sessionId: 'session-1', attentionId,
        answers: [{ id: 'next', selected: ['继续'] }],
      },
    } as const
    await expect(control.handle(request, signal)).resolves.toEqual({ answered: true })
    await expect(answering).resolves.toEqual({
      answers: [{ id: 'next', selected: ['继续'] }],
    })
    expect(attention.list('session-1')).toEqual([])
    await expect(control.handle(request, signal)).resolves.toEqual({ answered: true })
    await expect(control.handle({ ...request, params: { ...request.params, answers: [{ id: 'next', selected: [] }] } }, signal))
      .rejects.toThrow('requestId was already used')
    const stale = { ...request, requestId: 'stale-answer' }
    await expect(control.handle(stale, signal)).rejects.toThrow('no longer pending')
    await expect(control.handle({
      runId: 'run-1', requestId: 'lookup', method: 'request_receipt', params: { requestId: stale.requestId },
    }, signal)).resolves.toMatchObject({ found: true, status: 'rejected', error: { message: 'attention is no longer pending for this Session' } })
    await expect(control.handle({ ...stale, params: { ...stale.params, answers: [] } }, signal))
      .rejects.toThrow('requestId was already used')
  })

  it.each([
    ['completed', { type: 'turn/end', data: { reason: { kind: 'completed' } } }],
    ['failed', { type: 'turn/end', data: { reason: { kind: 'error' } } }],
    ['cancelled', { type: 'turn/end', data: { reason: { kind: 'aborted' } } }],
  ] as const)('maps an idle turn end to the %s phase', async (phase, tail) => {
    const control = new DshControlPlane({
      runId: 'run-1',
      sessions: {
        create: async () => ({ sessionId: 'session-1' }),
        prompt: async () => ({ accepted: true }),
        cancel: () => ({ accepted: true }),
        inspect: async sessionId => ({
          meta: { id: sessionId },
          events: [{ seq: 0, type: tail.type, time: 1, data: tail.data }],
        }),
        getAgent: () => ({ status: 'idle' as const, whenIdle: async () => {} }),
      },
    })
    const signal = new AbortController().signal
    await control.handle({
      runId: 'run-1', requestId: 'open-1', method: 'session_open',
      params: { sessionId: 'session-1', cwd: 'C:/task' },
    }, signal)

    await expect(control.handle({
      runId: 'run-1', requestId: `observe-${phase}`, method: 'session_observe',
      params: { sessionId: 'session-1' },
    }, signal)).resolves.toMatchObject({ status: 'idle', phase, cursor: 0 })
  })

  it('bounds retained write receipts without breaking an existing idempotent replay', async () => {
    const control = new DshControlPlane({
      runId: 'run-1',
      maxWriteReceipts: 2,
      sessions: {
        create: async () => ({ sessionId: 'session-1' }),
        prompt: async () => ({ accepted: true }),
        cancel: () => ({ accepted: true }),
        inspect: async sessionId => ({ meta: { id: sessionId }, events: [] }),
        getAgent: () => undefined,
      },
    })
    const signal = new AbortController().signal
    await control.handle({
      runId: 'run-1', requestId: 'open-1', method: 'session_open',
      params: { sessionId: 'session-1', cwd: 'C:/task' },
    }, signal)
    const first = {
      runId: 'run-1', requestId: 'prompt-1', method: 'session_prompt' as const,
      params: { sessionId: 'session-1', text: 'first', mode: 'queue' as const },
    }
    await control.handle(first, signal)
    await expect(control.handle({
      runId: 'run-1', requestId: 'prompt-2', method: 'session_prompt',
      params: { sessionId: 'session-1', text: 'second', mode: 'queue' },
    }, signal)).rejects.toThrow('write receipt capacity is exhausted')
    await expect(control.handle(first, signal)).resolves.toEqual({ accepted: true })
  })
})

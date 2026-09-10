/** Real built CLI, Host, Session and question service; only the external model response is scripted. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { describe, expect, it } from 'vitest'

describe('Codex to DSH development round', () => {
  it('observes, answers, steers and receives the settled result through a managed Host', { timeout: 60_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-control-round-'))
    const hostHome = join(root, 'host')
    const profileDir = join(hostHome, 'profiles', 'web')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n')
    const model = await startMockLlmServer({
      sequence: ['tool_call_success', 'success', 'slow_success'], repeatLast: false,
      toolName: 'ask_user_question',
      toolArguments: JSON.stringify({ questions: [{ id: 'next', question: 'Choose the next development step.' }] }),
      successText: 'Development round continued after the answer.',
      chunkDelayMs: 100,
    })
    const repository = resolve(import.meta.dirname, '../../../..')
    const transport = new StdioClientTransport({
      command: process.execPath, args: [join(repository, 'apps/cli/lib/bin.js'), '--profile', 'control-mcp'],
      cwd: root, stderr: 'pipe',
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
        DSH_HOME: join(root, 'connector'), DSH_CONTROL_HOST_HOME: hostHome,
        DSH_CONTROL_RUN_ID: 'development-round', DSH_CONTROL_AUTOSTART: 'true',
        DEEPSEEK_API_KEY: 'local-scripted-model', DEEPSEEK_BASE_URL: model.baseURL,
        DSH_TELEMETRY_DISABLED: '1',
      },
    })
    let diagnostic = ''
    transport.stderr?.on('data', (chunk) => { diagnostic = (diagnostic + String(chunk)).slice(-12_000) })
    const client = new Client({ name: 'independent-roundtrip-check', version: '1' })
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args })
      if (result.isError) throw new Error(JSON.stringify(result.content))
      return (result.structuredContent as { result: Record<string, unknown> }).result
    }
    try {
      await client.connect(transport)
      const runtime = await call('dsh_runtime_status')
      expect(runtime).toMatchObject({ runId: 'development-round', sessionId: null, identity: {
        pid: expect.any(Number), profile: 'web', dshHome: hostHome,
        code: { face: 'built', sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) },
      } })
      await expect(call('dsh_runtime_inspect', {
        view: 'plugins', query: 'control-mcp/host', limit: 5,
      })).resolves.toMatchObject({
        view: 'plugins', matched: 1, truncated: false,
        entries: [{ moduleName: '@changanhua/dsh-control-mcp/host', enabled: true, fiberPhase: 'active' }],
      })
      const { sessionId } = await call('dsh_session_open', { requestId: 'open', cwd: root, agentPreset: 'standard' })
      await expect(call('dsh_runtime_inspect', {
        view: 'capabilities', query: 'ask_user_question', limit: 5,
      })).resolves.toMatchObject({
        view: 'capabilities', sessionId,
        tools: { matched: 1, entries: [{ name: 'ask_user_question' }] },
      })
      await call('dsh_session_prompt', { requestId: 'prompt', sessionId, text: 'Ask for my next step, then continue.' })
      const waiting = await call('dsh_session_wait', { sessionId, timeoutMs: 15_000 })
      expect(waiting, JSON.stringify(waiting)).toMatchObject({ phase: 'waiting_for_attention', timedOut: false })
      const questions = waiting.attention as Array<{ attentionId: string }>
      expect(questions).toHaveLength(1)
      const observed = await call('dsh_session_observe', { sessionId })
      expect(observed.attention).toEqual(waiting.attention)
      const steering = 'Retain this steering instruction in the resumed model request.'
      await call('dsh_session_prompt', { requestId: 'steer', sessionId, mode: 'steer', text: steering })
      const answer = { requestId: 'answer', sessionId, attentionId: questions[0]!.attentionId,
        answers: [{ id: 'next', selected: [], custom: 'Inspect the focused package result.' }] }
      await expect(call('dsh_session_attention_answer', answer)).resolves.toEqual({ answered: true })
      await expect(call('dsh_session_attention_answer', answer)).resolves.toEqual({ answered: true })
      await expect(call('dsh_request_receipt', { requestId: 'answer' })).resolves.toMatchObject({
        found: true, method: 'session_attention_answer', status: 'fulfilled', value: { answered: true },
      })
      const done = await call('dsh_session_wait', { sessionId, afterSeq: waiting.cursor, timeoutMs: 15_000 })
      expect(done, JSON.stringify(done)).toMatchObject({ phase: 'completed', attention: [], timedOut: false })
      const evidence = await call('dsh_evidence_export', { sessionId })
      const events = (evidence.session as { events: Array<{ type: string; data: unknown }> }).events
      expect(events.some(event => event.type === 'tool/result' && JSON.stringify(event.data).includes('Inspect the focused package result.'))).toBe(true)
      // The separately owned model server witnesses what the next real model request consumed.
      expect(model.requests).toHaveLength(2)
      expect(JSON.stringify(model.requests[1]!.body)).toContain('Inspect the focused package result.')
      expect(JSON.stringify(model.requests[1]!.body)).toContain(steering)
      expect(evidence.observation).toMatchObject({ phase: 'completed', attention: [] })
      await call('dsh_session_prompt', { requestId: 'cancel-prompt', sessionId, text: 'Start cancellable work.' })
      await expect.poll(() => model.requests.length, { timeout: 10_000 }).toBe(3)
      await call('dsh_session_cancel', { requestId: 'cancel', sessionId })
      await expect(call('dsh_request_receipt', { requestId: 'cancel' })).resolves.toMatchObject({
        found: true, method: 'session_cancel', status: 'fulfilled', value: { accepted: true },
      })
      const cancelled = await call('dsh_session_wait', { sessionId, afterSeq: done.cursor, timeoutMs: 15_000 })
      expect(cancelled, JSON.stringify(cancelled)).toMatchObject({ phase: 'cancelled', timedOut: false })
      await call('dsh_control_close')
      const pid = (runtime.identity as { pid: number }).pid
      expect(() => process.kill(pid, 0)).toThrow()
    } catch (error) {
      throw new Error(`${String(error)}\n${diagnostic}`, { cause: error })
    } finally {
      await client.close()
      await transport.close()
      await model.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

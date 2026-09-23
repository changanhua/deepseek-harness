/** @vitest-environment jsdom */
/** @vitest-environment-options {"url":"https://example.test/catalog"} */
import { afterEach, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { browserObservationMeta } from '../src/observation-meta.ts'
import { createSemanticMapTool, createSourceReadTool, semanticMapSourceProjectionDefinition } from '../src/semantic-map.ts'

const page = { tabId: 7, frameId: 0, documentId: 'catalog-document', url: 'https://example.test/catalog' }
const execution = { signal: new AbortController().signal } as ToolRunContext
const rawSource = readFileSync(resolve(import.meta.dirname, '../../../../apps/chrome-extension/src/browser-page.js'), 'utf8')
type BrowserAssistant = {
  snapshot(options: object): {
    snapshotId: string
    source: {
      version: number
      extractorVersion: string
      contentBlocks: Array<{ blockId: string; text: string; kind: string }>
      omissions: string[]
    }
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  delete (globalThis as typeof globalThis & { __dshBrowserAssistant?: unknown }).__dshBrowserAssistant
})

it('将真实采集的 v2 来源送过 Host 投影、读取收据和地图发布', async () => {
  document.body.innerHTML = '<main><h1>Team catalog</h1><section>'
    + '<a href="/catalog/alpha"><div><span>Alpha Workbench</span><span>2 seats</span>'
    + '<span>Monthly plan includes shared notes and audit history.</span></div></a>'
    + '<a href="/catalog/beta"><div><span>Beta Workbench</span><span>5 seats</span>'
    + '<span>Annual plan includes exports and team permissions.</span></div></a></section></main>'
  if (typeof rawSource !== 'string') throw new Error('browser page source is not text')
  globalThis.eval(rawSource)
  const assistant = (globalThis as typeof globalThis & { __dshBrowserAssistant?: BrowserAssistant }).__dshBrowserAssistant
  if (!assistant) throw new Error('browser page assistant was not installed')
  const captured = assistant.snapshot({ textLimit: 0 })
  expect(captured.source.extractorVersion).toBe('browser-source-v2')
  expect(captured.source.contentBlocks.map(block => block.kind)).toEqual(['heading', 'record', 'record'])

  const session = Session.create(SessionId('semantic-v2-pipeline'))
  session.append('browser-target/change', { kind: 'browser-target/change', version: 1, revision: 1,
    binding: { installationId: 'installation', page, revision: 1, boundAt: Date.now(), boundBy: 'user' } })
  const snapshotCallId = ToolCallId('snapshot-v2')
  const snapshotCall = session.append('tool/call', { turn: 1, step: 1, callId: snapshotCallId,
    name: 'browser_snapshot', arguments: '{}' })
  const meta = browserObservationMeta({ requestId: 'request', sessionId: session.id, installationId: 'installation',
    outcome: 'observed', delivery: 'sent', value: { page, snapshotId: captured.snapshotId, source: captured.source } })
  const unsupported = browserObservationMeta({ requestId: 'request-v3', sessionId: session.id, installationId: 'installation',
    outcome: 'observed', delivery: 'sent', value: { page, snapshotId: 'unsupported',
      source: { ...captured.source, extractorVersion: 'browser-source-v3' } } })
  expect((unsupported as { browserObservation: { result: { value: object } } }).browserObservation.result.value).not.toHaveProperty('source')
  session.append('tool/result', { turn: 1, step: 1,
    message: createToolResultMessage({ callId: snapshotCallId, content: [], isError: false }), meta,
  }, { surfaceOp: 'append', sourceEventSeqs: [snapshotCall.seq] })
  const sourceState = () => session.events.reduce((state, event) => semanticMapSourceProjectionDefinition.apply(state, event),
    semanticMapSourceProjectionDefinition.init({ id: session.id } as SessionHeader))
  expect(sourceState().sources[0]?.snapshot.blocks).toHaveLength(3)

  const readCandidate: unknown = await createSourceReadTool(sourceState).execute({ snapshotId: captured.snapshotId, offset: 0 }, execution)
  if (!readCandidate || typeof readCandidate !== 'object' || !('blocks' in readCandidate)
    || !Array.isArray(readCandidate.blocks) || !('sourceResultSeq' in readCandidate)
    || typeof readCandidate.sourceResultSeq !== 'number') throw new Error('source read result is invalid')
  const read = readCandidate as { blocks: Array<{ blockId: string }>; sourceResultSeq: number }
  expect(read.blocks.map(block => block.blockId)).toEqual(['block-0', 'block-1', 'block-2'])
  const readCallId = ToolCallId('read-v2')
  const readCall = session.append('tool/call', { turn: 1, step: 2, callId: readCallId,
    name: 'browser_read_source', arguments: '{}' })
  session.append('tool/result', { turn: 1, step: 2,
    message: createToolResultMessage({ callId: readCallId, content: [], isError: false }),
    meta: { semanticSourceRead: { version: 1, sourceResultSeq: read.sourceResultSeq,
      snapshotId: captured.snapshotId, blockIds: read.blocks.map(block => block.blockId) } },
  }, { surfaceOp: 'append', sourceEventSeqs: [readCall.seq] })
  const publishedCandidate: unknown = await createSemanticMapTool(sourceState).execute({ snapshotId: captured.snapshotId, nodes: [
    { parentIndex: -1, label: 'Team plans', summary: 'Two catalog options', sourceRefs: ['block-0'] },
    { parentIndex: 0, label: 'Alpha option', summary: 'Monthly plan for two seats', sourceRefs: ['block-1'] },
    { parentIndex: 0, label: 'Beta option', summary: 'Annual plan for five seats', sourceRefs: ['block-2'] },
  ] }, execution)
  if (!publishedCandidate || typeof publishedCandidate !== 'object' || !('snapshotId' in publishedCandidate)
    || !('nodes' in publishedCandidate) || !Array.isArray(publishedCandidate.nodes)) throw new Error('semantic map publication is invalid')
  const published = publishedCandidate as { snapshotId: string; nodes: unknown[] }
  expect(published.snapshotId).toBe(captured.snapshotId)
  expect(published.nodes).toHaveLength(3)
})

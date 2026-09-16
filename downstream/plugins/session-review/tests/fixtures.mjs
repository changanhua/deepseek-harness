/** Synthetic values shaped after the pinned DSH v3 public contracts, not live execution evidence. */
import { createHash } from 'node:crypto';
import { selectEvidence, REVIEW_INSTRUCTIONS, snapshotDigestInput, PRESET } from '../contract.mjs';
export const request = Object.freeze({ version: 0, sourceId: 'source-one', fromSeq: 0, throughSeq: null,
  maxEvents: 300, provider: 'chosen-provider', model: 'chosen-model', perspective: 'diagnose', focus: '',
  maxTokens: 4096, timeoutMs: 180000 });
export function event(seq, type, data) { return { seq, type, time: 1000 + seq, data }; }
export function user(text = 'Compare these options') {
  return { id: 'message-one', role: 'user', source: { kind: 'user', rpcId: 'source-request' }, content: [{ type: 'text', text }] };
}
export function assistant(text = 'An answer') {
  return { turn: 1, step: 1, message: { id: 'assistant-one', role: 'assistant', source: { kind: 'model', provider: 'original', model: 'original-model', replayState: { private: 'do-not-transfer' } },
    content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text }] },
    stream: [[123, 'private-stream']], usage: { inputTokens: 5, outputTokens: 10 } };
}
export function sourceEvents() {
  return [event(0, 'turn/start', { turn: 1 }), event(1, 'system/message', { message: { content: [{ type: 'text', text: 'private system prompt' }] } }),
    event(2, 'user/message', user()), event(3, 'assistant/message', assistant()), event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } })];
}
export function snapshot(input = request, events = sourceEvents()) {
  const selected = selectEvidence(events, input);
  const body = { version: 0, request: input, source: { id: input.sourceId, version: 3, createdAt: 1,
    fromSeq: selected.fromSeq, throughSeq: selected.throughSeq }, selectedEventCount: selected.selectedEventCount,
    omittedEventCount: selected.omittedEventCount, capturedAt: 2000, evidence: selected.evidence, instructions: REVIEW_INSTRUCTIONS };
  return { ...body, digest: `sha256:${createHash('sha256').update(snapshotDigestInput(body)).digest('hex')}` };
}
export function report() {
  return { observations: [{ claim: 'The source requested a comparison.', evidenceIds: ['E2'] }],
    hypotheses: [{ cause: 'Criteria may be underspecified.', evidenceIds: ['E2'], uncertainty: 'The omitted context was not inspected.' }],
    experiments: [{ change: 'Ask for explicit comparison criteria.', check: 'Compare accepted results.', evidenceIds: [] }] };
}
export function memoryStorage() {
  const map = new Map();
  return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
}
export function remoteHarness(storage = memoryStorage()) {
  const calls = [];
  const remote = { $host: { home: 'isolated-test-home' }, session: {
    create: async input => { calls.push(['create', input]); return { ok: true, value: { sessionId: input.sessionId, agentPreset: PRESET } }; },
    rename: async input => { calls.push(['rename', input]); return { ok: true, value: { title: input.title, seq: 0 } }; },
    prompt: async input => { calls.push(['prompt', input]); return { ok: true, value: { accepted: true } }; },
    cancel: async input => { calls.push(['cancel', input]); return { ok: true, value: { accepted: true } }; },
    modelCatalog: async () => ({ ok: true, value: { groups: [], failures: [], routableProviders: [], default: {} } }),
  } };
  const sessions = { refresh: async () => { calls.push(['refresh']); } };
  let serial = 0;
  return { remote, sessions, storage, calls, uuid: () => `test-id-${++serial}` };
}

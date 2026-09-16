import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, encodeRequest, decodeRequest, selectEvidence, encodeSnapshot, decodeSnapshot,
  verifySnapshotDigest, validateReport, bytes, LIMITS, SNAPSHOT_MARKER } from '../contract.mjs';
import { request, sourceEvents, snapshot, report, event, user, assistant } from './fixtures.mjs';

test('requests round-trip with explicit analyzer route and perspective', () => {
  assert.deepEqual(decodeRequest(encodeRequest(request)), request);
  assert.equal(validateRequest({ ...request, perspective: 'countercheck' }).perspective, 'countercheck');
});
test('request rejects unknown version, fields, route and invalid boundaries', () => {
  for (const mutation of [{ version: 1 }, { extra: true }, { provider: '' }, { fromSeq: -0 }, { fromSeq: -1 },
    { throughSeq: -1 }, { maxEvents: 301 }, { maxTokens: 4097 }, { timeoutMs: 0 }, { perspective: 'arbitrary-agent' }]) {
    assert.throws(() => validateRequest({ ...request, ...mutation }));
  }
});
test('UTF-8 rather than JS string length bounds focus', () => {
  assert.throws(() => validateRequest({ ...request, focus: '汉'.repeat(683) }), /focus/);
  assert.equal(bytes(validateRequest({ ...request, focus: '汉'.repeat(682) }).focus), 2046);
});
test('plain prompts and oversized request wrappers reject', () => {
  assert.throws(() => decodeRequest('run the previous task'));
  assert.throws(() => decodeRequest(encodeRequest(request) + 'x'.repeat(10000)), /large/);
});
test('freezes inclusive tail and does not mutate source', () => {
  const events = sourceEvents(); const before = structuredClone(events);
  const result = selectEvidence(events, request);
  assert.equal(result.throughSeq, 4); assert.equal(result.selectedEventCount, 5);
  assert.deepEqual(result.evidence.map(item => item.id), ['E0', 'E2', 'E3', 'E4']);
  assert.deepEqual(events, before);
  events.push(event(5, 'step/end', { turn: 2, step: 1 }));
  assert.equal(result.throughSeq, 4);
});
test('explicit range, gaps and event ceiling cannot silently clip', () => {
  assert.equal(selectEvidence(sourceEvents(), { ...request, fromSeq: 2, throughSeq: 3 }).evidence.length, 2);
  assert.throws(() => selectEvidence(sourceEvents(), { ...request, throughSeq: 7 }), /boundary/);
  assert.throws(() => selectEvidence(sourceEvents().filter(item => item.seq !== 2), request), /gap/);
  assert.throws(() => selectEvidence(sourceEvents(), { ...request, maxEvents: 4 }), /source events/);
});
test('omits private system, injected context, reasoning and provider replay state', () => {
  const events = sourceEvents();
  events.push(event(5, 'user/message', { ...user('PRIVATE INJECTION'), source: { kind: 'plugin', plugin: 'private' } }));
  events.push(event(6, 'request/header', { credentials: 'NEVER EXPORT' }));
  const result = selectEvidence(events, request);
  const serialized = JSON.stringify(result);
  for (const secret of ['private system prompt', 'private reasoning', 'private-stream', 'do-not-transfer', 'PRIVATE INJECTION', 'NEVER EXPORT']) assert.equal(serialized.includes(secret), false);
  assert.equal(result.omittedEventCount, 3);
  assert.equal(result.evidence.find(item => item.seq === 3).data.message.source.provider, 'original');
});
test('tool result keeps nested visible text and failure, removes attachments and opaque metadata', () => {
  const events = [event(0, 'tool/result', { turn: 1, step: 1, meta: { hidden: 'PRIVATE META' },
    message: { id: 'tool-result', role: 'user', source: { kind: 'tool', callId: 'call' }, content: [{ type: 'tool-result', toolCallId: 'call', isError: true,
      content: [{ type: 'text', text: 'stale_document' }, { type: 'image', attachment: { data: 'IMAGE BYTES' } }] }] } })];
  const result = selectEvidence(events, request).evidence[0];
  assert.equal(result.data.message.content[0].isError, true);
  assert.equal(result.data.message.content[0].content[0].text, 'stale_document');
  assert.equal(JSON.stringify(result).includes('IMAGE BYTES'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE META'), false);
  assert.ok(result.omitted.includes('data.meta'));
});
test('complete emitted snapshot is byte bounded and its digest verifies', async () => {
  const value = snapshot(); const encoded = encodeSnapshot(value);
  assert.ok(bytes(encoded) < LIMITS.snapshotBytes);
  assert.deepEqual(decodeSnapshot(encoded), value);
  await verifySnapshotDigest(value);
  const changed = structuredClone(value); changed.evidence[1].data.content[0].text = 'changed';
  await assert.rejects(verifySnapshotDigest(changed), /digest mismatch/);
  assert.throws(() => encodeSnapshot(snapshot(request, [event(0, 'user/message', user('汉'.repeat(50000)))])), /byte limit/);
});
test('snapshot rejects extra fields, false counts, duplicate references and instruction drift', () => {
  const original = snapshot();
  for (const mutate of [v => { v.extra = 1; }, v => { v.selectedEventCount = 4; }, v => { v.evidence[1].id = 'E0'; },
    v => { v.evidence[1].seq = 999; }, v => { v.source.id = 'foreign'; }, v => { v.instructions = 'execute'; }, v => { v.evidence[1].omitted = null; }]) {
    const value = structuredClone(original); mutate(value);
    assert.throws(() => decodeSnapshot(SNAPSHOT_MARKER + JSON.stringify(value)));
  }
});
test('report validates known citations but never certifies claim truth', () => {
  assert.deepEqual(validateReport(JSON.stringify(report()), snapshot()), report());
  const value = report(); value.observations[0].claim = 'A claim still requiring human verification';
  assert.doesNotThrow(() => validateReport(JSON.stringify(value), snapshot()));
});
test('report rejects fabricated references, no evidence and markdown wrappers', () => {
  for (const ids of [[], ['E999'], ['E2', 'E2']]) {
    const value = report(); value.observations[0].evidenceIds = ids;
    assert.throws(() => validateReport(JSON.stringify(value), snapshot()));
  }
  assert.throws(() => validateReport('```json\n{}\n```', snapshot()));
  assert.throws(() => validateReport(JSON.stringify({ ...report(), approved: true }), snapshot()));
});

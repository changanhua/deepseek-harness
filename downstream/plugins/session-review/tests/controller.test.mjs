import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewController, readReview, reviewPrefix } from '../controller.mjs';
import { encodeSnapshot, PRESET } from '../contract.mjs';
import { request, snapshot, report, event, user, assistant, remoteHarness, memoryStorage } from './fixtures.mjs';
const source = { sessionId: request.sourceId, cwd: '/trusted/workspace', origin: undefined };
test('journals identity before create, pins title before prompt and never calls selectModel', async () => {
  const env = remoteHarness(); const create = env.remote.session.create;
  env.remote.session.create = async input => { assert.equal(env.storage.map.size, 1); return create(input); };
  const controller = createReviewController(env); const result = await controller.start(request, source);
  assert.equal(result.phase, 'admitted');
  assert.deepEqual(env.calls.map(call => call[0]), ['create', 'rename', 'prompt', 'refresh']);
  assert.equal(env.calls[2][1].requestId, result.requestId);
  const count = env.calls.length; await controller.recover();
  assert.deepEqual(env.calls.slice(count).map(call => call[0]), ['refresh']);
});
test('blocked storage causes zero remote side effects', () => {
  const env = remoteHarness(); env.storage.setItem = () => { throw new Error('storage denied'); };
  assert.throws(() => createReviewController(env).start(request, source), /storage denied/);
  assert.deepEqual(env.calls, []);
});
test('create response loss keeps the same session and prompt identities for explicit recovery', async () => {
  const env = remoteHarness(); const real = env.remote.session.create; let attempts = 0;
  env.remote.session.create = async input => { const value = await real(input); if (++attempts === 1) throw new Error('response lost'); return value; };
  const controller = createReviewController(env);
  await assert.rejects(controller.start(request, source), /response lost/);
  const first = controller.readPending(); const result = await controller.recover();
  assert.equal(result.sessionId, first.sessionId); assert.equal(result.requestId, first.requestId);
  assert.equal(env.calls.filter(call => call[0] === 'prompt').length, 1);
});
test('lost prompt response can only explicitly resubmit identical RPC input', async () => {
  const env = remoteHarness(); const real = env.remote.session.prompt; let attempts = 0;
  env.remote.session.prompt = async input => { const value = await real(input); if (++attempts === 1) throw new Error('unknown transport outcome'); return value; };
  const controller = createReviewController(env);
  await assert.rejects(controller.start(request, source), /unknown transport/);
  assert.equal(controller.readPending().phase, 'created');
  assert.throws(() => controller.start({ ...request, focus: 'changed' }, source), /pending/);
  await controller.recover();
  const prompts = env.calls.filter(call => call[0] === 'prompt');
  assert.deepEqual(prompts[0][1], prompts[1][1]);
  // The real Host owns deduplication. This double only proves identical requests, not exactly-once billing.
});
test('wrong preset, title failure and changed Host cannot send a prompt', async () => {
  for (const mode of ['preset', 'title', 'host']) {
    const env = remoteHarness();
    if (mode === 'preset') env.remote.session.create = async input => ({ ok: true, value: { sessionId: input.sessionId, agentPreset: 'standard' } });
    if (mode === 'title') env.remote.session.rename = async () => ({ ok: false, error: { code: 'title-error', message: 'failed' } });
    if (mode === 'host') env.remote.session.create = async input => { env.remote.$host.home = 'different'; return { ok: true, value: { sessionId: input.sessionId, agentPreset: PRESET } }; };
    await assert.rejects(createReviewController(env).start(request, source));
    assert.equal(env.calls.filter(call => call[0] === 'prompt').length, 0);
  }
});
test('reloading another Home does not reuse stored identity or payload', async () => {
  const env = remoteHarness(); const controller = createReviewController(env); await controller.start(request, source);
  env.remote.$host.home = 'foreign';
  assert.throws(() => createReviewController(env).recover(), /different DSH Home/);
});
test('double-click single flight and dispose before prompt prevent additional work', async () => {
  const env = remoteHarness(); let finish;
  env.remote.session.create = input => new Promise(resolve => { finish = () => resolve({ ok: true, value: { sessionId: input.sessionId, agentPreset: PRESET } }); });
  const controller = createReviewController(env);
  const first = controller.start(request, source); const second = controller.start(request, source);
  assert.equal(first, second); controller.dispose(); finish();
  await assert.rejects(first, /Entry closed/);
  assert.equal(env.calls.filter(call => call[0] === 'prompt').length, 0);
});
test('corrupt recovery is not silently erased, dismissing does not cancel the remote Session', async () => {
  const env = remoteHarness(); const controller = createReviewController(env); await controller.start(request, source);
  const key = [...env.storage.map.keys()][0]; env.storage.map.set(key, '{broken');
  assert.throws(() => controller.readPending()); assert.equal(env.storage.map.size, 1);
  controller.forgetPending(); assert.equal(env.storage.map.size, 0);
  assert.equal(env.calls.filter(call => call[0] === 'cancel').length, 0);
});
function opening({ end = 'completed', more = false, alter, noInput = false, interrupted = false } = {}) {
  const id = reviewPrefix(request.sourceId) + 'result';
  const value = snapshot(); if (alter) alter(value);
  const reply = assistant(JSON.stringify(report())); if (interrupted) reply.interrupted = true;
  const events = [event(0, 'turn/start', { turn: 1 }),
    ...(noInput ? [] : [event(1, 'user/message', user(encodeSnapshot(value))), event(2, 'assistant/message', reply)]),
    ...(end === null ? [] : [event(3, 'turn/end', { turn: 1, reason: { kind: end } })])];
  const frame = { type: 'snapshot', header: { id, agentPreset: PRESET }, cursor: 3, hasMore: more, records: events.map(event => ({ type: 'event', event })) };
  let closed = false;
  const remote = { session: { async *follow(_request, signal) { try { signal.throwIfAborted(); yield frame; } finally { closed = true; } } } };
  return { id, frame, remote, closed: () => closed };
}
test('reads actual nested assistant message and closes the temporary stream', async () => {
  const env = opening(); const result = await readReview(env.remote, env.id);
  assert.equal(result.state, 'report'); assert.deepEqual(result.report, report()); assert.equal(env.closed(), true);
});
test('non-completed, pending, interrupted and missing evidence never become a report', async () => {
  for (const [opts, expected] of [[{ end: 'aborted' }, 'not-completed'], [{ end: 'error' }, 'not-completed'],
    [{ end: null }, 'running-or-interrupted'], [{ noInput: true }, 'pending-or-failed'], [{ interrupted: true }, 'invalid-report']]) {
    const env = opening(opts); assert.equal((await readReview(env.remote, env.id)).state, expected);
  }
});
test('false evidence hashes, unrelated identities and incomplete windows reject', async () => {
  const bad = opening({ alter: value => { value.evidence[1].data.content[0].text = 'tampered'; } });
  await assert.rejects(readReview(bad.remote, bad.id), /digest mismatch/);
  const more = opening({ more: true }); await assert.rejects(readReview(more.remote, more.id), /read window/);
  const wrong = opening(); wrong.frame.header.agentPreset = 'standard';
  await assert.rejects(readReview(wrong.remote, wrong.id), /Not a Session Review/);
});
test('read cancellation is honored; later denied turns cannot erase the first review result', async () => {
  const cancelled = opening(); await assert.rejects(readReview(cancelled.remote, cancelled.id, AbortSignal.abort()));
  const env = opening(); env.frame.records.push({ type: 'event', event: event(4, 'turn/end', { turn: 2, reason: { kind: 'error' } }) });
  assert.equal((await readReview(env.remote, env.id)).state, 'report');
});

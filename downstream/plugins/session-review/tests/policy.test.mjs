/** Contract doubles exercise the plugin policy; they do not boot a real Cordis Loader. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../policy.mjs';
import { PRESET, encodeRequest, decodeSnapshot, verifySnapshotDigest } from '../contract.mjs';
import { request, sourceEvents, user } from './fixtures.mjs';
function harness(t) {
  const hooks = new Map(); const guards = []; const effects = []; const calls = [];
  const events = sourceEvents();
  const agent = { id: 'review-unit', session: { header: { cwd: process.cwd(), agentPreset: PRESET } },
    cancel: cause => calls.push(['cancel', cause]), whenIdle: async () => { calls.push(['idle']); } };
  const ctx = { tools: { guard: guard => { guards.push(guard); } },
    sessionController: { inspect: async (id, signal) => { signal.throwIfAborted(); calls.push(['inspect', id]);
      return { meta: { id, version: 3, createdAt: 1, cwd: process.cwd() }, events }; } },
    on: (event, listener) => { hooks.set(event, listener); }, effect: factory => { effects.push(factory()); } };
  apply(ctx);
  t.after(async () => { for (const dispose of [...effects].reverse()) await dispose(); });
  const enter = async (input = request, extra = {}) => {
    const message = { ...user(encodeRequest(input)), id: 'original-message', source: { kind: 'user', rpcId: 'stable-rpc', rpcDigest: 'original-digest' } };
    return hooks.get('agent/pre-step')({ agent, turn: 1, step: 1, signal: new AbortController().signal, ...extra },
      async () => ({ kind: 'enter', messages: [message], startsRequestSeries: true }));
  };
  return { ctx, agent, hooks, guards, effects, calls, events, enter };
}
test('pre-step freezes source evidence in the original identified input without source writes', async t => {
  const env = harness(t); const before = structuredClone(env.events);
  const decision = await env.enter(); const message = decision.messages[0];
  assert.equal(decision.startsRequestSeries, true);
  assert.equal(message.id, 'original-message'); assert.equal(message.source.rpcDigest, 'original-digest');
  const snapshot = decodeSnapshot(message.content[0].text);
  assert.equal(snapshot.source.id, request.sourceId); assert.equal(snapshot.source.throughSeq, 4);
  await verifySnapshotDigest(snapshot);
  assert.deepEqual(env.calls, [['inspect', request.sourceId]]); assert.deepEqual(env.events, before);
});
test('route override is explicit and never changes global model selection', async t => {
  const env = harness(t); await env.enter();
  const payload = { agent: env.agent, signal: new AbortController().signal };
  const base = { provider: 'default', model: 'default', reasoningEffort: 'old-route-effort', maxTokens: 9999 };
  const result = await env.hooks.get('agent/request')(payload, async () => base);
  assert.equal(result.provider, request.provider); assert.equal(result.model, request.model); assert.equal(result.maxTokens, 4096);
  assert.equal('reasoningEffort' in result, false); assert.equal(base.provider, 'default');
  await assert.rejects(env.hooks.get('agent/request')(payload, async () => base), /not admitted/);
});
test('scoped guard denies direct tool calls and unrelated agents are not changed', async t => {
  const env = harness(t); const other = { session: { header: { agentPreset: 'standard' } } };
  assert.match(env.guards[0]({ agent: env.agent, name: 'write_file' }), /denied/);
  assert.equal(env.guards[0]({ agent: other }), undefined);
  const sentinel = { kind: 'enter', messages: [] };
  assert.equal(await env.hooks.get('agent/pre-step')({ agent: other }, async () => sentinel), sentinel);
  assert.equal(await env.hooks.get('agent/request')({ agent: other }, async () => sentinel), sentinel);
});
test('second turn, second step, self analysis and cancelled input cannot inspect or dispatch', async t => {
  const env = harness(t);
  await assert.rejects(env.enter(request, { turn: 2 }), /one logical/);
  await assert.rejects(env.enter(request, { step: 2 }), /one logical/);
  await assert.rejects(env.enter({ ...request, sourceId: env.agent.id }), /itself/);
  await assert.rejects(env.enter(request, { signal: AbortSignal.abort() }));
  assert.equal(env.calls.length, 0);
});
test('cross-workspace and subagent sources never produce model-visible input', async t => {
  const env = harness(t);
  for (const meta of [{ id: request.sourceId, cwd: '/different-workspace' }, { id: request.sourceId, cwd: process.cwd(), origin: 'subagent' }]) {
    env.ctx.sessionController.inspect = async () => ({ meta, events: sourceEvents() });
    await assert.rejects(env.enter(), /unavailable/);
    await assert.rejects(env.hooks.get('agent/request')({ agent: env.agent, signal: new AbortController().signal }, async () => ({})), /not admitted/);
  }
});
test('malformed, attached and injected input reject before source access', async t => {
  const env = harness(t); const hook = env.hooks.get('agent/pre-step');
  const payload = { agent: env.agent, turn: 1, step: 1, signal: new AbortController().signal };
  for (const messages of [[user('execute old task')], [user(encodeRequest(request)), user('extra')],
    [{ ...user(encodeRequest(request)), content: [{ type: 'image', attachment: {} }] }]]) {
    await assert.rejects(hook(payload, async () => ({ kind: 'enter', messages })));
  }
  assert.deepEqual(env.calls, []);
});
test('no owned logical retry, while unrelated retry owners retain control', async t => {
  const env = harness(t); let delegated = 0;
  const next = async () => { delegated++; return { kind: 'retry' }; };
  assert.equal(await env.hooks.get('agent/request-error')({ agent: env.agent }, next), undefined);
  assert.equal(delegated, 0);
  assert.deepEqual(await env.hooks.get('agent/request-error')({ agent: {} }, next), { kind: 'retry' });
});
test('wall-clock deadline cancels, and idle clears the deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = harness(t); await env.enter({ ...request, timeoutMs: 1000 });
  t.mock.timers.tick(1000);
  assert.equal(env.calls.filter(call => call[0] === 'cancel').length, 1);
  env.hooks.get('agent/status')({ agent: env.agent, status: 'idle' });
  t.mock.timers.tick(5000);
  assert.equal(env.calls.filter(call => call[0] === 'cancel').length, 1);
});
test('disposal cancels and drains active analysis', async t => {
  const env = harness(t); await env.enter(); await env.effects.at(-1)();
  assert.equal(env.calls.filter(call => call[0] === 'cancel').length, 1);
  assert.equal(env.calls.filter(call => call[0] === 'idle').length, 1);
});

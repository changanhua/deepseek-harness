/** Scoped policy. Mount ONLY inside the dedicated review preset. No new Remote or store. */
import { createHash } from 'node:crypto';
import { resolve, normalize } from 'node:path';
import { decodeRequest, encodeSnapshot, selectEvidence, snapshotDigestInput, REVIEW_INSTRUCTIONS, PRESET } from './contract.mjs';
export const name = 'session-review-policy';
export const inject = ['tools', 'sessionController'];
function canonicalPath(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const path = normalize(resolve(value));
  return process.platform === 'win32' ? path.toLowerCase() : path;
}
function singleText(message) {
  if (!Array.isArray(message.content) || message.content.length !== 1 || message.content[0].type !== 'text') {
    throw new Error('Session Review accepts one text request, without attachments');
  }
  return message.content[0].text;
}
/** Installation is scoped by the preset owner; guards also cover direct Tool execution. */
export function apply(ctx) {
  const active = new Map();
  const owns = agent => agent?.session?.header?.agentPreset === PRESET;
  ctx.tools.guard(exec => owns(exec.agent) ? 'Session Review is read-only: all Tool execution is denied' : undefined);
  ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next) => {
    if (!owns(agent)) return next();
    if (turn !== 1 || step !== 1) throw new Error('A review admits one logical model request. Start a new review explicitly; interrupted work is not automatically repeated.');
    const decision = await next();
    if (decision.kind !== 'enter') return decision;
    if (decision.messages.length !== 1) throw new Error('Session Review requires one explicit request and no injected background');
    const message = decision.messages[0];
    const request = decodeRequest(singleText(message));
    if (request.sourceId === agent.id) throw new Error('A review cannot analyze itself');
    signal.throwIfAborted();
    const state = { request, requested: false, timer: setTimeout(() => {
      agent.cancel({ kind: 'hook', reason: 'Session Review wall-clock limit reached' });
    }, request.timeoutMs) };
    active.set(agent, state);
    try {
      // Public, cold-safe source read. Does not resume or send anything to the source Agent.
      const source = await ctx.sessionController.inspect(request.sourceId, signal);
      signal.throwIfAborted();
      const sourcePath = canonicalPath(source.meta.cwd);
      const targetPath = canonicalPath(agent.session.header.cwd);
      if (source.meta.id !== request.sourceId || source.meta.origin === 'subagent'
        || sourcePath === null || sourcePath !== targetPath) {
        throw new Error('Source is unavailable for this review Workspace; direct subagent sources are unsupported');
      }
      const selected = selectEvidence(source.events, request);
      const body = { version: 0, request, source: {
        id: source.meta.id, version: source.meta.version, createdAt: source.meta.createdAt,
        fromSeq: selected.fromSeq, throughSeq: selected.throughSeq,
      }, selectedEventCount: selected.selectedEventCount, omittedEventCount: selected.omittedEventCount,
      capturedAt: Date.now(), evidence: selected.evidence, instructions: REVIEW_INSTRUCTIONS };
      // This digest identifies this exported evidence view, not the complete source or factual truth.
      const digest = `sha256:${createHash('sha256').update(snapshotDigestInput(body)).digest('hex')}`;
      const text = encodeSnapshot({ ...body, digest });
      signal.throwIfAborted();
      // Preserve message id and RPC correlation. The normal loop logs this exact rewritten input.
      return { ...decision, messages: [{ ...message, content: [{ type: 'text', text }] }] };
    } catch (error) {
      clearTimeout(state.timer);
      active.delete(agent);
      throw error;
    }
  });
  ctx.on('agent/request', async ({ agent, signal }, next) => {
    if (!owns(agent)) return next();
    const state = active.get(agent);
    if (!state || state.requested) throw new Error('Review route is not admitted');
    signal.throwIfAborted();
    const { reasoningEffort: _inheritedReasoning, ...base } = await next();
    signal.throwIfAborted();
    state.requested = true;
    // Request-scoped routing does not call selectModel() or change the user's default model.
    return { ...base, provider: state.request.provider, model: state.request.model, maxTokens: state.request.maxTokens };
  });
  // Do not add another logical retry after failure. Adapter-internal retries remain adapter-owned.
  ctx.on('agent/request-error', async ({ agent }, next) => owns(agent) ? undefined : next());
  const settle = agent => {
    const state = active.get(agent);
    if (state) clearTimeout(state.timer);
    active.delete(agent);
  };
  ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') settle(agent); });
  ctx.on('agent/disposed', ({ agent }) => settle(agent));
  // Registered last: cancel and drain while the scoped guard is still mounted.
  ctx.effect(() => async () => {
    const agents = [...active.keys()];
    for (const agent of agents) {
      settle(agent);
      agent.cancel({ kind: 'hook', reason: 'Session Review policy unloaded' });
    }
    await Promise.allSettled(agents.map(agent => agent.whenIdle()));
  }, 'session-review: cancel and drain');
}

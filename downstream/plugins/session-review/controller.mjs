/** Existing Session Remote consumer. No new backend endpoint or authoritative Review ledger. */
import { PRESET, encodeRequest, validateRequest, decodeSnapshot, verifySnapshotDigest, validateReport, SNAPSHOT_MARKER, LIMITS, bytes } from './contract.mjs';
const KEY = 'dsh.session-review.v0.pending';
export function unwrap(result) {
  if (!result || result.ok !== true) throw new Error(`${result?.error?.code ?? 'remote-error'}: ${result?.error?.message ?? 'No valid response'}`);
  return result.value;
}
/** Prefix is a discovery convention only; the logged snapshot is the source association. */
export function reviewPrefix(sourceId) {
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(sourceId))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const prefix = `review-v0-${encoded.length}-${encoded}-`;
  if (prefix.length > 150) throw new Error('This source identity is too long for the V0 review entry');
  return prefix;
}
function hostIdentity(remote) {
  const home = remote.$host?.home;
  if (home === undefined) throw new Error('Host identity is not available; reconnect first');
  return JSON.stringify(home);
}
function validatePending(value) {
  if (!value || value.version !== 0 || !['prepared', 'created', 'admitted'].includes(value.phase)) throw new Error('Invalid pending review');
  validateRequest(value.request);
  if (typeof value.home !== 'string' || typeof value.cwd !== 'string' || !value.cwd
    || typeof value.sessionId !== 'string' || !value.sessionId.startsWith(reviewPrefix(value.request.sourceId))
    || typeof value.requestId !== 'string' || !value.requestId) throw new Error('Invalid pending review identity');
  return value;
}
export function createReviewController({ remote, sessions, storage, uuid = () => crypto.randomUUID() }) {
  let inFlight = null;
  let disposed = false;
  const readPending = () => {
    const raw = storage.getItem(KEY);
    if (raw === null) return null;
    if (bytes(raw) > 16384) throw new Error('Oversized recovery record');
    const value = validatePending(JSON.parse(raw));
    if (value.home !== hostIdentity(remote)) throw new Error('Recovery belongs to a different DSH Home; do not resubmit it here');
    return value;
  };
  const save = value => { storage.setItem(KEY, JSON.stringify(validatePending(value))); };
  const run = pending => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      if (disposed) throw new Error('Session Review entry is closed');
      if (pending.home !== hostIdentity(remote)) throw new Error('Host identity changed');
      if (pending.phase === 'admitted') { await sessions.refresh(); return pending; }
      const created = unwrap(await remote.session.create({ sessionId: pending.sessionId, cwd: pending.cwd, agentPreset: PRESET }));
      if (created.sessionId !== pending.sessionId || created.agentPreset !== PRESET) throw new Error('The dedicated read-only preset was not applied; no prompt was sent');
      pending = { ...pending, phase: 'created' };
      save(pending);
      if (disposed || pending.home !== hostIdentity(remote)) throw new Error('Entry closed or Host changed before prompt submission; recover the same identity');
      // Pin a human-owned title before the first prompt, avoiding automatic title-model work.
      unwrap(await remote.session.rename({ sessionId: pending.sessionId, title: '会话复盘 / Session review' }));
      if (disposed || pending.home !== hostIdentity(remote)) throw new Error('Entry closed or Host changed before prompt submission; recover the same identity');
      // Stable id + identical raw input reaches the existing Host prompt idempotency boundary.
      unwrap(await remote.session.prompt({ sessionId: pending.sessionId, requestId: pending.requestId,
        mode: 'queue', content: [{ type: 'text', text: encodeRequest(pending.request) }] }));
      pending = { ...pending, phase: 'admitted' };
      save(pending);
      await sessions.refresh();
      return pending;
    })().finally(() => { inFlight = null; });
    return inFlight;
  };
  return {
    readPending,
    async catalog() { return unwrap(await remote.session.modelCatalog()); },
    start(request, source) {
      if (disposed) return Promise.reject(new Error('Session Review entry is closed'));
      if (inFlight) return inFlight;
      validateRequest(request);
      if (!source || source.sessionId !== request.sourceId || source.origin === 'subagent' || !source.cwd) throw new Error('Select an ordinary Session with a Workspace');
      const previous = readPending();
      if (previous && previous.phase !== 'admitted') throw new Error('Resolve the existing pending submission before starting another review');
      const pending = { version: 0, home: hostIdentity(remote), phase: 'prepared', cwd: source.cwd,
        sessionId: reviewPrefix(request.sourceId) + uuid(), requestId: uuid(), request: { ...request } };
      // A failed local write MUST prevent all remote effects.
      save(pending);
      return run(pending);
    },
    recover() {
      if (inFlight) return inFlight;
      const pending = readPending();
      if (!pending) throw new Error('There is no pending submission');
      return run(pending);
    },
    forgetPending() {
      if (inFlight) throw new Error('Submission is still in flight');
      // Local dismissal does not cancel or delete a potentially created remote Session.
      storage.removeItem(KEY);
    },
    async cancel(sessionId) { unwrap(await remote.session.cancel({ sessionId })); },
    dispose() { disposed = true; },
  };
}
function textOf(event) {
  const message = event.type === 'user/message' ? event.data : event.data?.message;
  return Array.isArray(message?.content) ? message.content.filter(part => part?.type === 'text').map(part => part.text).join('') : '';
}
/** Read a settled, bounded analysis snapshot. A failed read never triggers model work. */
export async function readReview(remote, sessionId, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let opening;
  try {
    for await (const frame of remote.session.follow({ address: { kind: 'session', sessionId }, maxMessages: 10 }, controller.signal)) {
      if (frame.type !== 'snapshot') throw new Error('Missing opening snapshot');
      opening = frame;
      break;
    }
  } finally {
    controller.abort();
    signal?.removeEventListener('abort', abort);
  }
  signal?.throwIfAborted();
  if (!opening || opening.header.id !== sessionId || opening.header.agentPreset !== PRESET) throw new Error('Not a Session Review session');
  if (opening.hasMore) throw new Error('The review exceeds the V0 read window; open its raw Session instead');
  if (bytes(JSON.stringify(opening.records)) > LIMITS.snapshotBytes * 3) throw new Error('Review history exceeds the display budget');
  const events = opening.records.map(record => record.event);
  const sourceEvent = events.find(event => event.type === 'user/message' && textOf(event).startsWith(SNAPSHOT_MARKER));
  if (!sourceEvent) return { state: 'pending-or-failed', message: 'No admitted evidence snapshot yet. Open the analysis Session to inspect its status.' };
  const snapshot = decodeSnapshot(textOf(sourceEvent));
  await verifySnapshotDigest(snapshot);
  signal?.throwIfAborted();
  if (!sessionId.startsWith(reviewPrefix(snapshot.source.id))) throw new Error('Review/source association mismatch');
  const terminal = events.find(event => event.type === 'turn/end' && event.data.turn === 1);
  if (!terminal) return { state: 'running-or-interrupted', snapshot };
  if (terminal.data?.reason?.kind !== 'completed') return { state: 'not-completed', snapshot, reason: terminal.data?.reason?.kind ?? 'unknown' };
  const assistant = events.filter(event => event.type === 'assistant/message' && event.data.turn === 1).at(-1);
  if (!assistant || assistant.data.interrupted === true || assistant.seq <= sourceEvent.seq || assistant.seq >= terminal.seq) return { state: 'invalid-report', snapshot, message: 'No settled assistant report' };
  try { return { state: 'report', snapshot, report: validateReport(textOf(assistant), snapshot) }; }
  catch (error) { return { state: 'invalid-report', snapshot, message: error.message }; }
}

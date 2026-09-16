/** Optional browser workspace. Existing chat stays mounted; all text is escaped by React. */
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createReviewController, readReview, reviewPrefix } from './controller.mjs';
import { LIMITS } from './contract.mjs';
const h = React.createElement;
export const inject = ['slots', 'sessions', 'remote'];
const VIEW = 'session-review';
const css = `
.dsh-review{padding:28px;max-width:1060px;margin:auto;color:inherit;font:inherit}
.dsh-review h1{font-size:28px;margin:0 0 8px}.dsh-review p{line-height:1.65}
.dsh-review .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.dsh-review label{display:flex;flex-direction:column;gap:6px;margin:12px 0}
.dsh-review input,.dsh-review select,.dsh-review textarea{font:inherit;color:inherit;background:transparent;border:1px solid #b7b4aa;border-radius:6px;padding:9px;max-width:100%;box-sizing:border-box}
.dsh-review button{font:inherit;cursor:pointer;padding:8px 12px;margin:4px 8px 4px 0;border:1px solid #b7b4aa;border-radius:6px;background:transparent;color:inherit}
.dsh-review button:disabled{opacity:.45;cursor:default}.dsh-review article{padding:16px;margin:14px 0;border:1px solid #b7b4aa;border-radius:8px}
.dsh-review pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:300px;overflow:auto}
.dsh-review [role=alert]{color:#b55238}.dsh-review small{opacity:.75}.dsh-review ul{padding-left:20px}
@media(max-width:600px){.dsh-review{padding:16px}}
`;
function Nav({ wide, activeModule, setActiveModule }) {
  return h('button', { type: 'button', 'aria-label': '会话复盘', 'aria-current': activeModule === VIEW ? 'page' : undefined,
    onClick: () => setActiveModule(VIEW) }, wide ? '会话复盘' : '复盘');
}
function Evidence({ ids, snapshot }) {
  return h('div', null, ids.map(id => {
    const evidence = snapshot.evidence.find(item => item.id === id);
    return h('details', { key: id }, h('summary', null, `${id} · ${evidence.type} · 源事件 ${evidence.seq}`),
      h('pre', null, JSON.stringify(evidence.data, null, 2)), evidence.omitted.length ? h('small', null, `省略字段：${evidence.omitted.join(', ')}`) : null);
  }));
}
function Report({ value, openSession }) {
  if (!value) return null;
  if (value.state !== 'report') return h('article', null, h('strong', null, `分析状态：${value.state}`),
    h('p', null, value.message ?? value.reason ?? '尚无可显示的完整报告。请刷新或打开分析会话，不要把此状态当成任务成功。'));
  const { snapshot, report } = value;
  return h('section', null,
    h('p', null, `来源 ${snapshot.source.id} · 事件 ${snapshot.source.fromSeq}–${snapshot.source.throughSeq} · 已省略 ${snapshot.omittedEventCount} 个非证据事件。`),
    h('small', null, `${snapshot.digest}（证据视图身份，不是结论正确性的证明）`),
    h('button', { type: 'button', onClick: () => openSession(snapshot.source.id) }, '返回源会话'),
    [['observations', '观察：有来源的陈述'], ['hypotheses', '原因假设：尚未证实'], ['experiments', '下一步实验：仅建议，不执行']].map(([key, title]) =>
      h('section', { key }, h('h2', null, title), report[key].length === 0 ? h('p', null, '没有相应条目。') : report[key].map((item, index) =>
        h('article', { key: index }, h('p', null, item.claim ?? item.cause ?? item.change),
          item.uncertainty ? h('p', null, `不确定性：${item.uncertainty}`) : null,
          item.check ? h('p', null, `如何检查：${item.check}`) : null,
          h(Evidence, { ids: item.evidenceIds, snapshot }))))));
}
function Workspace({ remote, sessions, controller, openSession }) {
  const list = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot, sessions.list.getSnapshot);
  const [sourceId, setSourceId] = useState(list.current ?? '');
  const [filter, setFilter] = useState('');
  const [catalog, setCatalog] = useState(null);
  const [route, setRoute] = useState('');
  const [perspective, setPerspective] = useState('diagnose');
  const [from, setFrom] = useState('0');
  const [through, setThrough] = useState('');
  const [focus, setFocus] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [value, setValue] = useState(null);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(null);
  const sources = Object.values(list.byId).filter(item => item.origin !== 'subagent' && !item.sessionId.startsWith('review-v0-') && item.sessionId.includes(filter));
  const routes = catalog?.groups.flatMap(group => group.models.map(model => ({ key: JSON.stringify([group.id, model.id]), label: `${group.name} / ${model.name}` }))) ?? [];
  const linked = useMemo(() => {
    if (!sourceId) return [];
    try { const prefix = reviewPrefix(sourceId); return Object.values(list.byId).filter(item => item.sessionId.startsWith(prefix)); }
    catch { return []; }
  }, [list, sourceId]);
  useEffect(() => {
    let alive = true;
    controller.catalog().then(result => { if (alive) setCatalog(result); }).catch(reason => { if (alive) setError(reason.message); });
    try { setPending(controller.readPending()); } catch (reason) { setError(reason.message); }
    return () => { alive = false; };
  }, [controller]);
  useEffect(() => {
    setValue(null);
    if (!selected) return;
    const abort = new AbortController();
    readReview(remote, selected, abort.signal).then(result => { if (!abort.signal.aborted) setValue(result); })
      .catch(reason => { if (!abort.signal.aborted) setError(reason.message); });
    return () => abort.abort();
  }, [remote, selected, revision]);
  const run = async recover => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      let result;
      if (recover) result = await controller.recover();
      else {
        if (!route || !consent) throw new Error('请选择模型并确认发送所选历史文本。');
        const [provider, model] = JSON.parse(route);
        result = await controller.start({ version: 0, sourceId, fromSeq: Number(from), throughSeq: through === '' ? null : Number(through),
          maxEvents: LIMITS.events, provider, model, perspective, focus,
          maxTokens: LIMITS.outputTokens, timeoutMs: LIMITS.timeoutMs }, list.byId[sourceId]);
      }
      setPending(result); setSelected(result.sessionId); setRevision(value => value + 1);
    } catch (reason) {
      setError(reason.message);
      try { setPending(controller.readPending()); } catch { /* Preserve the original actionable error. */ }
    } finally { setBusy(false); }
  };
  const field = (label, element) => h('label', null, h('span', null, label), element);
  return h('section', { className: 'dsh-review', 'aria-label': '会话复盘' }, h('style', null, css),
    h('small', null, 'SESSION REVIEW · V0'), h('h1', null, '这次任务，哪里值得改进？'),
    h('p', null, '只分析一次选定会话。原会话不被写入；分析保存在新的只读会话，不自动修改代码、知识或任务。'),
    error ? h('p', { role: 'alert' }, error) : null,
    field('按会话 ID 筛选', h('input', { value: filter, onChange: event => setFilter(event.target.value) })),
    field('源会话', h('select', { value: sourceId, disabled: busy, onChange: event => { setSourceId(event.target.value); setConsent(false); setSelected(''); } },
      h('option', { value: '' }, '请选择会话'), sources.map(item => h('option', { value: item.sessionId, key: item.sessionId }, item.sessionId)))),
    sourceId ? h('button', { type: 'button', onClick: () => openSession(sourceId) }, '打开源会话') : null,
    h('div', { className: 'grid' },
      field('分析模型（不改变全局默认）', h('select', { value: route, disabled: busy, onChange: event => { setRoute(event.target.value); setConsent(false); } },
        h('option', { value: '' }, '请选择已配置的模型'), routes.map(item => h('option', { value: item.key, key: item.key }, item.label)))),
      field('分析视角', h('select', { value: perspective, disabled: busy, onChange: event => setPerspective(event.target.value) },
        h('option', { value: 'diagnose' }, '诊断：定位浪费、误判和可复用做法'), h('option', { value: 'countercheck' }, '复核：寻找反证与其他解释'))),
      field('起始事件 seq（包含）', h('input', { type: 'number', min: 0, value: from, disabled: busy, onChange: event => setFrom(event.target.value) })),
      field('结束事件 seq（留空：开始分析时冻结末尾）', h('input', { type: 'number', min: 0, value: through, disabled: busy, onChange: event => setThrough(event.target.value) }))),
    field('这次特别关注什么？', h('textarea', { value: focus, disabled: busy, maxLength: 2048, rows: 3, onChange: event => setFocus(event.target.value) })),
    h('p', null, '最多 300 个源事件、128 KiB 完整输入、4,096 输出 Token、180 秒；超限拒绝，不静默截断。只读 Tool 防线不等于供应商账单级预算。'),
    h('label', null, h('span', null, h('input', { type: 'checkbox', checked: consent, onChange: event => setConsent(event.target.checked) }),
      '我确认将选定的历史文字和工具参数发送给所选模型，其中可能包含隐私；复盘不使用 /feedback 分享入口。')),
    h('button', { type: 'button', disabled: busy || !route || !sourceId || !consent, onClick: () => void run(false) }, busy ? '提交中…' : '开始一次复盘'),
    h('button', { type: 'button', disabled: busy, onClick: () => void sessions.refresh().catch(reason => setError(reason.message)) }, '刷新会话列表'),
    pending ? h('article', null, h('strong', null, `最近提交：${pending.phase}`), h('p', null, pending.sessionId),
      h('button', { type: 'button', disabled: busy, onClick: () => void run(true) }, '恢复同一次提交'),
      h('button', { type: 'button', disabled: busy, onClick: () => { try { controller.forgetPending(); setPending(null); } catch (reason) { setError(reason.message); } } }, '仅清除本地提交记录（不取消远端任务）')) : null,
    h('h2', null, '关联的分析会话'), linked.length ? h('ul', null, linked.map(item => h('li', { key: item.sessionId },
      h('button', { type: 'button', onClick: () => { setSelected(item.sessionId); setError(''); } }, item.sessionId)))) : h('p', null, '尚无已发现的分析会话。'),
    selected ? h('div', null,
      h('button', { type: 'button', onClick: () => setRevision(value => value + 1) }, '刷新分析结果'),
      h('button', { type: 'button', onClick: () => openSession(selected) }, '打开原始分析会话'),
      h('button', { type: 'button', onClick: () => void controller.cancel(selected).then(() => setRevision(value => value + 1)).catch(reason => setError(reason.message)) }, '请求停止分析')) : null,
    h(Report, { value, openSession }));
}
/** Register a native shell workspace. Installation is explicit, never automatic. */
export function apply(ctx) {
  // Defer browser-storage access until an explicit workspace visit, not plugin boot.
  const storage = { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) };
  const controller = createReviewController({ remote: ctx.remote, sessions: ctx.sessions, storage });
  ctx.effect(() => () => controller.dispose(), 'session-review: client lifecycle');
  ctx.slots.inject('shell.view', () => ctx.slots.register({ name: 'shell.view', id: VIEW,
    inject: () => ({ remote: ctx.remote, sessions: ctx.sessions, controller, openSession: id => ctx.sessions.open(id) }) }, Workspace));
  ctx.slots.inject('sidebar.modules.group', () => ctx.slots.register({ name: 'sidebar.modules.group', id: 'session-review-module', order: 7, inject: () => ({}) }, Nav));
}

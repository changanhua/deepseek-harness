/** Owner-only page; request values enter through textContent in the separate script. */
export const approvalHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH 浏览器助手连接</title>
<style>body{font:16px/1.6 system-ui;margin:32px auto;padding:0 20px;max-width:720px;color-scheme:light dark}fieldset{margin:20px 0;padding:16px}label{display:block;margin:8px 0;overflow-wrap:anywhere}button{font:inherit;padding:8px 18px;margin:8px 8px 8px 0;cursor:pointer}code{overflow-wrap:anywhere}section{margin:20px 0}input{margin-right:10px}</style>
<h1>DSH 浏览器助手连接</h1><p>连接会保留到你撤销授权。网页访问还受 Chrome 的站点权限限制。</p><p id="status" role="status">正在读取连接请求…</p><main id="content"></main><p><a href="/">返回 DSH</a></p><script src="/browser-assistant/app.js" defer></script></html>`

/** Browser-local approval controller; only the existing signed-in cookie can commit a choice. */
export const approvalScript = `(() => {
  const content = document.querySelector('#content'), status = document.querySelector('#status');
  const names = { 'session:interact': '会话交互：向选定会话发送内容、读取结果及停止任务', 'browser:read': '读取已授权网页与标签', 'browser:write': '操作已授权网页（重要操作仍需审批）', 'browser:observe': '允许按配置持续观察浏览活动' };
  const element = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  const api = async (path, body) => {
    const response = await fetch('/api/browser-extension/v1/owner/' + path, { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw Error(response.status === 401 ? '登录已失效，请重新打开 DSH 启动链接。' : '请求已过期、被撤销或暂不可用。');
    return response.json();
  };
  const checkbox = (parent, group, value, label) => {
    const row = element('label'), box = element('input'); box.type = 'checkbox'; box.name = group; box.value = value; box.checked = true;
    row.append(box, document.createTextNode(label)); parent.append(row);
  };
  const list = async () => {
    const result = await api('grants', {}); content.replaceChildren(); status.textContent = result.grants.length ? '已授权的浏览器连接' : '尚无浏览器助手连接。';
    for (const grant of result.grants) {
      const section = element('section'); section.append(element('h2', '浏览器安装 ' + grant.installationId), element('p', grant.scopes.map(scope => names[scope] || scope).join('；')), element('p', '站点：' + (grant.origins.map(origin => origin === '*' ? 'Chrome 已允许访问的所有网站' : origin).join('、') || '未授权网页')));
      const revoke = element('button', '撤销此连接'); revoke.onclick = async () => { revoke.disabled = true; try { await api('revoke', { installationId: grant.installationId }); await list(); } catch (error) { status.textContent = error.message; revoke.disabled = false; } }; section.append(revoke); content.append(section);
    }
  };
  const start = async () => {
    const requestId = new URLSearchParams(location.search).get('requestId'); if (!requestId) return list();
    const request = await api('request', { requestId }); content.replaceChildren();
    if (request.status !== 'pending') { status.textContent = '这条连接请求已处理。'; return list(); }
    status.textContent = '请核对这个安装及它申请的权限。';
    content.append(element('p', '扩展：' + request.extensionId), element('p', '安装：' + request.installationId));
    const scopes = element('fieldset'), origins = element('fieldset'); scopes.append(element('legend', '允许的能力')); origins.append(element('legend', '允许的站点'));
    for (const scope of request.scopes) checkbox(scopes, 'scope', scope, names[scope] || scope);
    for (const origin of request.origins) checkbox(origins, 'origin', origin, origin === '*' ? 'Chrome 已允许访问的所有网站' : origin);
    if (!request.origins.length) origins.append(element('p', '这次请求不包含网页访问。'));
    const approve = element('button', '允许所选权限');
    approve.onclick = async () => {
      const selected = group => [...content.querySelectorAll('input[name="' + group + '"]:checked')].map(input => input.value);
      const chosenScopes = selected('scope'); if (!chosenScopes.length) { status.textContent = '至少选择一项能力，或关闭此页取消本次操作。'; return; }
      approve.disabled = true;
      try { await api('approve', { requestId, scopes: chosenScopes, origins: selected('origin') }); content.replaceChildren(); status.textContent = '已授权。可以返回浏览器侧栏，或关闭此页。'; }
      catch (error) { status.textContent = error.message; approve.disabled = false; }
    };
    content.append(scopes, origins, approve);
  };
  start().catch(error => { status.textContent = error.message; });
})();`

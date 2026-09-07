// Demonstration only: local proposal fixtures and timer-driven task states.
const suggestionStates = new Map();
const proposalTimers = new Set();
let demoTaskSerial = 0;

function proposalsFor(entry) {
  const name = title(entry);
  if (/能力|做什么/.test(name)) return [
    {name:'整理成能力速查表',description:'按使用场景归类，保留每类能做的具体事情。',kind:'capabilities'},
    {name:'提炼成上手清单',description:'把能力介绍变成第一次使用时可以尝试的操作。',kind:'getting-started'},
    {name:'压缩成简短介绍',description:'保留核心用途，方便下次快速回顾或转述。',kind:'short'},
  ];
  if (/验证|验收/.test(name)) return [
    {name:'整理成验收清单',description:'按改动类型组织检查项，开发时可以直接对照。',kind:'verification'},
    {name:'提炼验证原则',description:'保留判断依据，形成一份简短的工作备忘。',kind:'principles'},
    {name:'保留完整说明',description:'重新组织段落，让原有细节更容易查阅。',kind:'structured'},
  ];
  return [
    {name:'整理成实施清单',description:'把当前结论组织成下一步可以执行的事项。',kind:'implementation'},
    {name:'提炼待确认问题',description:'集中展示尚未定下来的选择，方便继续讨论。',kind:'questions'},
    {name:'生成简短方案',description:'保留目标、范围与主要步骤，减少重复描述。',kind:'structured'},
  ];
}

function suggestionState(entry) {
  if (!suggestionStates.has(entry.id)) suggestionStates.set(entry.id, {
    phase:'proposed', plans:proposalsFor(entry), instruction:'', task:null,
  });
  return suggestionStates.get(entry.id);
}

function suggestionsBlock(entry) {
  if (entry.archived || entry.resultOf || !entry.source) return '';
  const state = suggestionState(entry);
  if (state.phase === 'shelved') return `<div class="suggestions-shelved"><span>原文已保留，暂不处理</span><button data-proposal-action="restore" data-owner="${entry.id}">查看 DSH 建议</button></div>`;
  if (state.phase === 'adopted') return `<div class="suggestions-shelved"><span>${icon('check')} 整理成果已另存，原文保持不变</span><button data-proposal-action="open-result" data-owner="${entry.id}">查看成果</button></div>`;
  const top = `<div class="suggestions-header"><span class="suggestions-label">${icon('message')} DSH 建议</span>${state.phase === 'proposed'?`<button class="quiet" data-proposal-action="shelve" data-owner="${entry.id}">只保留原文</button>`:`<button class="quiet" data-proposal-action="task" data-owner="${entry.id}">查看后台任务</button>`}</div>`;
  if (state.phase === 'proposed') return `<section class="suggestions" aria-label="DSH 主动提供的整理方案">${top}<p class="suggestions-intro">${state.instruction?`按你的要求「${esc(state.instruction)}」，我建议从下面三种结果中选择。`:`这份材料适合做成${esc(state.plans[0].name.replace(/^(整理成|提炼成|生成)/,''))}。选一个方向，我来完成。`}</p><div class="plan-grid">${state.plans.map((plan,index)=>`<button class="plan-option ${index===0?'recommended':''}" data-plan="${index}" data-owner="${entry.id}" aria-label="${esc(plan.name)}，按这个生成"><span class="plan-kicker">${index===0?'推荐':'另一种用途'}</span><span class="plan-name">${esc(plan.name)}</span><span class="plan-description">${esc(plan.description)}</span><span class="plan-run">按这个生成 ${icon('arrow')}</span></button>`).join('')}</div><form class="suggestions-custom" data-proposal-form="${entry.id}"><input aria-label="补充要求" name="instruction" placeholder="也可以补充：更简短、面向新手、只保留操作步骤…" value="${esc(state.instruction)}"><button type="submit">调整建议 ${icon('arrow')}</button></form></section>`;
  const task = state.task;
  if (state.phase === 'queued' || state.phase === 'running') return `<section class="suggestions" aria-label="整理任务进度">${top}<div class="task-state"><h3>${state.phase==='queued'?'已加入后台任务':'正在生成'} · ${esc(task.plan.name)}</h3><p>你可以继续浏览其他内容，完成后结果会留在这里。</p><div class="task-progress"><span style="width:${state.phase==='queued'?20:68}%"></span></div><div class="task-actions"><button class="quiet" data-proposal-action="cancel" data-owner="${entry.id}">取消这次生成</button></div></div></section>`;
  if (state.phase === 'canceled') return `<section class="suggestions">${top}<div class="task-state"><h3>这次生成已取消</h3><p>原材料仍然保留，可以选择另一个方向。</p><button class="secondary" data-proposal-action="restore" data-owner="${entry.id}">重新选方案</button></div></section>`;
  return `<section class="suggestions" aria-label="待采用的整理结果">${top}<div class="task-state"><h3>${icon('check')} 已完成 · ${esc(task.result.title)}</h3><p>先看结果，合适就另存为一条内容。</p><div class="task-result-teaser">${esc(task.result.teaser)}</div><div class="task-actions"><button class="primary" data-proposal-action="adopt" data-owner="${entry.id}">采用并另存</button><button class="secondary" data-proposal-action="preview" data-owner="${entry.id}">预览完整结果</button><button class="quiet" data-proposal-action="restore" data-owner="${entry.id}">换个方案</button></div></div></section>`;
}

function demoResult(task) {
  const source = task.source;
  const start = `整理自「${source.title}」`;
  switch(task.plan.kind) {
    case 'capabilities': return {title:'DeepSeek Harness 能力速查',teaser:'开发编程、框架扩展、飞书协作、方舟模型：按四类使用场景整理。',body:'## 开发与编程\n- 理解代码并定位问题\n- 实现功能、修复 bug\n- 运行测试并审查改动\n\n## 扩展 DeepSeek Harness\n- 增加插件能力\n- 排查运行时问题\n- 完成功能实现与验证\n\n## 飞书协作\n- 阅读文档、处理表格与多维表格\n- 管理日历、任务、审批和云盘\n- 获得授权后发送消息或邮件\n\n## 火山引擎与 ARK\n- 查询模型与管理推理接入点\n- 查看套餐用量\n- 协助精调训练及 Agent 管理'};
    case 'getting-started': return {title:'DSH 初次使用清单',teaser:'从一项具体需求开始，再逐步尝试代码、文档和模型相关能力。',body:'## 从一项具体工作开始\n- 说明你想完成的事情和期望结果\n- 提供相关代码、文档或当前问题\n- 选择先分析还是直接修改\n\n## 可以尝试的任务\n- 请 DSH 解释一个模块，再定位其中的问题\n- 给出一个小功能，让 DSH 实现并验证\n- 整理一份飞书文档，检查表格中的信息\n- 查询模型或查看已有套餐用量\n\n## 有外部影响时\n明确哪些操作可以执行，发送消息或邮件前保留确认步骤。'};
    case 'short': return {title:'DSH 能力简介',teaser:'一段简短介绍，保留四类主要用途。',body:'DeepSeek Harness 中的智能体可以协助代码开发、框架扩展、飞书协作，以及火山引擎 ARK 的模型与资源管理。\n\n你可以提供一项具体需求，让它分析问题、执行操作并验证结果；涉及消息或邮件发送时，需要明确授权。'};
    case 'verification': return {title:'开发改动验收清单',teaser:'从算法、用户流程和持久化三个方面选择对应的验证。',body:'## 先确定改动范围\n- 写清楚这次改动承诺了什么结果\n- 选择能够发现该类问题的最小测试\n\n## 按类型验证\n- 算法修改：运行聚焦单元测试\n- 用户流程：通过实际浏览器操作检查结果\n- 持久化：保存后重新启动服务，再读取数据\n\n## 给出完成结论\n让完成声明与实际测试覆盖的范围一致。'};
    case 'questions': return {title:source.title+' · 待确认问题',teaser:'把材料中明确提到的待确认内容集中保留。',body:'## 材料中的待确认内容\n'+(source.body.match(/## 待确认[\s\S]*/)?.[0].replace('## 待确认','').trim()||'当前材料没有单独列出待确认事项。\n\n## 可继续讨论\n- 最优先解决哪个使用场景？\n- 哪些步骤可以先保持手动？')};
    default: return {title:source.title+' · '+task.plan.name,teaser:task.instruction?`处理要求：${task.instruction}`:'保留原材料的主要内容，作为可继续修改的独立副本。',body:`> ${start}${task.instruction?'；补充要求：'+task.instruction:''}\n\n${source.body}`};
  }
}

function scheduleDemo(callback,delay) {
  const timer = setTimeout(()=>{proposalTimers.delete(timer);callback()},delay);
  proposalTimers.add(timer);
}

function queuePlan(owner,index) {
  const entry = entries.find(e=>e.id===owner);
  if (!entry || !leaveEditor()) return;
  const state = suggestionState(entry);
  if (state.phase !== 'proposed' || !state.plans[index]) return;
  const task = {id:++demoTaskSerial,plan:{...state.plans[index]},instruction:state.instruction,
    source:{title:title(entry),body:text(entry).body},phase:'queued',result:null};
  state.task=task;state.phase='queued';render();
  scheduleDemo(()=>{
    if (state.task!==task || task.phase!=='queued') return;
    task.phase='running';state.phase='running';render();
  },600);
  scheduleDemo(()=>{
    if (state.task!==task || task.phase!=='running') return;
    task.result=demoResult(task);task.phase='succeeded';state.phase='ready';render();
    toast('整理结果已完成，可以预览或采用');
  },2600);
}

function renderQueueStrip() {
  $('#queue-strip')?.remove();
  const tasks = [...suggestionStates].filter(([,s])=>['queued','running','ready'].includes(s.phase));
  if (!tasks.length) return;
  const [owner,state] = tasks.at(-1);
  const waiting = tasks.filter(([,s])=>s.phase==='ready').length;
  $('#list-footer').insertAdjacentHTML('beforebegin',`<button class="queue-strip" id="queue-strip" data-proposal-action="go-task" data-owner="${owner}">${icon('history')}<span>${waiting?`${waiting} 份结果待采用`:`${tasks.length} 项后台任务正在处理`}</span></button>`);
}

function previewResult(owner) {
  const state = suggestionStates.get(owner);
  if (!state?.task?.result) return;
  const task=state.task;
  modal('整理结果',`<div class="dialog-body"><p class="result-origin">${esc(task.plan.name)} · 原材料「${esc(task.source.title)}」保持不变</p><h2 style="font-size:22px;margin:0 0 20px">${esc(task.result.title)}</h2><div class="prose">${markdown(task.result.body)}</div></div><div class="result-actions"><button class="secondary" data-proposal-action="close-preview">再看看</button><button class="primary" data-proposal-action="adopt" data-owner="${owner}">采用并另存</button></div>`);
}

function adoptResult(owner) {
  const state = suggestionStates.get(owner);
  if (!state || state.phase!=='ready') return;
  const result=state.task.result,id=Date.now();
  entries.unshift({id,title:result.title,source:null,resultOf:state.task.source.title,
    saved:'刚刚',updated:'刚刚',favorite:false,archived:false,draft:null,
    versions:[{title:result.title,body:result.body,time:'刚刚',label:'采用整理结果'}]});
  state.phase='adopted';state.resultEntryId=id;
  selected=id;filter='all';query='';$('#search').value='';
  if ($('#dialog').open) $('#dialog').close();
  render();toast('已另存为整理成果，原材料保留');
}

function resetSuggestions() {
  for (const timer of proposalTimers) clearTimeout(timer);
  proposalTimers.clear();suggestionStates.clear();demoTaskSerial=0;
}

document.addEventListener('submit',event=>{
  const form=event.target.closest('[data-proposal-form]');
  if (!form) return;
  event.preventDefault();
  const entry=entries.find(e=>e.id===Number(form.dataset.proposalForm));
  const instruction=form.elements.instruction.value.trim();
  if (!entry || !instruction) return;
  const state=suggestionState(entry);
  if (state.phase!=='proposed') return;
  state.instruction=instruction;
  state.plans=[
    {name:'按你的要求整理',description:instruction,kind:'custom'},
    {name:'先保留完整内容',description:'以完整副本为起点，结合你的要求继续修改。',kind:'structured'},
    {name:'先列出待确认项',description:'把还需要选择的地方集中展示，再决定如何处理。',kind:'questions'},
  ];render();
});

document.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if (!button) return;
  const owner=Number(button.dataset.owner);
  if (button.dataset.plan!==undefined){queuePlan(owner,Number(button.dataset.plan));return}
  const action=button.dataset.proposalAction,state=suggestionStates.get(owner);
  if (!action) return;
  switch(action){
    case 'close-preview':$('#dialog').close();break;
    case 'shelve':state.phase='shelved';render();break;
    case 'restore':state.phase='proposed';render();break;
    case 'cancel':state.task.phase='canceled';state.phase='canceled';render();break;
    case 'preview':previewResult(owner);break;
    case 'adopt':adoptResult(owner);break;
    case 'open-result':if(!leaveEditor())return;selected=state.resultEntryId;filter='all';render();break;
    case 'go-task':if(!leaveEditor())return;selected=owner;filter='all';query='';$('#search').value='';$('#app').classList.add('detail-open');render();break;
    case 'task':{
      const task=state.task;
      const labels={queued:'等待执行',running:'正在生成',succeeded:'执行完成',canceled:'已取消'};
      modal('后台任务',`<div class="dialog-body"><dl class="task-facts"><dt>任务</dt><dd>${esc(task.plan.name)}</dd><dt>输入材料</dt><dd>${esc(task.source.title)}</dd><dt>执行状态</dt><dd>${labels[task.phase]}</dd><dt>结果处理</dt><dd>${state.phase==='adopted'?'已采用并另存':task.phase==='succeeded'?'等待你选择采用':'执行结束后可预览'}</dd></dl><p class="small">任务生成结果后即结束。采用结果时，才会向内容库另存一份。</p></div>`);break;
    }
  }
});

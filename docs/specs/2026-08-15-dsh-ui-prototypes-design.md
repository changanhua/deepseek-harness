# DeepSeek Harness Web UI 原型设计规格

日期：2026-08-15  
状态：已确认方向，待书面规格复核

## 目标

生成三款可直接双击打开的单文件 HTML 原型，探索 DeepSeek Harness 的下一代桌面 Web App 信息架构。原型服务于已经在本机使用 Harness、会同时处理对话、持久任务、工具执行和故障恢复的高级用户；设计只使用 DSH 自身的能力与语义，也不修改 `C:\Users\xbh\deepseek-harness` 的源码或运行数据。

三款原型必须呈现同一组可信的 DSH 语义，但通过明显不同的主轴组织信息：Conversation、Operations、Event Timeline。它们不是三个换色皮肤，而是三种产品入口假设。

## 设计原则

1. **默认视图回答“现在怎样、是否需要我处理”**。普通用户不直接看到事件序号、PID、receipt、command fingerprint 或完整 payload。
2. **高级诊断回答“为什么这样、如何恢复”**。Raw events、Turn/Step、attempt、runId、日志位置和上下文压缩区间必须通过显式的 Diagnostics 开关或 Trace 入口出现。
3. **不同运行机制不得混为一种状态**。Conversation/Agent、Durable Task Queue、Process-local Job、Goal、Workflow Run 各自保留身份、状态和持久性说明。
4. **颜色之外还有形状和文字**。状态使用图标、标签和动词共同表达，不能只依赖红绿颜色。
5. **可操作项紧邻原因**。Approval、Failed task、Queue fault 和 Context pressure 都在对应说明旁提供处理动作。
6. **原型数据写实但不冒充实时连接**。所有数据均标为 Demo workspace；交互只在页面内模拟，不宣称已接入本地 Harness。

## 语义映射

### 持久任务队列

原型使用当前 task-queue 的规范状态：

| DSH 状态 | 默认界面文案 | 说明 |
|---|---|---|
| `pending` | 等待中 | 包含尚未到 `delayUntil`、退避等待和普通排队；细节区再区分原因 |
| `starting` | 启动中 | 已持久化执行意图，尚未确认 spawn 完成 |
| `running` | 运行中 | 当前 attempt 已开始 |
| `stopping` | 正在停止 | 已记录取消意图，等待执行器结算 |
| `succeeded` | 已完成 | 成功终态，可显示 duration 与 outputFiles |
| `failed` | 失败 | 重试耗尽或不可恢复失败，可提供重试 |
| `canceled` | 已取消 | 终态，可按后端能力重新入队 |

`blocked` 不作为 TaskStatus。界面中的“需要处理”是派生集合，例如等待人工审批、Goal blocked、Queue service `paused`/`faulted`、执行器容量或恢复不确定。Queue 服务状态单独显示为 `running`、`paused`、`faulted`。

### 其他运行对象

- Agent 当前执行以 Session / Turn / Step 表示，展示 `idle` 或 `running`，取消属于控制动作和 Turn 结束原因。
- Tool Calls 可在同一步中并行，界面使用并行泳道或并排执行卡，而不是伪装成连续步骤。
- Approval 是一次待回答交互，显示工具、风险摘要、工作目录和 Allow / Deny；完整参数属于高级详情。
- Goal 使用 `active`、`paused`、`blocked`、`complete`，并区分 active goal 是否 armed；恢复会话后可能保留 active phase 但需要显式 Resume 重新启用。
- Jobs 使用 `running`、`stopping`、`completed`、`failed`、`killed`，明确标注为当前进程/owner 可见，不与持久队列混称。
- Workflow 展示 run、phase 和并行成员；它是前台收集、无断点恢复的编排，不冒充持久任务。
- Context 展示压力与估算占用。Compaction 显示自动或手动触发、剪枝、摘要与替换范围；不把摘要生成描述成普通模型 Step。
- Model 区显示 provider/model、推理强度、输入/输出/推理/cache token。费用只在存在明确计价数据时显示；原型使用“估算”标签。
- Artifacts 展示任务产物、会话附件和文件变更三类来源，提供打开、复制路径或查看 Diff 的模拟动作。

## 原型一：Session Desk（Conversation-first）

### 单一任务

让用户在不离开对话的情况下，判断 Agent 正在做什么、为何暂停、是否需要审批，以及本次运行产生了什么。

### 布局

```text
┌ Session rail ┬ Conversation ─────────────────┬ Live Inspector ┐
│ sessions     │ messages / tool summaries    │ current run    │
│ queue badge  │ goal strip                   │ approval       │
│ new chat     │ composer                     │ context/files  │
└──────────────┴───────────────────────────────┴─────────────────┘
```

左栏是会话和轻量全局入口；中栏保持熟悉的消息流；右栏是可折叠 Inspector。对话中的 Tool Call 默认渲染为一行摘要，例如“正在并行检查 3 个文件”，成功后折叠。只有失败、审批或用户主动展开时显示输入输出。

### 签名元素与视觉

签名元素是 Inspector 顶部的“运行脉冲”：用一条分段路径表达 Request → Tools → Response，当前阶段轻微呼吸，避免装饰性波形。整体为偏冷的石墨蓝灰，运行状态使用电蓝，审批使用琥珀，故障使用克制的朱红；字体采用清晰的人文无衬线配等宽数据字体。

### 关键交互

- Inspector 在 Overview、Trace、Files 三个标签间切换。
- Approval 的 Allow once、Always allow、Deny 会即时改变 Demo 状态并给出结果反馈。
- “高级诊断”开关显示 Turn/Step、event seq、token buckets 和 raw arguments。
- Context 卡可模拟手动 Compact；成功后压力降低并在聊天中出现系统说明。
- Queue badge 打开全局任务抽屉，但不让 Queue 抢占 Conversation 主轴。

### 适合场景

日常对话、代码修改、少量工具调用，以及希望保持 ChatGPT/Codex 类使用习惯的用户。

## 原型二：Queue Workbench（Operations-first）

### 单一任务

让操作者在一个桌面控制台里管理持久任务吞吐、当前执行、需要人工处理的事项和结果交付。

### 布局

```text
┌ Global health / capacity / pause ─────────────────────────────┐
├ Nav ┬ Queue table / board ───────────────┬ Task details ──────┤
│ Ops │ status, priority, attempt, owner   │ run / logs / files │
│ Runs│ filters + bulk selection           │ retry / cancel     │
├─────┴────────────────────────────────────┴─────────────────────┤
│ Attention strip: approvals · faults · blocked goals · errors  │
└────────────────────────────────────────────────────────────────┘
```

Queue 表格是主面板，顶部状态带同时显示服务状态、全局并发 2/2、各 executor 并发和下一次可领取时间。右侧详情随选择更新。辅助面板通过导航切换 Current Runs、Approvals、Goals、Jobs、Schedules、Context、Artifacts 和 Errors。

### 签名元素与视觉

签名元素是“并发槽位轨道”：固定的执行槽显示当前占用、执行器、耗时和下一候选任务，使 `maxConcurrent` 比一个抽象数字更直观。视觉使用略带工程图纸感的浅灰蓝底、深墨文字和高对比状态带；边框和层级清楚但避免满屏卡片。

### 关键交互

- 状态 chips、executor、tag 和 owner 过滤任务；搜索 title 或 id。
- 选择任务后查看 attempt 历史、日志片段、error、outputFiles 和持久性标记。
- 模拟 Pause / Resume queue、Cancel、Retry、提高或降低优先级，并用 toast 明确反馈。
- “需要处理”过滤器聚合 Approval、failed tasks、Goal blocked 与 Queue fault，但各条仍显示来源类型。
- Jobs 与 Queue 分栏，Jobs 显示“仅当前进程”；Schedules 显示下一次触发和是否启用。

### 适合场景

当前 task-queue 开发、长任务批处理、后台运行监督，以及需要一次处理多项故障的高级用户。

## 原型三：Trace Atlas（Timeline/Event-first）

### 单一任务

让开发者沿着可回放 Session 事实理解一次运行的因果链，并快速定位等待、失败、重试、恢复或上下文压缩发生在哪里。

### 布局

```text
┌ Session / range / severity filters ───────────────────────────┐
├ Event spine ───────────────────────────┬ Event Inspector ─────┤
│ Turn 18                               │ summary               │
│  Step 1 ─ model                       │ related ids           │
│  Step 2 ─┬ tool A ─ done              │ payload (advanced)    │
│          ├ tool B ─ approval ─ done   │ artifacts / recovery  │
│          └ tool C ─ retry ─ failed    │                       │
│  Compaction boundary                  │                       │
└────────────────────────────────────────┴───────────────────────┘
```

事件主轴按 Session 回放顺序组织；Turn 和 Step 是结构节点，Tool Calls 在同一 Step 下分叉为泳道。Approval 以闸门节点插入相关工具泳道，Retry 链回失败请求，Compaction 使用横跨主轴的替换边界。Queue/Job 事件采用独立来源标记，避免误认为 Session transcript 事件。

### 签名元素与视觉

签名元素是“因果丝带”：选中事件后，高亮其 request、tool result、retry、artifact 和恢复关联线。整体采用深海军蓝底，但不是霓虹终端；事件类型用低饱和专色，正文保持高可读性，原始字段采用等宽字体。

### 关键交互

- 按 Normal、Attention、All events 三档密度过滤。
- 折叠 completed Turn，只保留摘要；自动展开 failed、approval、retry、compaction 和 interrupted 链。
- 点击并行工具可仅突出其因果链；点击背景恢复全局视图。
- Diagnostics 显示 event type、seq、turn、step、runId、attempt、原始 JSON；默认只显示人类解释。
- “比较重试”并排展示失败 attempt 与成功 attempt 的 model、reasoning、token 和错误差异。

### 适合场景

插件开发、生命周期调试、事件投影核对、恢复分析和复杂多工具运行复盘。

## 推荐融合方向

正式产品采用 Session Desk 作为默认工作区；增加独立 Operations 路由承载 Queue Workbench；把 Trace Atlas 的事件图谱嵌入 Session Desk Inspector 的 Trace 标签，并允许从 Queue task / Job / Workflow member 深链到相关 Session 或运行事实。

该融合保持三层渐进披露：

1. 默认：对话、当前阶段、需要处理、结果。
2. 操作：队列、并发、失败、重试、后台运行。
3. 诊断：事件、attempt、raw payload、恢复和持久化细节。

## 原型四：Command Center（融合方案）

融合页不把三个原型横向拼接，而是建立一个稳定产品壳：对话和 Operations 是同级工作区，Inspector 是跨工作区保持的上下文面板，Trace 是 Inspector 内的深入层。顶部 Runtime Ribbon 把当前 Session、Queue service 和需要处理事项连接成可跳转路径。

默认路径回答“我和 Agent 正在做什么”；Operations 回答“系统还有哪些工作、哪里被阻塞”；Trace 与高级诊断回答“为何发生、如何恢复”。从 Queue task 可回到相关 Session，从 Attention 可直接定位审批，从当前执行可进入文件与事件事实。

视觉融合沿用 Session Desk 的冷灰桌面壳，并引入 Queue Workbench 的精确状态色；不采用通用 AI 紫粉渐变。高密度仅用于 Operations 表格和 Trace，普通对话区域保持舒展。

## 原型实现约束

- 交付 `01-session-desk.html`、`02-queue-workbench.html`、`03-trace-atlas.html`、`04-fusion-command-center.html` 和 `README.md`。
- 原生 HTML/CSS/JS，单文件运行，不使用构建工具，不依赖 CDN、网络字体或外部图标。
- 图标使用内联 SVG，所有图标按钮包含可访问名称和 tooltip。
- 桌面优先，目标画布 1440×900；在 1024px 仍可用，在窄屏改为层叠布局且无横向页面滚动。
- 支持键盘焦点、Escape 关闭浮层、44px 主要点击目标、`prefers-reduced-motion`。
- 三款原型共享相同 Demo 内容和语义，以便比较信息架构；视觉 token 和布局各自独立。
- 页面内交互包括标签切换、状态过滤、详情选择、诊断开关、审批、重试、取消、队列暂停/恢复和 Compaction 模拟。刷新可恢复初始 Demo 状态。
- 不写入 `deepseek-harness` 仓库，不连接真实服务，不读取用户密钥或本地任务数据。

## 错误与恢复呈现

- 可恢复失败必须显示原因、当前 attempt、下一次动作和重试按钮。
- Queue `faulted` 显示为服务级故障，禁用普通 Resume，并说明需要检查持久日志或重启恢复，不能伪装成单任务失败。
- `terminationUnverified` 只在高级诊断出现，并明确 PID 仅供关联，不是跨重启终止凭据。
- Compaction failure 不改写为“对话丢失”；说明摘要或提交失败以及原 surface 是否仍保留。
- 操作模拟必须给出进行中、成功或失败反馈，不能点击后静默变化。

## 验证标准

1. 每个 HTML 可通过 `file://` 独立打开，控制台无错误。
2. 1440×900 和 1024×768 无关键内容遮挡；窄屏无整页横向滚动。
3. 三款首屏的主视觉层级明显不同，并能在五秒内辨认其主轴。
4. 每款均能找到 Queue、Current Run、并行 Tool Calls、Approval、Goal、Jobs/Schedules、Context/Compaction、Model/Reasoning、Errors/Recovery、Artifacts。
5. 默认视图不暴露原始 JSON、PID、receipt 或完整 prompt；打开 Diagnostics 后可以访问代表性字段。
6. Queue 状态与 serviceState、Job、Goal 状态不会混用；所有 Demo 派生“需要处理”均说明来源。
7. 使用真实浏览器逐款点击主要交互，并截图复核视觉密度、对比度、焦点和溢出。

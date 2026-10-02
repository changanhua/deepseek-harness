# 计划界面

[English](README.md) | 中文


委托主理会显式使用随包交付的 `work-steward` 预设创建原生 Session。该预设使用 standard 编程组合；可选 Planning bundle 提供主理 Skill，执行权限仍由已有审批与 Delivery owner 管理。此入口需要 shipped preset root，不依赖个人预设文件，也不改变部署默认值。普通讨论仍使用该默认值。

## 概述

使用此浏览器界面可安排项目计划、查看来源和执行摘要，并提交明确选择的计划修改。它渲染 Host 拥有的数据，不保留计划授权。

总览列出当前计划、想法收集箱、待处理 Proposal 与归档。打开 Plan 后进入当前状态、工作与讨论、思考桌面、历史与来源四个视图。Focus 选择、搜索和导航在 Client 生命周期内跨模块保留。继续推进会打开精确作用对象下仍可用的原生 Session；没有时再新建，已有绑定保留原基础修订。Proposal 单独打开审阅，只采纳人工明确选中的代次。

个人入口在尚未选择项目时优先选中唯一的 deepseek-harness 工作区。新打开的 Plan 默认显示思考桌面；显式项目选择和各 Plan 已选中的 Tab 在 Client 生命周期内仍保留。

“委托主理”创建并绑定同样的原生 Session，随后提交一条指明随包 `project-steward` Skill 的调查请求。请求保留所选完整目标，要求给出有证据的推荐，并将执行授权留在原有 owner。并发点击共享同一次准入。回复不确定后的显式重试保留 Session、绑定命令和提示词请求身份；明确被拒绝的 Board 冲突可在刷新版本后绑定同一个 Session。

## 使用此包

`@changanhua/dsh-client-ui-planning` 将个人 Planning Remote 投影渲染为按项目隔离的计划池。简短收录先成为可选细节为空的待处理 Proposal，只有明确采纳才创建 active item。所选条目会显示一张确定性演变图，它来自已保留的来源、Proposal 代次、修订、复盘、依赖和交接。

界面以当前 Board 版本提交每次修改。失败操作保留原请求身份供用户显式重试，不会静默覆盖更新后的 Board。它显示已捕获的会话摘录并可打开原会话；组合 Content 后可读取捕获时的精确版本。手工记录和链接标明未验证，人工安排与 Delivery 进度分别显示。

思考桌面只读取已有 Design Case 的通用摘要，不创建探索。FC27 SBC 会打开独立 owner 视图，并且只在用户输入问题后启动原生 `thinking-desk` Session；启动中断后会恢复同一 prepared Session、Planning binding 与 kickoff 请求。冻结的 Planning 和 Case 输入、选择、布局、探索建议、Design Context 与移动撤销都保存在 Case 记录中；返回后保留 Plan/Focus 选择并重新读取当前 Planning 事实。

结果审阅将 Agent 输出与正式 Planning 分开，在三个独立的人类动作保存探索建议、保存 Design Context 或创建 Proposal 前展示实际内容。Case 漂移时须明确确认才能应用仍适用的候选；Planning 漂移会阻止创建 Proposal。Proposal 审阅展示一个精确代次的 state entry、Focus、资源、来源和证据差异；缺少不可变或代次绑定的前值时会禁用采纳。

画布工具栏和空白处右键菜单可以在指定位置创建手动探索卡片。选中卡片后可从工具栏编辑，也可右键或双击编辑。卡片标题和正文保存在 Case 中，并进入下一轮 Thinking 上下文。冻结的 Planning 投影卡片保持只读；移动撤销只作用于仍存在的卡片。

## 不变量策略

不发布 invariant 伴随模块，因为工作台只在 Host 记录之上维护可丢弃的浏览器状态。

## 模型体验

### 委托调查请求

#### 模型看到什么

普通 Session 创建保持空白。“委托主理”发送一条原生用户消息，以 `Please take stewardship of the bound Planning subject. Load the project-steward Skill and read planning_context first.` 开头。其余[请求模板](src/client/session-start.ts)要求恢复已有发现、给出推荐和下一步，并指明精确作用对象。原始绑定与基础修订来自 Planning 上下文。Skill 正文由可选 Planning bundle 拥有。

#### Token effect

委托增加一条用户消息，以及 Agent 加载时的 Skill 文本。普通 Session 创建不增加提示词 token。

#### KV Cache effect

委托消息开启一个新 Session；后续轮次使用其普通持久历史。

## 已知限制与延后工作

- Planning 分组不表示执行结果；Delivery 合同与决策继续在交付工作台处理。
- 演变图显示已保留的谱系与当前关系，不会虚构从未存储的历史泳道或依赖值。
- 后台提醒与复盘的原子后续项仍未完成。
- 准入重试状态属于当前挂载的 UI。浏览器重载后，应先查看保留的 Session 和 Planning 绑定再发起新工作。该入口不安装后台监测，也不批准 Delivery 工作。
- 思考面板创建 Proposal，采纳仍交给既有的 Planning 审阅。

`planning.subject.actions` slot 只向可选 consumer 提供 workspace id、所属 Plan id 及选中的 Plan/Focus identity。它不拥有评估状态，不授予 mutation 能力。卸载 consumer 后入口移除，Planning 状态不变。

# Planning × 思考桌面 × FC27 Design Case：下一阶段实现规格

> 日期：2026-09-30  
> 用途：直接交给 Codex 继续实现。  
> 当前交接点：用户确认 FC27 Design Case 的 WP0 / WP1 已完成；本规格从 WP2 开始，不重新设计或重做 WP0 / WP1。  
> 目标：把已经存在的 Planning canonical work-object 能力与 FC27 Design Case 的非破坏性探索能力，收敛成一套可长期使用的 Planning 工作页与「思考桌面」入口。

## 0. Codex 接手方式

拿到本文后先读当前工作树与仓库约束，不要直接照图改 CSS。

至少阅读：

- [根级 AGENTS](../../AGENTS.md)
- [架构](../architecture.md)
- [Planning 子系统](../subsystems/planning.zh.md)
- [Planning UI 包](../../packages/client/ui-planning/README.zh.md)
- [当前对象工作区](../../packages/client/ui-planning/src/client/PlanningObject.tsx)
- [当前 Planning 工作台](../../packages/client/ui-planning/src/client/PlanningWorkbench.tsx)
- [Planning Workspace 真实纵切测试](../../apps/web/tests/planning-workspace.e2e.ts)
- [项目 Planning / Execution 边界](../../.agents/notes/implemented/architecture/2026-09-27-project-planning-and-execution-boundaries.zh.md)
- [FC27 SBC 总体设计](2026-09-25-fc27-sbc-assistant.md)
- [FC27 SBC 现场交接](2026-09-26-fc27-sbc-handoff.md)

然后：

1. 在当前分支 / 工作树定位用户所说已经完成的 FC27 Design Case WP0 / WP1 实现。
2. 把它当作已有能力验证，不要因为 master 上路径或命名不同就自行重做一套。
3. 生成一份很小的 implementation planning，只覆盖本文标记为“当前实施”的 WP2 / WP3。
4. 若当前实现与本文某个具体文件名冲突，以真实仓库为准；若与本文的数据所有权、不变量冲突，停止并报告，不要静默改变产品模型。

---

## 1. 产品模型：Planning 不是思考桌面，思考桌面也不是第二套 Planning

长期模型固定为：

```text
外部现实 / 工具 / Solver / Browser
              │
              ▼
        思考桌面 / Design Case
     persistent but non-canonical
              │
       ┌──────┴──────┐
       ▼             ▼
  Design Context   Proposed Delta
  为什么这样设计    建议正式改变什么
       │             │
       └──────┬──────┘
              ▼
         Human Review
              │
              ▼
           Planning
        canonical truth
              │
              ▼
      Delivery / Execution
```

不可破坏的不变量：

- **Planning 是正式工作状态的 canonical truth。**
- **思考桌面是可持久化、可分叉、可撤销的探索空间，但不是 canonical truth。**
- Design Case 的拖动、排列、临时关系、假设、分支，不自动写回 Planning。
- Planning 的正式变化只通过现有 Proposal / `PlanningProposedDelta` / 明确人工采纳进入 canonical revision。
- SBC requirements、球员、inventory、chemistry、solver output、browser facts、价格与交易状态继续由各自领域拥有；Planning 只保存必要引用。
- 不为思考桌面扩一套 Planning schema。
- 不在这一阶段抽象“通用视觉编程器”“通用 graph editor”或“万能 Thought Surface”。

仓库已有的 Planning Workspace v0 正好提供桥：

- Plan / Focus / `PlanningSubjectRef`
- stable state entries：objective / accepted / open
- `ResourceRef`
- Session binding + `baseRevision`
- `PlanningProposedDelta`
- stale base rejection
- deterministic evolution projection

思考桌面应建立在这些桥上，而不是替换它们。

---

## 2. UI 总体设计

参考当前确认的设计方向，但不要把概念图理解为“同时显示两个浏览器窗口”。实际产品是两个主要页面状态：

1. **Planning 总览页**
2. **单个 Plan 的工作页**

### 2.1 Planning 总览页

目标：从现在的“计划池 + 右侧详情”转成真正的对象入口页，优先回答“我现在该继续哪件事”。

页面结构：

```text
Planning
├─ 继续上次的工作
│  └─ FC27 SBC 半自动化
│     上次停在：首个可靠纵切设计
│     [继续推进]
│
├─ tabs
│  ├─ 当前计划
│  ├─ 想法收集箱
│  ├─ 待我确认
│  └─ 已归档
│
├─ 当前计划
│  ├─ FC27 SBC 半自动化       安排：现在
│  ├─ Planning 实时演变图     安排：接下来
│  └─ Codex Planning 接入     安排：稍后
│
└─ 待我确认
   ├─ Proposal / 差异 / 待确认决定
   └─ Proposal / 差异 / 待确认决定
```

设计原则：

- 主体是 **Plan 对象**，不是 lane 本身。
- lane 继续存在，但降级为对象的安排属性 / 过滤条件。
- “继续上次的工作”优先使用最近有效的 Plan / Focus / Session binding，不新建另一套 recent-work 状态。
- “待我确认”优先投影当前 Planning pending Proposal；不要新造确认状态机。
- 搜索仍复用当前 Planning 搜索能力。
- 想法收集保持“先保存原文、允许信息不完整”的已有语义。

### 2.2 Plan 工作页

打开一个 Plan 后进入独立工作页，而不是把所有详情挤在总览右栏。

顶部稳定身份：

- breadcrumb：全部计划 / 当前 Plan
- Plan title
- 一句话 intent / summary（已有内容才显示，不自动补齐）
- lane badge，例如“安排：现在”
- 当前 Focus，例如“当前推进点：首个可靠纵切设计”
- 主动作：“继续推进”
- 更多菜单

工作页一级 tabs：

1. **当前状态**
2. **工作与讨论**
3. **思考桌面**
4. **历史与来源**

这四项代表四种不同的数据视角，不要把它们实现成四份数据。

---

## 3. 各 tab 的职责

### 3.1 当前状态

只展示 Planning canonical state。

推荐布局：

```text
目标
└─ objective entries

已确认的决定                  待解决的问题
├─ accepted entry              ├─ open entry
└─ accepted entry              └─ open entry

Focus
├─ 当前 Focus
└─ 其他 Focus

关联资源
└─ ResourceRef summaries
```

这里不展示思考桌面的临时节点，不把 Design Case 草稿混成“已确认决定”。

现有 [PlanningObject](../../packages/client/ui-planning/src/client/PlanningObject.tsx) 已经有 objective / accepted / open、Focus、Session、Resource 的真实能力；本阶段首先是重组呈现，不应复制数据模型。

### 3.2 工作与讨论

这是 Session / Agent 推进入口。

目标不是做“会话列表中心”，而是回答：

- 当前在推进哪个 Plan / Focus？
- 哪些 Session 正在或曾经推进它？
- Session 基于哪个 `baseRevision`？
- 继续讨论时应该装载哪个 Planning context？

必须保留现有 Session binding 语义：切换 UI 选中对象不能改变已绑定 Session 的 subject / base revision。

本阶段允许先复用现有原生 Session UI 和启动能力，不要求重写聊天系统。

### 3.3 思考桌面

这是本轮新 UI 的核心。

思考桌面 tab 本身不拥有 Planning truth。它是当前 Plan / Focus 的探索入口和 Design Case 容器。

顶部必须明确显示三种状态：

```text
[Planning 基线 / canonical]   [Exploration]   [revision status]
```

例如：

- Planning 基线 / canonical：Planning 是正式状态。
- Exploration：当前内容是独立探索空间。
- revision status：`基于 r12 · 当前 r14 · 存在 drift`。

不能只用颜色暗示，文本也必须说清楚。

FC27 第一张 Design Case 卡：

```text
SBC 首个纵切
独立探索，不改动正式计划。

[mini preview of exploration]
问题定义 -> 方案探索 -> 技术方案 -> 验证与评估

[打开设计]
```

这个 mini preview 是摘要，不要求在 Planning 页面重新实现一套画布。

点击“打开设计”进入或挂载 WP1 已完成的 FC27 Design Case 实现。

### 3.4 历史与来源

复用并重新组织：

- immutable revisions
- source provenance
- evolution
- reviews
- Delivery / evidence links

演变图属于 Planning 历史投影，不等于思考桌面。

---

## 4. Planning 与 Design Case 的最小连接合同

优先复用现有 `ResourceRef`，不要给 Planning core 增加 `thinkingDesktop` / `designCase` 专有字段。

推荐把一个 Design Case 作为外部资源引用，例如概念上：

```text
ResourceRef {
  kind: "design-case"
  id: "<external case id>"
  provider: "<owning plugin/package>"
  revision: "<optional case revision>"
  label: "SBC 首个纵切"
}
```

具体字段与可用 kind 是否允许自由字符串，以当前源码合同为准；如果现有类型需要一个极小扩展，扩的是**可扩展资源引用能力**，而不是 SBC 专用 Planning schema。

Planning 页面只需要通过一个 UI adapter 得到以下摘要：

```text
DesignCaseSummary
- id
- title
- subject: Plan | Focus
- baseRevision
- currentPlanningRevision
- drift: clean | stale
- updatedAt
- preview summary
- open action
```

这个 summary 是 UI 投影合同，不要求 Planning 持久保存全部字段。

Design Case 自己继续拥有：

- 节点位置
- selection
- local relation
- undo state / persisted exploration history
- hypotheses / branches（如果 WP1 已经有）
- case-specific view state

---

## 5. 从思考桌面产出的两类东西

思考桌面下方固定保留“从思考桌面产出”区域，但本轮不要一次把所有后端都做完。

### A. 设计上下文

含义：**为什么这样设计。**

它用于承载：

- 关键取舍
- 已排除路线
- 重要约束
- 验证发现
- 后续 Agent 需要知道、但不适合写进 Planning canonical state 的设计理由

WP2 / WP3 只需要把这个产物类型在 UI 和接口边界上留出来；不要求先做通用 Context 知识库。

FC27 case 可以先链接现有 case context / spec / artifact，或者使用 WP1 已有持久化能力提供摘要。

### B. 提议变更

含义：**正式工作状态应该改变什么。**

必须复用：

```text
Design Case
  -> PlanningProposedDelta
  -> pending Proposal
  -> human review
  -> exact adoption
  -> new canonical revision
```

禁止：

```text
drag node -> mutate Planning
local relation -> mutate Planning
close Design Case -> auto-adopt
AI says yes -> auto-adopt
```

---

## 6. FC27 Design Case 当前进度

### 已完成：WP0 — Integration Seam

用户确认已完成。Codex 只需在当前实现分支验证，不重新设计。

WP0 的职责：

- 找到真实 Planning Plan / Focus / revision seam。
- 明确 canonical 与 external state ownership。
- 建立 SBC case 到 Planning 的引用路径。
- 不复制 Planning schema。

### 已完成：WP1 — Minimal Persistent Exploration

用户确认已完成。Codex 只需验证当前实现，不重新创建另一套。

WP1 应被视为已经提供：

- 读取 / 投影 canonical Plan / Focus
- 记录 `baseRevision`
- local selection
- local rearrangement / dragging
- weak exploratory relation（若当前实现已落地）
- undo
- exploration persistence
- reload / return
- revision drift detection / visibility

如果当前代码与上面一项不同，以用户已经验收的实际 WP1 为准，记录差异，不擅自补齐为另一套实现。

---

## 7. 当前实施：WP2 — Planning 产品壳与对象工作页

这是 Codex 当前第一优先级。

### WP2.1 总览页重组

把当前 Planning workbench 的信息架构改成：

- 继续上次的工作
- 当前计划
- 想法收集箱
- 待我确认
- 已归档

保留现有数据与操作，不先改 Planning schema。

### WP2.2 Plan 独立工作页

把选中 Plan 从右栏详情升级为独立对象工作页，至少提供：

- title / intent
- lane
- current Focus
- objective / accepted / open
- continue / start Session
- 四个 tabs 的壳

### WP2.3 当前状态 tab

用现有 canonical state 实现 mockup 中：

- 目标
- 已确认的决定
- 待解决的问题
- Focus / resources

### WP2.4 待确认投影

首页“待我确认”直接来源于 pending Proposals / stale conflict 等现有 Planning 事实，不创建第二套 review queue。

### WP2 验收

- 现有 Planning 创建、收录、搜索、Proposal adoption、Focus、Session binding 等主路径不回退。
- FC27 Plan 可以从总览打开独立工作页。
- “当前状态”中只出现 canonical state。
- 页面刷新后仍指向同一 Plan；不存在依赖 React 临时状态才能找回对象的情况。
- 原有 Planning e2e 与新增对象页 e2e 通过。

---

## 8. 当前实施：WP3 — 思考桌面入口与 FC27 Design Case 挂载

WP3 不重写 WP1 的画布 / Case 实现，只把它正确接到 Plan 工作页。

### WP3.1 思考桌面 tab

在 Plan 工作页增加可用的“思考桌面” tab。

它至少展示：

- Planning baseline badge
- Exploration badge
- case base revision
- current Planning revision
- drift state
- Design Case card
- 打开设计 action

### WP3.2 FC27 case summary

FC27 Plan 下能看到“SBC 首个纵切” Design Case。

如果 case 绑定在 Focus，页面应显示它属于哪个 Focus；如果绑定 Plan，则显示 Plan。

### WP3.3 打开 / 返回

支持：

```text
Plan work page
 -> 思考桌面
 -> 打开 SBC Design Case
 -> exploration
 -> 返回 Plan work page
```

返回后：

- case 仍存在
- local exploration 不丢失
- Planning canonical state 未被本地探索修改

### WP3.4 drift

若 Design Case `baseRevision != current Planning head revision`：

- tab 摘要必须明确显示 stale / drift
- 打开 Design Case 后仍能看到 drift
- 不自动覆盖 exploration
- 不自动 rebase
- 不自动创建 Proposal

### WP3 验收

真实纵切：

```text
FC27 Plan canonical revision N
  -> open Plan work page
  -> 思考桌面
  -> SBC Design Case
  -> local exploration
  -> reload / return
  -> exploration survives
  -> Planning changes to N+1
  -> return to 思考桌面
  -> drift visible
  -> canonical / exploration remain separate
```

---

## 9. 下一阶段，不在本轮默认实施：WP4 — 思考产物桥

只有 WP2 / WP3 稳定后再做。

目标：

1. “设计上下文”有一个可持久、可引用的产物位置。
2. “提议变更”能从 Design Case 形成 `PlanningProposedDelta`。
3. 用户能在 Planning 里查看 Proposal 差异并明确采纳。
4. 采纳后产生新 canonical revision。
5. 原 Design Case 因 base revision 旧而进入 drift，除非用户显式刷新 / reconcile。

不要在 WP4 顺手做通用自动 merge/rebase。

---

## 10. 更后阶段：WP5 — 真实使用反馈后再抽象

只有 FC27 case 真正使用一段时间后才决定是否抽象：

- 通用 Thinking Desktop plugin
- 通用 case registry
- 多种 Design Case 类型
- branch / ghost / compare
- AI-assisted transformations
- 自动 Context 编译
- 更强的 proposed-delta builder

抽象条件是至少出现第二个真实 case 的重复需求，而不是“看起来以后会用”。

---

## 11. 建议实现边界

优先修改 / 复用现有 Planning UI：

- `packages/client/ui-planning/src/client/PlanningWorkbench.tsx`
- `packages/client/ui-planning/src/client/PlanningObject.tsx`
- `packages/client/ui-planning/src/client/PlanningWorkbench.module.css`
- 当前 runtime / contract / locale / tests

FC27 Design Case 继续留在它已有的 owner 中。

如需要一个很薄的连接层，可以增加 Planning UI 内的 adapter / summary component，但不要把 Design Case 的持久化状态搬进 `ui-planning`。

推荐组件边界：

```text
PlanningOverview
PlanWorkspace
├─ CurrentStateTab
├─ WorkAndDiscussionTab
├─ ThinkingDeskTab
│  ├─ CanonicalExplorationStatus
│  ├─ DesignCaseCard
│  └─ ThinkingOutputsSummary
└─ HistoryAndSourcesTab
```

这些是 UI 组件边界，不是新领域对象。

---

## 12. 明确非目标

本轮 WP2 / WP3 不做：

- 新 Planning core schema，除非现有 ResourceRef 完全无法表达外部 case 引用且能证明最小扩展必要
- 通用 Thought Surface framework
- 通用 graph editor
- 通用视觉编程
- AI 自动生成思考图
- 自动 Planning mutation
- 自动 merge / rebase exploration
- full SBC solver
- Auto Buy
- 自动 SBC Submit
- FC27 browser execution loop
- 重写 Session / Delivery / Queue
- 为 mockup 视觉效果制造第二份业务状态

---

## 13. Codex 完成 WP2 / WP3 后必须回报

不要只说 implemented。

报告：

1. 实际修改了哪些模块。
2. 哪些现有 Planning 能力直接复用。
3. Design Case 的真实 owner / persistence 在哪里。
4. Plan / Focus 如何关联 Design Case。
5. `baseRevision` 与 current revision 如何得到。
6. drift 如何计算与显示。
7. 是否修改了 Planning core schema；若修改，为什么不能用现有 ResourceRef / adapter 完成。
8. canonical state 与 exploration state 各在哪里。
9. 运行了哪些聚焦测试 / e2e。
10. 用 FC27 做一次可重复的完整验收步骤。

如果实现中发现 WP0 / WP1 实际并未全部存在，不要直接补做并扩 scope；先列出“用户交接假设 vs 当前代码事实”的差异，再决定最小阻断项。

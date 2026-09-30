# Planning UI 重构：对象中心工作页与思考桌面入口

> 日期：2026-09-30  
> 状态：当前实现规格  
> 目标：优化 **Planning 页面本身的产品 UI 与信息架构**。FC27 只是第一个用于验证“思考桌面 / Design Case”入口的真实案例，不是本规格的产品中心。

## 0. 先纠正范围

这次任务不是“继续做 FC27 SBC 功能”。

这次任务的主体是：

> 把当前可用但偏工程工作台式的 Planning UI，升级成以 Plan 对象为中心、能持续推进工作、并为思考桌面留出正确位置的产品页面。

FC27 Design Case 的作用仅是：

- 已经有一个真实 Design Case 可用于验证 Planning 与思考桌面的关系；
- 验证 Plan / Focus 能否挂载一个非 canonical 的探索空间；
- 验证 revision drift 在 Planning 工作页中如何被看见；
- 防止思考桌面设计停留在空泛白板。

不要把 Planning UI 做成 FC27 专用页面，也不要让 FC27 的字段进入 Planning core。

---

## 1. 当前仓库事实

实现前先读：

- [根级 AGENTS](../../AGENTS.md)
- [架构](../architecture.md)
- [Planning 子系统](../subsystems/planning.zh.md)
- [Planning UI README](../../packages/client/ui-planning/README.zh.md)
- [PlanningWorkbench](../../packages/client/ui-planning/src/client/PlanningWorkbench.tsx)
- [PlanningObject](../../packages/client/ui-planning/src/client/PlanningObject.tsx)
- [Planning Workspace e2e](../../apps/web/tests/planning-workspace.e2e.ts)
- [Planning / Execution 边界](../../.agents/notes/implemented/architecture/2026-09-27-project-planning-and-execution-boundaries.zh.md)

当前 Planning 已经有可复用的正式能力：

- Plan 与 immutable revision；
- objective / accepted / open 状态条目；
- Focus；
- `PlanningSubjectRef`；
- `ResourceRef`；
- Session binding + `baseRevision`；
- Proposal / `PlanningProposedDelta`；
- explicit adoption；
- stale base rejection；
- sources / reviews / dependencies / evolution / Delivery projection。

因此本轮默认是 **UI / projection / navigation 重构**，不是 Planning 数据模型重写。

---

## 2. 产品模型

Planning 页面承担“这件事现在正式是什么，以及我如何继续推进”。

思考桌面承担“在不改变正式状态的前提下，我如何探索、比较、推演”。

两者关系：

```text
Plan / Focus
canonical state in Planning
        │
        ├──────────────► 工作与讨论
        │                 Session / Agent 推进
        │
        ├──────────────► 思考桌面
        │                 Design Case / exploration
        │                         │
        │                         ├── Design Context
        │                         └── Proposed Delta
        │                                  │
        │                             human review
        │                                  │
        ◄───────────────────────────────────┘
        │
        ▼
new canonical revision
```

必须保留：

- Planning = canonical truth。
- 思考桌面 = persistent but non-canonical exploration。
- Session 是推进对象的手段，不是产品组织中心。
- Design Case 是思考桌面中的一个真实探索对象，不是 Plan 本身。
- 外部领域事实继续由外部系统拥有。

---

## 3. 总体信息架构

Planning UI 改成两个主要页面状态：

```text
Planning Overview
      │
      └── open Plan
             │
             ▼
       Plan Workspace
       ├── 当前状态
       ├── 工作与讨论
       ├── 思考桌面
       └── 历史与来源
```

不要继续把“所有计划池 + 完整详情 + 所有操作”同时塞在同一屏左右两栏。

---

## 4. Planning Overview：计划总览

### 4.1 页面目标

用户打开 Planning 后第一眼应该知道：

1. 我上次做到哪里；
2. 现在有哪些计划值得继续；
3. 哪些东西在等我确认；
4. 新想法去哪里；
5. 如何快速进入一个 Plan。

不是第一眼看到所有底层字段和编辑器。

### 4.2 页面结构

```text
计划
[项目选择]                                      [搜索]

┌────────────────────────────────────────────┐
│ 继续上次的工作                             │
│ FC27 SBC 半自动化                          │
│ 上次停在：首个可靠纵切设计                │
│                               [继续推进]   │
└────────────────────────────────────────────┘

[当前计划] [想法收集箱] [待我确认 2] [已归档]

当前计划
┌────────────────────────────────────────────┐
│ FC27 SBC 半自动化          安排：现在      │
│ 推进点：首个可靠纵切设计          [打开]   │
└────────────────────────────────────────────┘
┌────────────────────────────────────────────┐
│ Planning 实时演变图        安排：接下来    │
│ 保留修订与来源关系                [打开]   │
└────────────────────────────────────────────┘

待我确认
- Proposal / 结构变化 / 差异
- stale proposal / 需要重新审阅的变化
```

### 4.3 数据来源

不要新建一份“Overview 数据库”。

优先从现有 Planning 投影：

- 当前计划：active items + lane；
- 想法收集箱：inbox / pending capture；
- 待我确认：pending Proposal，以及确实需要用户处理的冲突状态；
- 已归档：archived / non-active disposition；
- 当前推进点：当前 Plan 的 active Focus（如果有）；
- 继续上次的工作：优先依据最近可恢复的 Plan / Focus / Session binding；如果当前系统没有可靠的 recent 事实，第一版宁可退化为最近明确选择的 Plan，不要伪造“智能推荐”。

### 4.4 交互原则

- lane 是安排属性，不再作为页面主体。
- “打开”进入 Plan Workspace。
- “继续推进”优先恢复当前 Focus / Session；没有可恢复 Session 时再启动新的原生 Session。
- “想法收集箱”继续允许原始想法不完整。
- pending Proposal 不混进 current canonical state。

---

## 5. Plan Workspace：单个计划工作页

### 5.1 Header

示例：

```text
全部计划 / FC27 SBC 半自动化

FC27 SBC 半自动化                         [继续推进] [...]
先完成 SBC 的可靠纵切，再扩展其他 FC27 功能。

[安排：现在]  当前推进点：首个可靠纵切设计
```

要求：

- title 来自当前 canonical revision；
- intent / summary 只有已有内容时才展示，不自动生成；
- lane 显示但不抢主视觉；
- Focus 是“当前推进点”，不是 mandatory task tree；
- “继续推进”绑定当前 Plan / Focus。

### 5.2 一级 tabs

固定四个：

1. **当前状态**
2. **工作与讨论**
3. **思考桌面**
4. **历史与来源**

四个 tab 是同一 Plan 的四种投影视图，不是四份数据模型。

---

## 6. 当前状态 tab

这里只展示 canonical Planning state。

布局：

```text
目标
└─ objective

已确认的决定                 待解决的问题
├─ accepted                  ├─ open
└─ accepted                  └─ open

当前推进点 / Focus
关联资源
```

把当前 [PlanningObject](../../packages/client/ui-planning/src/client/PlanningObject.tsx) 已有的 objective / accepted / open / Focus / Resource 能力重新组织成产品语义。

要求：

- exploration 节点不能出现在“已确认的决定”；
- pending Proposal 不能伪装成 accepted；
- 不为了填满界面自动制造 objective / accepted / open；
- 编辑可继续使用现有 Planning mutation / Proposal 规则，不新增隐式写入路径。

---

## 7. 工作与讨论 tab

目标：让 Session 服务于 Plan / Focus，而不是让用户自己管理上下文。

显示：

- 当前工作对象：Plan 或 Focus；
- 已绑定 Session；
- 每个 Session 的 `baseRevision`；
- 最近一条可恢复 Session；
- 启动新 Session；
- 与 Session 有关的资源 / 结果引用。

必须保留：

- 一个 Session 绑定后，即使 UI 切换到其他 Plan / Focus，也不能偷偷改变其 subject；
- Session 仍是原生 Session，继续复用现有模型、附件、权限、preset 等能力；
- 不因为做新 UI 就重写聊天系统。

---

## 8. 思考桌面 tab

这是 Planning 与未来思考桌面的**入口层**，不是把完整思考桌面直接塞进 Planning。

### 8.1 页面职责

回答：

- 这个 Plan / Focus 有没有正在进行的 Design Case？
- 它基于哪个 Planning revision？
- 当前 Planning 是否已经变化？
- 我可以进入哪个探索空间？
- 探索产出的 Context / Proposed Change 在哪里？

### 8.2 通用结构

```text
思考桌面

[Planning 基线 / canonical]
Planning 是唯一正式状态

[Exploration]
思考桌面是独立探索空间

[revision]
基于 r12 · 当前 r14 · 存在 drift

设计案例
┌──────────────────────────────────────────┐
│ <Design Case title>                     │
│ 独立探索，不改动正式计划                │
│                                          │
│ [preview / summary]                      │
│                              [打开设计]  │
└──────────────────────────────────────────┘

从思考桌面产出
┌──────────────────┐  ┌──────────────────┐
│ 设计上下文       │  │ 提议变更         │
│ 为什么这样设计   │  │ 待人工确认       │
└──────────────────┘  └──────────────────┘
```

### 8.3 Design Case 必须是通用入口

Planning UI 不认识 SBC 业务字段。

它只需要一个很薄的摘要接口，例如概念上：

```text
DesignCaseSummary
- id
- title
- subjectRef
- baseRevision
- updatedAt
- status
- preview
- open()
```

具体类型由 Codex 根据当前已完成的 Design Case 实现与插件边界确定。

如果可以复用 `ResourceRef` 表达 Design Case identity，优先复用；不要给 Planning core 增加 SBC 专有字段。

### 8.4 FC27 在这里是什么

FC27 只是第一个真实卡片：

```text
SBC 首个纵切
独立探索，不改动正式计划。
[打开设计]
```

它用于验收通用入口。

未来这里可以是浏览器流程设计、架构方案、产品需求探索等其他 Design Case，而不改 Planning 页面结构。

### 8.5 revision drift

当：

```text
case.baseRevision !== currentPlan.headRevision
```

必须明确显示 drift。

第一版：

- 不自动覆盖 exploration；
- 不自动 rebase；
- 不自动把本地变化写入 Planning；
- 不自动创建 Proposal。

---

## 9. 历史与来源 tab

把当前散落在详情里的历史信息集中到这里：

- sources；
- immutable revisions；
- evolution；
- reviews；
- dependencies；
- Delivery / evidence links。

Planning evolution 是 canonical history 的确定性投影；它和思考桌面 canvas 是两种不同东西，不要合并。

---

## 10. “从思考桌面产出”的边界

### 设计上下文

表示“为什么这样设计”。

它不是 Planning canonical state，适合保存：

- 关键取舍；
- 约束；
- 被放弃路线；
- 设计理由；
- 验证发现；
- 后续 Agent 需要继承的上下文。

本轮 Planning UI 只需要提供入口 / 摘要，不要求同时造一个通用知识库。

### 提议变更

表示“正式 Planning 应改变什么”。

必须走：

```text
Design Case
 -> PlanningProposedDelta
 -> pending Proposal
 -> human review
 -> exact adoption
 -> new canonical revision
```

禁止由节点拖动、关系连接、关闭 Design Case、AI 判断等动作直接修改 Planning。

---

## 11. 两条工作线必须分开看

### A. FC27 Design Case 工作线

用户当前确认：

- **FC27 WP0：已完成**
- **FC27 WP1：已完成**

这意味着 FC27 已经能作为真实 Design Case 验证材料。

本轮不要以“继续 FC27 WP2”为任务标题，也不要把整个 Planning UI 优化挂在 FC27 roadmap 下。

### B. Planning UI 工作线

当前状态：

- Planning canonical workspace v0：已存在；
- 当前 UI：功能存在，但仍是偏工程工作台的单页布局；
- 新 Planning UI：**现在开始实现**。

本轮实施编号使用独立前缀，避免和 FC27 WP 混淆。

---

## 12. 当前实施范围

### PUI-WP1 — Planning Overview

实现：

- 继续上次的工作；
- 当前计划；
- 想法收集箱；
- 待我确认；
- 已归档；
- Plan card；
- 打开 Plan Workspace；
- 项目选择与搜索继续可用。

不要为了这个页面改 Planning core schema。

### PUI-WP2 — Plan Workspace

实现独立 Plan 工作页与四个 tabs：

- 当前状态：完整可用；
- 工作与讨论：复用现有 Session binding / start session；
- 思考桌面：先有真实入口结构；
- 历史与来源：复用现有 sources / revisions / evolution 等。

这是当前 UI 重构的主体。

### PUI-WP3 — 通用思考桌面入口 + FC27 首个挂载

实现：

- generic Design Case summary adapter；
- Planning baseline / Exploration / revision drift 状态；
- 一个 Plan / Focus 可展示 Design Case；
- FC27 “SBC 首个纵切”作为第一个真实挂载；
- 打开 Design Case 与返回 Plan Workspace；
- 不丢失 FC27 WP1 已有 exploration；
- 不修改 canonical state。

**PUI-WP1 / PUI-WP2 / PUI-WP3 都属于本轮 Planning UI 优化。**

---

## 13. 后续，不在本轮默认扩 scope

### PUI-WP4 — Thinking Outputs

- Design Context 的正式持久化 / 引用方案；
- Design Case -> `PlanningProposedDelta`；
- Proposal diff；
- human adoption；
- adoption 后 case drift / reconcile UX。

### PUI-WP5 — 第二个真实 Case 后再抽象

只有第二个真实 Design Case 出现重复需求后，才考虑：

- 通用 Thinking Desktop plugin；
- case registry；
- branch / ghost / compare；
- AI transformations；
- 自动 Context 编译。

不要为了未来可能性提前建平台。

---

## 14. 视觉与交互要求

视觉方向沿用用户确认的 mockup：

- 明亮、干净、低噪声；
- Plan 是主要视觉对象；
- 蓝色用于主动作和 canonical；
- Exploration 用另一种弱强调，不与 canonical 混淆；
- drift 必须具有明确文字状态；
- 卡片层级清楚，减少当前页面大面积工程表单感；
- 高级编辑和低频字段可以放到二级区域 / drawer / modal，不抢主页面；
- 不牺牲键盘可访问性和现有 focus-visible 规则。

不要把 mockup 当作像素级截图复刻；产品信息架构和状态语义优先。

---

## 15. 实现边界

优先在现有包内重构：

- `packages/client/ui-planning/src/client/PlanningWorkbench.tsx`
- `packages/client/ui-planning/src/client/PlanningObject.tsx`
- `packages/client/ui-planning/src/client/PlanningWorkbench.module.css`
- 相关 locale / projection / runtime / tests

可以拆新 UI 组件，例如：

```text
PlanningOverview
PlanWorkspace
├─ CurrentStateTab
├─ WorkAndDiscussionTab
├─ ThinkingDeskTab
└─ HistoryAndSourcesTab
```

这些是 UI 组件，不是新领域模型。

FC27 Design Case 继续留在自己的 owner 中，只提供 adapter / reference / open action。

---

## 16. 明确非目标

本轮不要：

- 把 Planning UI 做成 FC27 UI；
- 为 FC27 增加 Planning core 字段；
- 重写 FC27 WP0 / WP1；
- 重写 Session；
- 重写 Delivery / Queue；
- 做 full SBC solver / Auto Buy / Auto Submit；
- 做通用 graph editor；
- 做完整 Thinking Desktop 平台；
- 自动 Planning mutation；
- 自动 semantic rebase；
- 为视觉 mockup 创建第二份业务状态。

---

## 17. 验收

### Planning 通用验收

1. 打开 Planning，能快速看见“继续上次工作 / 当前计划 / 待我确认”。
2. 打开任意 Plan，进入独立 Plan Workspace。
3. 当前状态只显示 canonical objective / accepted / open。
4. Focus 能继续选择 / 使用。
5. 启动或恢复 Session 不破坏原有 subject / baseRevision 语义。
6. pending Proposal 仍需明确人工采纳。
7. 历史与来源仍能访问 source / revision / evolution。
8. 搜索、想法收录、归档等现有关键能力不回退。

### 思考桌面通用验收

1. 思考桌面是 Plan Workspace 的一级 tab。
2. 页面明确区分 canonical / exploration。
3. Design Case 通过通用摘要接口进入，不读取 SBC 专用字段。
4. Design Case 的 base revision 与当前 Planning revision 可比较。
5. drift 有明确文字状态。

### FC27 只作为首个验收 Case

```text
Planning Overview
 -> FC27 Plan
 -> Plan Workspace
 -> 思考桌面
 -> SBC 首个纵切
 -> 打开已完成的 FC27 Design Case
 -> 做本地 exploration
 -> 返回 Planning
 -> canonical state 未变化
 -> Planning revision 改变
 -> 思考桌面显示 drift
```

FC27 通过这条链证明 Planning UI 的通用思考桌面入口可用，但不定义 Planning UI 的业务模型。

---

## 18. Codex 执行要求

先检查当前实现，再写最小 implementation plan，然后实施 **PUI-WP1 / PUI-WP2 / PUI-WP3**。

完成后报告：

1. Planning Overview 如何从现有 Board 投影；
2. Plan Workspace 的导航与组件边界；
3. 四个 tab 各复用了哪些现有事实；
4. “继续推进”如何确定 Plan / Focus / Session；
5. Design Case 的通用连接合同；
6. FC27 Case 只是如何作为首个 adapter 挂载；
7. canonical / exploration state 分别由谁拥有；
8. revision drift 如何计算；
9. 是否修改 Planning core schema；若修改，为什么 UI adapter / `ResourceRef` 不够；
10. 新增和回归测试结果。

如果当前分支里用户所说的 FC27 WP0 / WP1 尚未出现，先报告差异，不要把整个任务改写成“先完成 FC27”。

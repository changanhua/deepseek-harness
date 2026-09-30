# Thinking Desk WP4：Agent 驱动的思考产物闭环

> 日期：2026-09-30  
> 实现基线：`codex/planning-ui-workspace@13f1de5f64c5d40af8902ec30984ae082a6618f6`  
> 当前任务：在已经可显示、可持久探索的思考桌面上，第一次接入真实 LLM / Agent，并完成 **Think → Produce → Review → Commit → Drift** 的最小闭环。  
> 重要：这不是“继续做 FC27 自动化”，也不是再次重构 Planning UI。FC27 只是 WP4 的第一个真实验收 Case。

## 0. 接手位置

用户已经在该分支启动的服务中手工查看过新的 Planning / 思考桌面 UI，确认页面可以显示。

当前分支已经完成的事实，以源码为准：

- Planning Overview 与独立 Plan Workspace 已存在。
- Plan Workspace 已有“当前状态 / 工作与讨论 / 思考桌面 / 历史与来源”四个 tab。
- Design Case 通过 generic summary 从 Planning 页面进入。
- FC27 SBC 是当前第一个 Design Case owner。
- SBC Design Case 已有独立持久化，不写 Planning canonical Board。
- 当前 SBC Case 支持 frozen Planning projection、拖动、选择、移动 undo、reload/restart persistence、`baseRevision` 与 drift。
- 普通 Plan 打开“思考桌面”不会自动创建 SBC Case。
- Planning 已有 `PlanningContextPack`、Plan / Focus / `PlanningSubjectRef`、Session binding + `baseRevision`、`ResourceRef`、`PlanningProposedDelta`、exact Proposal adoption 与 stale-base rejection。
- 当前 Design Case **还没有真实 Agent thinking loop，也没有 durable Design Context / structured Thinking Result / Design Case → Planning Proposal 的产品闭环**。

不要重新实现上述已经存在的 PUI-WP1–3 或 FC27 WP0/WP1。

不要因为当前 master 与此分支不同而自行 merge/rebase/reset。WP4 继续以本分支为实现基线；分支整合是独立任务，除非用户另行要求。

---

## 1. Codex 开始前必须读取的上下文

### 仓库与文档规则

- [根级 AGENTS](../../AGENTS.md)
- [架构](../architecture.md)
- [文档规范](../AGENTS.md)

### Planning 当前合同

- [Planning 子系统](../subsystems/planning.zh.md)
- [Planning / Execution 边界](../../.agents/notes/implemented/architecture/2026-09-27-project-planning-and-execution-boundaries.zh.md)
- [Planning Context 实现](../../packages/planning/planning/src/context.ts)
- [Planning maintenance Skill](../../packages/bundle/personal-planning/skills/planning-maintenance/SKILL.md)

### 当前 UI / Design Case 基线

- [Planning UI 重构产品规格](2026-09-30-planning-ui-object-workspace-redesign.md)
- [Planning UI PUI-WP1–3 实现记录](2026-09-30-planning-ui-implementation.md)
- [FC27 Design Case WP0/WP1 实现记录](2026-09-30-fc27-sbc-design-case-implementation.md)
- [Planning UI 入口](../../packages/client/ui-planning/src/client/index.ts)
- [Planning Design Case Page](../../packages/client/ui-planning/src/client/PlanningDesignCasePage.tsx)
- [当前 SBC Design Case UI](../../packages/client/ui-planning/src/client/SbcDesignCase.tsx)
- [Planning Runtime Controller](../../packages/client/ui-planning/src/client/runtime-controller.ts)
- [SBC Case owner / store](../../packages/planning/planning-remote/src/sbc-design-case.ts)
- [Planning Remote](../../packages/planning/planning-remote/src/index.ts)
- [Design Case e2e](../../apps/web/tests/sbc-design-case.e2e.ts)

### Native Session / Agent / preset 能力

- [Session Controller](../../packages/api/session-controller/README.zh.md)
- [Session create contract](../../packages/api/session-controller/src/types.ts)
- [Client Session service](../../packages/api/session-controller/src/client/sessions/service.ts)
- [Client Session manager](../../packages/api/session-controller/src/client/sessions/manager.ts)
- [per-Session Agent preset 决策](../../.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.zh.md)
- [standard preset](../../packages/preset/agent-presets/presets/standard/agent.cordis.yml)

特别注意一个当前代码事实：

- Host 的 `SessionCreateRequest` 已支持可选 `agentPreset`。
- 当前 Client `sessions.create(...)` / manager create wrapper 没有把 `agentPreset` 暴露出来。

如果 WP4 使用专用 Thinking preset，优先做**通用的最小透传扩展**，不要在 Planning UI 中绕过 Client Session 生命周期私自调用一套第二 Session API。

---

## 2. WP4 要证明什么

WP0/WP1 + PUI-WP1–3 已证明：

> DSH 能保存一个与 Planning canonical state 分离的探索空间，并在 Planning 改变时显示 drift。

WP4 必须证明：

> 用户可以从 Design Case 显式触发一个真实 Agent；Agent 基于精确的 Planning + Case 上下文形成结构化候选产物；用户分别决定哪些内容进入探索空间、哪些成为 durable Design Context、哪些进入 Planning Proposal；只有人工采纳 Proposal 后 canonical revision 才变化，随后原 Case 正确进入 drift。

目标链：

```text
Planning canonical state
        +
Design Case exploration
        +
linked resources / prior Design Context
        │
        ▼
用户显式触发 Thinking Agent
        │
        ▼
native DSH Session / Agent
        │
        ▼
Thinking Context Pack
        │
        ▼
structured Thinking Result
   ┌────────────┼──────────────┐
   ▼            ▼              ▼
Exploration   Design Context   Planning Delta Candidate
   │            │              │
用户应用       用户保存         用户提交
   │            │              ▼
   │            │         pending Proposal
   │            │              │
   │            │          human review
   │            │              │
   └────────────┴──────────────▼
                         exact adoption
                               │
                               ▼
                      new canonical revision
                               │
                               ▼
                    existing Design Case drift
```

这条链跑通，才算“思考桌面 MVP”成立。

---

## 3. 不变量

### 3.1 Planning 仍是 canonical truth

Agent 不能直接改 Planning。

Agent 只能产生一个 **Planning Delta Candidate**。

真正进入 Planning 必须：

```text
candidate
→ 用户点击“提交 Planning 提议”
→ pending Proposal
→ 用户查看差异
→ exact adoption
→ canonical revision
```

复用现有 `PlanningProposedDelta` 与 Proposal adoption。

### 3.2 Design Case 仍是 non-canonical exploration

Agent 结果、Design Context、探索笔记持久化，不意味着它们被 Planning 接受。

### 3.3 不直接调用外部 LLM API

WP4 必须复用 DSH 的 native Session / Agent / model runtime。

禁止在 Planning UI、planning-remote 或 Case store 中新写：

```text
fetch(OpenAI/DeepSeek/...)
→ completion
→ parse JSON
```

LLM 运行归 native Agent。

### 3.4 显式用户触发

第一版只允许用户主动开始一次 Thinking Run。

不要：

- 打开页面自动跑模型；
- 每拖一个节点触发模型；
- Planning revision 变化自动跑模型；
- 后台无限自循环；
- Agent 完成后自动采纳任何结果。

### 3.5 Agent 产出候选，不拥有 Apply 权限

Agent 可以提出：

- exploration notes；
- Design Context；
- Planning Delta Candidate。

Agent 不可以：

- 自动应用 exploration；
- 自动保存为“已确认”设计上下文；
- 自动创建或采纳 Planning Proposal；
- 调用 Browser / Delivery 做真实执行。

### 3.6 provenance 必须保留

每次 Thinking Run 至少能回答：

- 哪个 Session / Agent 产生；
- 使用哪个 preset；
- 针对哪个 Design Case；
- 基于哪个 case version；
- Case 自己基于哪个 Planning revision；
- Agent 启动时看到的 current Planning revision；
- 输入问题是什么；
- 哪些 resource/evidence refs 被纳入上下文；
- 结果是什么时候产生。

不保存模型私有思维链；保存输入身份、结构化结果、来源和可验证上下文。

---

## 4. WP4.1 — Thinking Context Pack

不要把整个 Session 历史或 Canvas 像素坐标直接塞给模型。

为一次 Thinking Run 编译一个有界上下文。

建议合同：

```ts
interface ThinkingContextPack {
  run: {
    id: string
    question: string
    sessionId: string
    presetId: string
    createdAt: string
  }

  subject: PlanningSubjectRef

  planning: {
    revisionAtStart: string
    context: PlanningContextPack
  }

  designCase: {
    resource: ResourceRef
    title: string
    caseVersionAtStart: number
    caseBaseRevision: string
    currentRevisionAtStart: string | null
    driftAtStart: boolean

    // 语义摘要，不是完整 UI 像素状态
    selectedNode?: {
      id: string
      title: string
      body?: string
    }

    existingExplorationNotes: readonly ExplorationNote[]
    priorDesignContexts: readonly DesignContextRecord[]
  }

  availableResourceRefs: readonly ResourceRef[]
}
```

实际类型名与字段可按仓库 convention 调整，但数据所有权必须保持。

### Planning 部分

优先复用现有 `buildPlanningContext` / Planning Remote `context`：

- objective
- accepted
- open
- selected Focus
- legacy fields
- opaque ResourceRefs

不要复制另一套 Planning context builder。

### Case 部分

Case owner 提供：

- case identity；
- frozen base revision；
- current case version；
- current selection 的语义信息；
- 已保存 exploration notes；
- 已保存 Design Context；
- current Planning identity 与 drift。

坐标可保留在 Case storage，但默认不进入模型 context，除非以后证明空间位置本身有语义价值。

### 上下文冻结

一次 run 开始后，它看到的 Context Pack 是该 run 的**输入快照**。

Planning 或 Case 后续变化不能静默改变一个已经运行中的 run。

---

## 5. WP4.2 — Native Thinking Agent

### 5.1 UI 入口

在 Design Case 页面增加明确入口，例如：

```text
[与 Agent 思考]
```

点击后出现一个轻量输入：

```text
你想推进什么？

[ 首个可靠纵切应该止在哪里？                  ]

[开始思考]
```

第一版不要复制完整聊天 Composer。

真正对话仍进入 native Session UI。

### 5.2 Thinking Session

“开始思考”必须创建或启动一个普通 DSH Session / Agent，而不是内嵌 completion。

一次 run 持有：

```text
sessionId
Planning subject
Planning revisionAtStart
Design Case resource
caseVersionAtStart
question
```

Planning Session binding 仍复用现有 `bind-session`。

**Planning binding 的 base revision 使用 run 启动时的 current canonical revision，而不是强行使用 Case 的历史 base revision。**

原因：

- Agent 需要知道 Case 可能已经 stale；
- Agent 的 Planning Delta Candidate 应明确基于它真正读取的 current canonical state；
- Case 自己的 `caseBaseRevision` 仍单独保留，用于 drift / 历史解释。

### 5.3 Thinking preset

WP4 首个切片使用一个专用 `thinking-desk` Agent preset。

原因：

- 思考 Agent 不应该顺手拥有 Shell / Browser write / Task Queue / Delivery 等执行能力；
- 它的职责是 read / reason / submit candidate；
- 这也是对 DSH per-Session preset 能力的一次真实使用。

建议 preset 最小化：

- persona / agent-instructions；
- compaction（如当前长对话基础设施要求）；
- `tool-skill` / skill discovery（如需要）；
- 新的 Thinking Case model tools；
- 可选只读检索能力，例如 workspace search / web research，前提是明确无副作用。

默认**不要**带：

- shell；
- browser action；
- task queue；
- Delivery dispatch；
- Planning direct mutation tool；
- 自动执行器。

如果实现中发现现有可用工具没有纯只读文件检索面，不要为了 WP4 给 Thinking Agent 暴露可写 shell；先以 Context Pack 完成 MVP，并把只读研究能力列为后续缺口。

### 5.4 Session create 的 preset 透传

Host 已支持：

```ts
SessionCreateRequest.agentPreset?: string
```

当前 Client create wrapper 未透传。

允许在 WP4 做一个**通用的小改动**：

```ts
sessions.create({
  workspaceId,
  sessionId,
  agentPreset?: string,
})
```

并由 manager 原样传给 existing Remote。

这个改动不应知道“thinking desk”字符串，也不能改变普通 create 默认行为。

### 5.5 kickoff prompt

Session 创建、Planning binding、Thinking Run binding 都持久成功后，才发送 kickoff prompt。

kickoff 文本保持短而稳定，例如：

```text
你正在从 DSH 思考桌面推进一个 Design Case。

用户问题：
<question>

先调用 thinking_context 读取本次 run 已冻结的 Planning + Design Case 上下文。
不要直接修改 Planning，不要执行浏览器、Shell、Delivery 或外部写操作。
形成可审阅结论后，用 thinking_submit_result 提交结构化候选结果。
最终回复只需简要说明提交了哪些候选产物。
```

不要把大段 Context Pack复制进 prompt；上下文通过 tool read。

---

## 6. WP4.3 — Thinking model tools

不要靠解析 Assistant prose 或 JSON code block 来获取正式产物。

增加一个很小的 model-facing Thinking 工具 owner，按 DSH plugin 习惯实现。

工具面第一版只要两个：

### `thinking_context`

无须模型传 case id。

工具从**当前 Agent / Session scope**解析它绑定的 active Thinking Run，只能读自己的 run。

返回有界 `ThinkingContextPack`。

### `thinking_submit_result`

同样从当前 Agent / Session scope解析 run。

模型提交结构化候选：

```ts
interface ThinkingResultDraft {
  summary: string
  findings: readonly string[]
  openQuestions: readonly string[]

  explorationNotes?: readonly {
    title: string
    body?: string
  }[]

  designContext?: {
    title: string
    body: string
  }

  planningDelta?: {
    operations: readonly PlanningDeltaOperation[]
    rationale?: string
  }
}
```

约束：

- `subject`、`baseRevision`、`originRef` 不让模型填写；由 run owner 强制补上。
- Agent 提交的 Planning operations 使用现有 `PlanningDeltaOperation` union。
- 第一版限制数量与字符串字节数；拒绝无界输出。
- 如 operation 引用 state entry / Focus / resource identity，按 run 的 PlanningContext 与允许引用校验。
- evidence refs 只能来自 run 已允许的 ResourceRefs / evidence set，不接受模型伪造外部引用。
- 同一 run 重复提交使用明确 version / request-id / CAS 语义，不能悄悄覆盖用户已审阅的 result。
- tool submission 只保存 candidate，不调用 `planning.execute`。

### ownership

不要把 Thinking 工具塞进 `tool-planning` 当作 Planning canonical 功能。

推荐增加窄的 model-tool package（命名可按现有 package taxonomy 调整），依赖一个 Case/Thinking owner service。

当前只有 SBC Case 一个真实 owner，因此可以由现有 Case owner 暴露一个窄 Host service 给 model tool 使用；不要为了一个 consumer 先建设完整通用 Thinking Platform。

但工具、run/result 类型尽量使用中性的 `thinking` / `design-case` 名称，避免把 Agent 合同写成 `SbcThinkingResult`。

---

## 7. WP4.4 — Durable Thinking Run / Result

在 Design Case owner 侧增加有界持久记录。

建议最小记录：

```ts
interface ThinkingRunRecord {
  id: string
  sessionId: string
  presetId: string
  question: string
  createdAt: string

  subject: PlanningSubjectRef
  planningRevisionAtStart: string

  caseResource: ResourceRef
  caseVersionAtStart: number
  caseBaseRevision: string

  context: ThinkingContextPack

  result?: ThinkingResultRecord
}

interface ThinkingResultRecord {
  id: string
  version: number
  createdAt: string
  draft: ThinkingResultDraft

  applied: {
    explorationNoteIds: readonly string[]
    designContextId?: string
    planningProposalId?: string
  }
}
```

可按现有 store 结构拆表或内嵌，但：

- 记录必须有容量 / byte limit；
- per-record storage 继续 path-safe；
- 写入有 CAS / idempotency；
- restart 后 run/result 仍可读；
- 不能把完整 Session transcript 复制进 Case storage。

---

## 8. WP4.5 — Exploration Notes：让 Agent 对桌面产生最小可见影响

当前 `13f1` 的 Case 只有 frozen canonical nodes + 位置 / selection / move undo，没有通用 semantic graph。

WP4 不要顺手造完整 graph ontology。

第一版只增加一种 Case-owned exploratory artifact：

```ts
interface ExplorationNote {
  id: string
  title: string
  body?: string
  sourceResultId: string
  createdAt: string
  position: { x: number; y: number }
}
```

用户在 Thinking Result 中选择“应用到思考桌面”后，才把对应 note 写进 Case。

UI：

- note 渲染为与 canonical projection 明显不同的 exploratory card；
- 可选中；
- 可拖动；
- 可删除 / discard；
- 继续使用 Case 自己的 persistence；
- 不进入 Planning；
- 不因“应用到思考桌面”而创建 Proposal。

第一版不要求：

- 通用 relation ontology；
- branch / ghost；
- 自动 grouping；
- AI 直接控制坐标；
- semantic auto-layout。

坐标由 UI 为新 note 选择一个安全默认位置，Agent 不填写坐标。

---

## 9. WP4.6 — Durable Design Context

Design Context 是 WP4 的关键产物，不是普通聊天摘要。

它回答：

> 为什么这样设计？

最小记录：

```ts
interface DesignContextRecord {
  id: string
  title: string
  body: string
  sourceRunId: string
  sourceSessionId: string
  caseVersionAtCreation: number
  planningRevisionAtCreation: string
  createdAt: string
}
```

用户点击：

```text
[保存设计上下文]
```

后才成为 durable record。

要求：

- 保存动作与 Agent result submission 分离；
- 可在思考桌面查看；
- 下一次 `ThinkingContextPack` 自动带入已保存的近期 Design Context；
- 不进入 Planning canonical state；
- 不自动写 Project Memory / Knowledge；
- 后续可再设计 promotion 到 Memory / Knowledge，本轮不做。

这一点用于验证“过去的思考能否对下一次 Agent 产生正向复用”。

---

## 10. WP4.7 — Planning Delta Candidate → Proposal

Thinking Result 的 `planningDelta` 只是 candidate。

思考桌面 UI 显示：

```text
Planning 提议

+ accepted: 首个可靠纵切以“真实方案 + 人工确认”为完成边界
+ open: 自动购买未知交易恢复机制

[提交 Planning 提议]
```

### 用户点击后

使用现有 Planning Proposal 机制创建 pending Proposal。

强制填充：

```text
subject        = run.subject
baseRevision   = run.planningRevisionAtStart
originRef      = Design Case ResourceRef
evidenceRefs   = run 中已允许的 refs
operations     = Agent candidate
```

保持现有 Proposal draft / generation 合同所需字段，复用当前 canonical revision，不自行发明另一种 Proposal store。

### stale

当用户准备“提交 Planning 提议”时，如果：

```text
current Planning head != run.planningRevisionAtStart
```

第一版不要自动 rebase Agent 的 delta。

UI 明确显示：

```text
这个候选基于旧 Planning revision。
当前正式状态已经改变。
```

允许：

- 保留 Thinking Result；
- 保存 Design Context；
- 重新启动一次基于当前 revision 的 Thinking Run。

默认不把 stale candidate 重写到新 revision。

### adoption

Proposal 创建后：

- 进入当前“待我确认”；
- 用户检查 diff；
- 用户 exact adoption；
- canonical revision 前进；
- Design Case 本身仍保持原 base；
- 返回 Case 后显示已有 drift。

不要在 Thinking Desk 内复制一套 adoption UI，除非只是导航到现有 Proposal review。

---

## 11. UI 设计

### Design Case 主界面

建议布局：

```text
┌────────────────────────────────────────────────────────┐
│ SBC 首个纵切                     [与 Agent 思考]        │
│ Planning: r14     Case base: r12     Exploration v7    │
│ ⚠ Planning 已变化                                    │
├────────────────────────────────────────────────────────┤
│                                                        │
│                 Design Case canvas                     │
│                                                        │
├────────────────────────────────────────────────────────┤
│ Agent 思考结果                                         │
│                                                        │
│ 最近一次：首个可靠纵切应该止在哪里？                 │
│                                                        │
│ 结论                                                   │
│ ...                                                    │
│                                                        │
│ 探索建议                [应用到思考桌面]              │
│ 设计上下文              [保存设计上下文]              │
│ Planning 变更           [提交 Planning 提议]           │
└────────────────────────────────────────────────────────┘
```

### 启动 Agent

```text
与 Agent 思考

你想推进什么？
[                                                   ]

本次上下文
✓ 当前 Planning
✓ 当前 Design Case
✓ 当前选择
✓ 已保存 Design Context
✓ 关联 ResourceRefs

Preset: Thinking Desk

[开始思考]
```

模型选择第一版沿用 native Session 当前默认 model route；不要在 WP4 额外造一套模型选择 UI。用户进入 Session 后仍使用原生 Session 的模型能力。

---

## 12. 失败与并发

### Session 创建 / binding / prompt 是多步事务，不是假装原子

建议顺序：

1. 预分配 `sessionId` / `runId`。
2. native Session create（thinking-desk preset）。
3. Planning `bind-session` 到 run 启动时 current revision。
4. Case owner 创建 run binding / frozen context。
5. 取得 native Session client face。
6. 发送 kickoff prompt。
7. 打开 Session。

失败时：

- 已创建 Session 不伪装成不存在；
- Planning binding 已成功则保留；
- run 若尚未 prompt，可标 `pending/retryable`；
- 使用相同 request identity 重试同一步，而不是重复创建 Session；
- 不因为最后一步失败就删除 canonical provenance。

沿用当前 Planning Session start 的 idempotency / conflict 思路。

### Case 变化

Agent 基于 case version N 思考期间，用户可能把 Case 改成 N+1。

`thinking_submit_result` 不应覆盖 Case。

Result 保留：

```text
basedOnCaseVersion = N
currentCaseVersion = N+1
```

UI显示 stale result。

用户仍可阅读 / 保存 Design Context；应用 exploration 或提交 Planning delta 前必须明确提示其输入已旧。

第一版不自动 semantic merge。

### Planning 变化

同理，run 的 `planningRevisionAtStart` 固定。

---

## 13. Thinking Agent preset 的安全边界

首个 `thinking-desk` preset 是“认知工作 preset”，不是执行 preset。

它至少要做到：

- 能调用 Thinking context/result tools；
- 能正常使用模型；
- 能使用 Skill catalog（若组合需要）；
- 可选加入明确只读研究工具。

它不能默认获得能造成外部副作用的能力。

如果 DSH 当前 tooling 无法在不暴露写工具的情况下提供代码阅读，那么：

1. WP4 MVP 先只使用 Context Pack；
2. 把“read-only repository research capability”记录为后续 enhancement；
3. 不为了方便把 standard 全工具 preset 当作安全等价物。

---

## 14. FC27 作为第一个验收 Case

不要继续实现真实购买 / 填阵 / Submit。

WP4 验收问题可以使用：

> “首个可靠纵切应该止在哪里？结合当前 Planning 状态、Design Case 与已有上下文，给出可审阅的探索建议、设计理由和正式 Planning 变更候选。”

期望 Agent 至少产生：

### exploration candidate

例如：

- “完整库存证明”
- “真实 solver 方案”
- “人工确认边界”
- “自动购买留到后续”

具体内容由模型根据实际 Context 得出，测试不能把这些业务结论写死成模型必须回答的唯一答案。

### Design Context

表达为什么把某些能力放在首个纵切内 / 外。

### Planning Delta Candidate

例如增加 / 修改 accepted 或 open state entry。

自动测试应验证结构与权限边界，不验证某一段自然语言结论必须固定。

---

## 15. 真正的 WP4 纵切验收

### A. Agent 真的运行

```text
FC27 Plan
→ 思考桌面
→ SBC Design Case
→ 与 Agent 思考
→ 输入问题
→ native Session created with thinking-desk preset
→ Session has Planning binding
→ Thinking Run binds exact Case version
→ Agent calls thinking_context
→ Agent calls thinking_submit_result
```

必须有真实 Session / tool call evidence；不能用 fixture 直接塞 Result 冒充模型链路。

CI 可以保留 deterministic fake/model replay，但至少提供一个 opt-in live-agent acceptance 路径，与当前 Planning live-agent test 的分层方式一致。

### B. Agent 完成前 canonical 未变化

Agent thinking 和 `thinking_submit_result` 后：

```text
Planning head revision unchanged
pending Proposal count unchanged
Delivery unchanged
Browser unchanged
```

### C. 三种产物独立应用

1. Apply exploration note：
   - Case version 前进；
   - note 出现在桌面；
   - Planning 不变。

2. Save Design Context：
   - durable context 可重启读取；
   - Planning 不变。

3. Submit Planning Proposal：
   - 生成 pending Proposal；
   - canonical head 仍不变。

### D. 人工采纳

从现有“待我确认”进入 Proposal review：

```text
pending Proposal
→ human exact adoption
→ Planning head revision changes
```

### E. drift

回到旧 Case：

```text
caseBaseRevision != current Planning head
→ visible drift
```

探索 note 与 Design Context 仍存在。

### F. 飞轮验证

再次从同一个 Case 启动第二次 Thinking Run：

`thinking_context` 必须能看到第一次用户保存的 Design Context。

这条是 WP4 的重要成功条件。

---

## 16. 测试层次

### Unit / domain

覆盖：

- ThinkingContextPack 有界构建；
- Session → run scope 解析；
- 其它 Session 不能读取 / 提交该 run；
- Result schema limits；
- idempotent submit / CAS conflict；
- stale case version；
- stale Planning revision；
- Design Context persistence；
- exploration note apply；
- restart persistence；
- capacity / byte limits。

### Client

覆盖：

- Agent trigger UI；
- pending / error / retry；
- result 三个独立 action；
- stale result copy；
- 不把 Agent candidate 渲染成 canonical；
- 返回 Session / Planning / Case 后状态保持。

### Session preset

覆盖：

- `agentPreset` Client create 透传不改变旧调用；
- thinking-desk Session 的 header / list projection 保留 preset identity；
- preset 不暴露被明确排除的执行工具。

### Composed Web

至少覆盖：

```text
Plan → Case → start thinking Session
→ result candidate
→ return Case
→ apply note
→ save context
→ create Proposal
→ adopt Proposal
→ drift
→ second run sees saved Design Context
```

真实 LLM 路径设置显式环境变量后运行；默认 CI 使用 deterministic harness，不把外部模型可用性混进普通测试。

---

## 17. 建议实现单元

文件名不是强制，但 ownership 建议：

### Existing Design Case owner

扩展：

- `packages/planning/planning-remote/src/sbc-design-case.ts`
- `packages/planning/planning-remote/src/types.ts`

拥有：

- run/result persistence；
- exploration notes；
- Design Context；
- Case → Thinking context projection；
- Session/run binding。

如果继续增大到明显不适合 Remote 包，再提取小 owner package；不要在开始 WP4 前预先大重构。

### Model tools

新增窄包，例如：

```text
packages/planning/tool-thinking-case/
```

拥有：

- `thinking_context`
- `thinking_submit_result`
- 当前 Agent/session scope 授权

不要拥有 Planning mutation。

### Preset

增加 `thinking-desk` preset，遵循现有 agent-presets 组装规则。

### Session Client

仅做通用 `agentPreset?: string` create 透传。

### UI

扩展当前：

- `PlanningDesignCasePage.tsx`
- `SbcDesignCase.tsx`
- controller / contract / locale / CSS

可拆：

```text
ThinkingLauncher
ThinkingResultPanel
DesignContextList
```

不要把 Agent Session UI 自己重写进 Planning。

---

## 18. 明确非目标

WP4 不做：

- FC27 实际购买；
- FC27 自动填阵；
- FC27 自动 Submit；
- Browser execution；
- 完整通用 graph editor；
- relation ontology；
- branch / ghost / compare；
- 自动 Agent 循环；
- 打开页面自动调用模型；
- 自动 semantic rebase；
- 自动 Planning adoption；
- Project Memory / Knowledge promotion；
- 第二套聊天 UI；
- 第二套模型 runtime；
- 把 Session transcript 复制进 Case storage；
- 把 Thinking output 写成 Planning canonical 字段；
- 为未来第二个 Case 提前建设完整 case registry / Thinking Platform。

---

## 19. 实现顺序

### WP4.1 — Context + persistence contracts

先实现：

- ThinkingContextPack
- ThinkingRun / Result
- ExplorationNote
- DesignContext
- run/session scope
- tests

此阶段不需要真实模型。

### WP4.2 — Thinking model tools + preset

实现：

- `thinking_context`
- `thinking_submit_result`
- thinking-desk preset
- Session create preset passthrough

先用 deterministic Agent / tool tests 验证。

### WP4.3 — UI Agent trigger + Result review

实现：

- 与 Agent 思考；
- question；
- native Session create + binding + kickoff；
- Result panel；
- Apply exploration；
- Save Design Context。

### WP4.4 — Planning Proposal bridge

实现：

- candidate → existing Planning Proposal；
- stale blocking；
- navigation to existing review；
- adoption 后 drift；
- second-run Context flywheel。

---

## 20. Codex 完成后必须报告

不要只写 “implemented”。

必须回答：

1. Thinking Agent 是如何通过 native Session 启动的。
2. 是否创建了专用 preset；它实际有哪些工具。
3. 是否改了 Session create；为什么这是通用透传而非 Planning hack。
4. `ThinkingContextPack` 的真实字段和大小上限。
5. Agent 如何被限制只能读取 / 提交自己的 run。
6. Thinking Result 存在哪里。
7. Exploration Note 与 Design Context 分别存在哪里。
8. Agent 为什么无法直接改 Planning。
9. Planning Proposal 是由哪个用户动作创建的。
10. Proposal 的 `subject/baseRevision/origin/evidence` 如何强制生成。
11. Planning / Case stale 时分别怎样处理。
12. 哪些测试证明“Agent 运行了，但 canonical 未变化”。
13. 哪个测试证明人工 adoption 后 Case drift。
14. 哪个测试证明第二次 Agent 能继承第一次保存的 Design Context。
15. 是否触碰 FC27 浏览器执行；正确结果应该是“没有”。

如果实现中发现现有 Session / preset / tool scope 机制与本文某个具体 API 名不同，使用仓库真实 seam；不要为了匹配文档另造平行 runtime。数据所有权、显式触发、候选与 canonical 分离、人工 Proposal adoption 这些不变量优先。

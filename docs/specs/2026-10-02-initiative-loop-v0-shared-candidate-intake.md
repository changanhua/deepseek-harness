# Initiative Loop v0 — Shared Candidate Intake

- 日期：2026-10-02
- 状态：待实现规格；尚未实现
- 范围：只实现 v0 的共享 Candidate Intake、受限调查记录、RIR 连接与显式 Planning promotion。不要顺手实现自动 Planning、自动 Delivery、自动冷启动或通用 Governance Plane。

## 0. 任务目标

为 DSH 增加一个最小 **Initiative Loop v0**，使“下一步值得做什么”不再只能从用户脑中产生。

v0 必须同时支持：

1. 用户提出候选；
2. Agent 主动提出候选；
3. 两类候选进入同一个 durable Candidate 合同；
4. Agent 在现有权限内自主降低不确定性并补充证据；
5. Candidate 可以交给 Requirement Investment Review（RIR）评估；
6. 只有显式人类 promotion 才能把 Candidate 转成 Planning Proposal；
7. Candidate 本身永远不产生执行权限。

目标不是建立一个新的自治“大脑”，而是证明以下最小飞轮成立：

```text
Human ───┐
         ├─→ Candidate → Investigation → RIR → human promotion → Planning Proposal
Agent ───┘
```

后续 `Planning → Delivery → Queue → Eval → Outcome → new Candidate` 属于更大闭环，不在本工作包自动接通。

## 1. Authority 与必须先读的当前事实

实现前按仓库 authority hierarchy 工作，并至少读取：

- [根级 AGENTS](../../AGENTS.md)
- [架构](../architecture.md)
- [Planning 子系统](../subsystems/planning.md)
- [RIR-WP1 规格](2026-10-01-requirement-investment-review-wp1.md)
- [DSH System Gap Audit](../audits/2026-10-01-dsh-system-gap-audit.zh.md)
- [Initiative Loop 提案决策记录](../../.agents/notes/proposed/feature/2026-10-02-initiative-loop-v0-shared-candidate-intake.zh.md)
- 与 Session、Tool、Command、Storage Domain、Planning Proposal、RIR、身份和 plugin composition 相关的实际 source 与 package README

本规格设计基线为 `master@a977e66735f6074220979d408aed918270cca269`。实现前必须重新检查当前 master；若 source、RIR 实现状态或 Planning contract 已变化，以当前更高 authority 为准，并在实现 PR 中报告偏差。不要为了适配变化扩大到下一阶段自治功能。

## 2. 核心边界

### 2.1 Candidate 是 initiative hypothesis，不是 backlog

Candidate 表示：

> 某个 Human 或 Agent 认为“这里可能值得进一步调查、实验、简化、删除或建设”。

它不是：

```text
Candidate != Planning Item
Candidate != Planning Proposal
Candidate != RIR Assessment
Candidate != Delivery Contract
Candidate != Queue Work
Candidate != execution authority
```

Candidate 可以非常早、非常不完整。系统必须允许廉价候选出生，也必须允许大量候选在进入 Planning 之前被 defer / drop。

### 2.2 Initiative Loop v0 不是新的 Governance Plane

v0 不拥有：

- Agent loop；
- scheduler；
- Goal continuation；
- Budget；
- Eval；
- Planning canonical state；
- Delivery；
- side-effect execution；
- Knowledge / Memory；
- 通用 event store 或 Artifact store。

它只拥有 Candidate、Candidate revision / investigation facts、candidate-to-assessment / promotion relation，以及对应的 provenance。

[#40](https://github.com/changanhua/deepseek-harness/issues/40) 继续负责 `Trusted Eval → Budget → Authorized Activation` 的 verified autonomy runtime foundation；本规格不替代或重排该路线。

### 2.3 Initiative 不产生 authority

最重要的不变量：

> **initiative != authority**

Agent 因为发现了问题、提出了 Candidate、补齐了证据或得到了 RIR 的 BUILD / BUILD_CORE 结论，都不能因此获得新的 Tool、Budget、Approval、Planning mutation、Delivery dispatch、merge、push、publish 或外部副作用权限。

任何调查动作仍受执行它的 Session / Agent 当前可见能力与现有 Guard / Approval / SSP / future Budget 约束。

## 3. Candidate 领域对象

最终类型名可以按仓库命名规则调整，但语义必须保留。

建议概念模型：

```text
InitiativeCandidate
├─ id
├─ workspaceId
├─ kind
├─ proposer
├─ trigger
├─ origin
├─ headVersion
├─ status
├─ createdAt
└─ lineage

CandidateRevision
├─ version
├─ claim
├─ assumptions[]
├─ uncertainties[]
├─ evidenceRefs[]
├─ counterEvidenceRefs[]
├─ suggestedNextStep?
├─ createdBy
└─ createdAt
```

### 3.1 Candidate kind

v0 固定以下 kind：

```text
problem
opportunity
improvement
experiment
simplify
remove
```

`remove` 与 `simplify` 必须是一等类型，避免系统把“发现问题”机械映射成“增加功能”。

不要在 v0 引入复杂分类树。

### 3.2 Proposer

v0 只要求两类 proposer：

```text
human
agent
```

两类 proposer 使用同一 Candidate schema，但身份由 Host / runtime 从可信调用上下文导出，不能由 Tool 参数自行声称。

Human candidate 至少保留可验证的人类入口 identity；若来自 Session 中的用户消息，保留 exact Session event ref。

Agent candidate 至少保留 Agent / Session 的稳定身份，以及能够重建“为什么这个 Agent 在这里提出候选”的 source ref。不要伪造当前 runtime 无法可靠取得的 model / turn / request id。

### 3.3 Trigger 与 origin

`trigger` 是简短、可读的“为什么现在提出”。

`origin` / source refs 记录候选由什么事实触发，例如：

- Session observation；
- Eval finding；
- Planning review；
- Browser / Queue failure；
- repeated manual work；
- upstream change；
- 用户直接想法。

v0 不自动扫描这些来源。它只要求 Candidate 能引用它们。

### 3.4 Lineage

Candidate 必须支持父 Candidate / prior Candidate 引用，使后续可以表达：

```text
Candidate A
  → experiment
  → outcome
  → Candidate B
```

Lineage 是因果追踪，不是自动继承 authority、status 或 evidence truth。

## 4. Immutable origin 与 revision

Candidate 创建后的 origin、proposer、createdAt 不得被原地改写。

调查过程中可以 refine claim、增加 assumptions / uncertainties / evidence，但必须形成新 revision 或等价的 append-only durable fact，不能覆盖旧判断后假装候选从一开始就是现在的说法。

至少满足：

- old revision 可读；
- `headVersion` 可 CAS；
- stale write 明确 conflict；
- 同一 idempotency key + 相同 payload 返回同一结果；
- 同一 key + 不同 payload 明确冲突；
- reload / Host restart 后 revision、status、relation 不丢失。

实现可以复用 Storage Domain；不要建第二 Session log。

## 5. Candidate lifecycle

v0 只支持以下 lifecycle：

```text
PROPOSED
   ├─→ DEFERRED / DROPPED（Human）
   └─→ INVESTIGATING
          ├─→ DEFERRED / DROPPED（Human）
          └─→ ASSESSABLE
                 ├─→ DEFERRED / DROPPED（Human）
                 └─→ PROMOTED（Human）
```

Human 可以在提出后或调查中直接 defer / drop，无需先把 Candidate 标为 `ASSESSABLE`。允许 Human 显式执行 `DEFERRED → INVESTIGATING` reopen；Agent 只记录 disposition recommendation。

不得支持：

```text
PROPOSED → automatic Planning
ASSESSABLE → automatic Delivery
RIR route → automatic state transition
```

### 5.1 权限矩阵

Human 可以：

- propose；
- 请求 / 结束 investigation；
- defer；
- drop；
- reopen；
- 显式 promote。

Agent 可以：

- propose；
- 在当前 Session / Agent 权限内调查；
- append evidence / counter-evidence；
- refine claim；
- mark assessable；
- 给出 `recommendDisposition`。

Agent 在 v0 不能执行最终 `promote`。对于 human-created Candidate，Agent 也不能用 `drop` / `defer` 覆盖用户决定；只能提出 recommendation。

未来是否扩大 Agent disposition 权限属于 Autonomy Policy 的后续工作，不在 v0。

## 6. Evidence 与 provenance

Candidate owner 不存通用 artifact bytes，也不成为所有 evidence 的 canonical owner。

Evidence ref 必须满足：

- 指向原 owner；
- 支持稳定 identity；
- 能记录 revision / digest 时记录真实值；
- 不能取得或验证时明确 `unverified` / `unknown`；
- 摘录不能冒充完整原文；
- secret、credential、原始 provider payload 不复制进 Candidate。

优先复用现有 owner-neutral reference contract；若当前没有合适合同，只定义 Candidate 所需的最小 opaque locator，不得借机抽取通用 Artifact / Provenance Platform。

`evidenceRefs` 支持 claim 的依据；`counterEvidenceRefs` 保存反证。两者都必须能被 RIR 或 reviewer 区分，避免 Candidate 只积累单向支持材料。

## 7. Investigation

### 7.1 Candidate owner 不执行调查

Initiative service 不启动第二 Agent，不直接调用模型，不拥有 Tool execution，也不自己运行 GitHub / Browser / shell。

调查由现有 Agent / Session / Tool / Workflow owner 执行。

Initiative 只记录：

- 谁在调查；
- 针对哪个 Candidate revision；
- 调查时的 scoped Session / Agent reference；
- 新证据 / 反证；
- unresolved unknowns；
- refined claim；
- recommendation；
- investigation 是否完成。

### 7.2 Bounded investigation

v0 的“自主调查”含义是：

> Agent 在已经拥有的能力和当前运行预算内，优先通过只读、可逆、低副作用动作降低 Candidate 的不确定性，而不是立即升级给用户。

Candidate 不授予额外权限。

如果调查需要：

- 新 credential；
- 外部写操作；
- 付费高成本调用；
- architecture invariant 修改；
- Planning canonical mutation；
- Delivery / Queue dispatch；
- merge / push / publish；
- destructive action；

则必须走对应 owner 的现有审批 / authority。Initiative 只记录 blocked reason，不绕过这些 owner。

在 #43 Budget 未实现前，不为 Candidate 单独造 usage ledger；沿用现有 Session / Goal / Workflow 限制，并在无法证明预算边界时不启动 unattended investigation。

### 7.3 不确定性优先

Agent 在调查阶段默认回答：

1. 这个 Candidate 是否已经由现有 owner 解决？
2. 是否只是 stale docs / stale assumption？
3. 是否有至少一个真实 evidence？
4. 有没有反例？
5. 能否通过 cheap probe 减少关键未知？
6. 是否存在 no-build / simplify / remove 方案？

不要把调查变成“为原 Candidate 找理由”。

## 8. RIR Bridge

RIR 继续拥有 Investment Assessment；Initiative 不复制八维、Stress Tests、Allocation 或 route。

Candidate 达到 `ASSESSABLE` 后，可以显式创建 RIR Assessment。

首选关系：

```text
Candidate id + exact candidate version
       ↓
RIR Assessment
```

RIR 使用固定 Candidate revision 作为 subject input；Candidate 后续变化只显示 drift，不重写旧 Assessment。

如果 RIR-WP1 实现时已经提供 extensible subject ref，则增加最窄的 `initiative-candidate` subject adapter。

如果 RIR 尚未实现，不得在 Initiative 内造简化版评分器或 mock assessment。Candidate core 可以独立落地，但 RIR vertical 保持 blocked / unverified，直到真实 RIR owner 可用。

RIR route 仍只是建议：

```text
MODEL_ONLY
EXPERIMENT
BUILD_CORE
BUILD
DEFER
```

route 不自动改变 Candidate status，不自动 Planning promotion。

## 9. Planning Promotion

Candidate 与 Planning 的唯一 v0 写连接是**显式人类 promotion**。

Promotion 输入至少固定：

- candidate id；
- exact candidate version；
- selected RIR assessment ref（若有）；
- human rationale；
- idempotency key。

Promotion 结果只允许：

> 创建一个 Planning Proposal 或等价的 non-canonical Planning input。

它不得：

- 自动 accept Proposal；
- 直接创建 / 修改 canonical Planning Item；
- 自动生成 Delivery；
- dispatch Queue；
- 修改 Goal。

Planning 继续拥有 proposal acceptance、canonical revision、priority、dependency、review 与 Delivery handoff。

如果当前 Planning API 不能以不改变 canonical state 的方式承载该 promotion，先报告具体 contract gap；不得通过 `add-resource-link`、`workspace-change` 或其他 mutation 绕过边界。

Promotion 成功后，Candidate 记录稳定 Planning Proposal ref 并进入 `PROMOTED`。Planning Proposal 后续被 dismiss / accepted 不反向改写历史 Candidate；后续 outcome 可以产生新的 Candidate。

## 10. Human 与 Agent 两个真实入口

v0 必须有两个不同 authority 的真实入口，最终调用同一个 Candidate service。

### 10.1 Human entry

优先使用现有 human command seam（`ctx.commands`）或当前产品中等价的 Host-trusted human action。

Human entry 必须：

- actor 来自 trusted command / Host context；
- 支持最小 `kind + claim + trigger/source`；
- 创建 Candidate 后返回稳定 id；
- 不经过模型就能创建一条 Candidate。

不要为了 v0 建大而全 Candidate Dashboard。

### 10.2 Agent entry

提供 scoped model-facing Tool 或等价已有 Tool seam。

Agent entry 必须：

- actor identity 来自当前 Agent scope；
- 不能通过参数伪造 human；
- 可以创建 Candidate 与 append investigation；
- 不暴露 promote / Planning mutation；
- candidate creation 本身不能扩大该 Agent 可见 Tool。

## 11. Suggested service ownership

具体 package 名按实现时仓库结构调整，但职责建议拆为：

```text
initiative
  Service Definition / schemas / lifecycle contract

initiative-local
  durable local provider / CAS / query / restart

tool-initiative
  scoped Agent propose / investigate / read operations

initiative-command
  trusted Human propose / disposition / promote operations

initiative-rir-bridge
  Candidate snapshot → RIR subject / assessment relation

initiative-planning-bridge
  human promotion → Planning Proposal
```

以上是职责边界，不要求各占一个 package。实际包数量按当前消费者、可替换性和生命周期确定，优先复用现有组合。Candidate 保持自己的 canonical owner，不得把所有职责塞进 Planning 或 RIR owner。

v0 不要求独立 Web 页面。若实现者增加只读列表或轻入口，必须保持 consumer 角色且不能扩大权限。

## 12. Query / projection

至少支持：

- get Candidate by id；
- list by status / proposer kind；
- read exact revision；
- list investigations；
- list linked RIR assessments；
- read promotion relation；
- distinguish unavailable / stale / unknown refs。

查询输出必须明确哪些字段是 Candidate owner 的事实、哪些是外部 ref、哪些是 Agent recommendation。

## 13. 两条必须跑通的真实 vertical

### Case A — Human candidate

使用真实 Human entry 创建一个 Candidate，例如：

> “DSH 的 pinned audit 很快历史化，是否需要更轻的 current-state delta 机制？”

要求：

1. proposer = human；
2. origin 指向真实用户输入或 Human command；
3. Agent 在现有权限内调查 current master / audit baseline；
4. 同时记录支持证据与反证（例如 Audit 本身已经声明是 snapshot）；
5. Candidate 被 refine 后进入 `ASSESSABLE`；
6. 使用真实 RIR（若其 owner 已实现）创建 Assessment；
7. 未经人类 promotion，Planning 不变化。

随后必须通过真实 Human entry 跑通正向晋升：

1. Human 读取并选择 exact Candidate revision，提供 rationale，显式执行 promotion；若选择 RIR Assessment，同时保留其固定基线与 drift 信息；
2. 从 Planning 读取新建 Proposal，确认其为 pending，且可以追溯 Candidate id 与 exact version；
3. 独立读取 Candidate，确认状态为 `PROMOTED`，并保存稳定的 Planning Proposal ref；
4. Host restart 后重新读取两侧关系，以同一 idempotency key 重试该 promotion，确认返回原结果且未重复创建 Proposal；
5. 确认没有自动 accept Proposal、修改 canonical Planning Item 或 dispatch Delivery / Queue。

保留真实 Human entry 的调用、两侧 owner 的读取结果和重启后的重试证据。只直接调用底层 service 的测试不能代替该入口验收。RIR 尚不可用时，按第 8 节将 RIR vertical 标为 blocked / unverified；不带 Assessment 的显式 Human promotion 仍须完成上述验证。

该案例不预设最终应 BUILD / DEFER / MODEL_ONLY。

### Case B — Agent candidate

让 Agent 从一个真实、可追溯的 Session / Eval / failure observation 主动提出 Candidate。

要求：

1. proposer = agent；
2. 提案不依赖用户先说“请创建 Candidate”；
3. trigger 与 source ref 能解释为什么产生；
4. Agent 自主做 bounded investigation；
5. 可以因证据不足、重复已有能力或 no-build 更优而建议 drop / defer；
6. Agent 无法自行 promote；
7. Host restart 后 Candidate、revision、investigation、refs 可恢复。

如果当前 runtime 没有 unattended / cold initiative trigger，本案例允许在一个 live Agent Session 内主动提出；不要为了满足“主动”顺手实现 #42 Activation。

## 14. 自动化验收

至少覆盖：

- Human / Agent 创建走同一 durable Candidate contract；
- Tool 参数不能伪造 Human actor；
- Candidate immutable origin；
- revision CAS / stale conflict；
- idempotent create / update；
- restart recovery；
- evidence 与 counter-evidence 分离；
- parent lineage；
- legal / illegal lifecycle transition，包括 Human 从 `PROPOSED` / `INVESTIGATING` 直接 defer / drop，以及 Agent 只能记录 recommendation；
- Agent 无 promote 权限；
- Human promotion 只创建 non-canonical Planning Proposal；
- promotion 不 accept Planning Proposal；
- Candidate / RIR 操作不 dispatch Delivery / Queue；
- RIR route 不自动改变 Candidate；
- Candidate 调查不授予额外 Tool / Credential / Budget；
- unresolved external ref 显示 unknown / unavailable；
- exact Candidate version 进入 RIR，后续 Candidate revision 显示 drift；
- repeated promotion 使用同一 idempotency key 不重复创建 Planning Proposal。

## 15. 必须证明的负面边界

实现完成时必须用测试或可复现 evidence 证明：

```text
Agent proposes candidate
→ does NOT gain new authority

Agent recommends BUILD
→ does NOT mutate Planning

RIR returns BUILD
→ does NOT mutate Planning

Human promotes
→ creates Planning Proposal only

Planning Proposal exists
→ does NOT dispatch Delivery

Candidate investigation blocked by owner policy
→ remains blocked / records reason
→ does NOT bypass through Initiative
```

## 16. 明确非目标

Initiative Loop v0 不做：

- 自动扫描所有 Session / Issue / PR / Eval；
- 后台常驻 Candidate miner；
- 自动冷启动 Agent；
- 自动 Planning mutation；
- 自动 Proposal acceptance；
- 自动 Delivery / Queue dispatch；
- 自动 merge / push / publish；
- 新 Budget / Approval / Policy engine；
- Portfolio 排序；
- Candidate 总分；
- proposer reputation / calibration；
- realized outcome learning；
- automatic `Outcome → Candidate` bridge；
- generic Governance / Constitution / Experience Plane；
- 通用 Artifact / Event / Provenance Store；
- Agent 自主删除 Human Candidate；
- 给 Candidate 专门分配新 credential；
- 为满足本规格推进 #40 / #42 / #43 / #49 的实现。

这些能力可以在 v0 有真实使用证据后重新评估。

## 17. Codex 实现前必须回答的问题

编码前在实现 PR 或工作记录中先回答：

1. 当前 Planning Proposal 是否能在不改变 canonical Board / Plan revision 的情况下创建？具体 API 是什么？
2. 当前 RIR 是否已实现？若未实现，v0 哪部分可以独立完成，哪些验收保持 blocked？
3. Human command 的 trusted actor identity 从哪里取得？
4. Agent Tool 如何从 scoped context 取得 agent / session identity，且无法伪造 Human？
5. Candidate 的 canonical owner 与 Storage Domain 名称是什么？
6. Candidate revision / status transition 如何实现 CAS 与 idempotency？
7. evidence ref 复用哪个当前合同；若没有，为什么必须定义最小新 locator？
8. investigation 如何证明没有创建第二 Agent runtime 或扩大 Tool visibility？
9. RIR 使用哪个 exact Candidate version，drift 如何展示？
10. human promotion 如何保证只到 Planning Proposal 而不是 canonical mutation？
11. restart 后如何恢复 candidate / revision / relation，如何处理半完成 promotion？
12. 哪些测试直接证明 `initiative != authority`？

如果任一问题暴露 source 与本规格冲突，先报告并缩小实现，不得自行扩架构解决。

## 18. 交付要求

Codex 实现时：

- 从实现开始时的 current master 新建任务分支；
- 不自行 merge master；
- 不顺手实现 non-goals；
- 不修 unrelated baseline failures；
- 完成必须提供可复现 evidence，而非仅代码 diff；
- GUI 仅在真实需要时增加，并保留对应可复现验证；
- 任何真实外部副作用、破坏性操作、architecture invariant 改变都先遵循对应 owner 的现有 authority；
- 最终报告至少包含 package ownership、public contract、persistence、identity/provenance、state machine、RIR bridge、Planning promotion、negative authority tests、两条 vertical 的结果与未完成依赖。

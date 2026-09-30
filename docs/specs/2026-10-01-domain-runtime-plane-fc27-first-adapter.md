# Domain Runtime Plane：真实领域状态、领域能力与 Plan Artifact

> 日期：2026-10-01  
> 并行开发分支：`dot/domain-runtime-plane`  
> 分支基线：`13f1de5f64c5d40af8902ec30984ae082a6618f6`  
> 定位：补齐 DSH 从“Agent / Planning 已经知道要做什么”到“形成可执行前候选方案”之间的系统中间层。  
> FC27 SBC 是第一个真实 Domain Adapter，不是该能力的产品边界。  
> 本线与 Thinking Desk WP4、Side-effect Safety Plane 独立并行。

## 0. 这条线解决什么

当前 DSH 已经有很强的上层与下层：

```text
上层
Planning / Session / Agent / Thinking Desk
        ↓
       ???
        ↓
下层
Browser / Tools / Queue / Delivery / Storage
```

第三条线补的是中间的：

```text
Domain Runtime Plane
```

它负责回答：

1. 真实业务世界现在是什么状态？
2. 这些状态是否完整、新鲜、可追溯？
3. 一个领域能力如何把低层 Browser / API /计算函数包装成稳定业务动作？
4. 基于精确 Reality 输入，形成了什么 Plan Artifact？
5. 这个 Plan Artifact 是基于哪些快照、约束和假设得到的？
6. 哪些内容仍是 unknown / partial / stale，因而不能进入执行？

它不负责：

- 人类最终批准；
- 副作用安全；
- 真实执行；
- UNKNOWN write recovery；
- Planning canonical mutation。

这些分别由现有 Planning / Side-effect Safety / BrowserTask / Delivery 等 owner 负责。

---

## 1. 系统位置

```text
Cognitive Plane
Session / Agent / Thinking Desk
        │
        ▼
Intent Plane
Planning / Focus / Proposal
        │
        ▼
┌────────────────────────────────────┐
│ Domain Runtime Plane               │
│                                    │
│ Reality Snapshot                   │
│ Domain Capability                  │
│ Domain Planner                     │
│ Plan Artifact                      │
│ Artifact Lineage                   │
└────────────────┬───────────────────┘
                 │
                 ▼
Safety Plane
Approval / Risk / Gate / Ledger
                 │
                 ▼
Execution Plane
Browser / Queue / Delivery / Tools
                 │
                 ▼
Reality
```

FC27 第一条映射：

```text
FC Web App
   ↓
FcRealitySnapshot
   ↓
FcSbcDomainCapability
   ↓
SbcSolverInputCompiler
   ↓
Solver
   ↓
FcSbcPlanArtifact
```

到此为止，本线不发送真实购买 / 填阵 / Submit。

---

## 2. 开始前必须读取的上下文

### 仓库规则

- [根级 AGENTS](../../AGENTS.md)
- [架构](../architecture.md)
- [packages 约定](../../packages/AGENTS.md)
- [package group map](../../packages/README.md)

### Capability / Browser 现状

- [Capability seams](../capability-seams.zh.md)
- [Browser 子系统](../subsystems/browser.zh.md)
- [BrowserTask](../../packages/browser/browser-task/README.zh.md)
- [Browser Page Model Generalization](2026-09-10-browser-page-model-generalization-plan.md)

### Planning 边界

- [Planning 子系统](../subsystems/planning.zh.md)
- [Planning Context](../../packages/planning/planning/src/context.ts)

重点：Planning 的 `ResourceRef` 只保存外部 identity/linkage。Domain Runtime 不得把领域 payload 塞进 Planning core。

### FC27 当前模型与已有能力

- [FC Web App 应用模型 handoff](2026-09-26-fc-web-app-model-handoff.md)
- [FC27 SBC 整体设计](2026-09-25-fc27-sbc-assistant.md)
- [FC Web App Skill](../../.agents/skills/fc-web-app/SKILL.md)
- [FC tool bindings](../../.agents/skills/fc-web-app/references/tool-bindings.md)
- [FC application model](../../.agents/skills/fc-web-app/references/application-model.json)

实现前至少检查：

- `apps/chrome-extension/src/fc-sbc-main-read.js`
- `apps/chrome-extension/src/fc-sbc-page-model.js`
- `apps/chrome-extension/src/fc-sbc-inventory-snapshot.js`
- `apps/chrome-extension/src/fc-sbc-puzzle-solver.js`
- `apps/chrome-extension/src/fc-sbc-native-chemistry.js`
- `apps/chrome-extension/src/fc-sbc-quote-preflight.js`
- `apps/chrome-extension/src/fc-sbc-readiness.js`

不要重新发明这些纯计算逻辑。

---

## 3. 设计原则

### 3.1 Generic contract，FC first adapter

通用层只抽象已经被 FC27 真实需求证明的部分：

- artifact identity；
- freshness；
- coverage；
- lineage；
- domain provider discovery；
- artifact read；
- capability description。

不要先设计：

- 通用业务 ontology；
- 万能 workflow DSL；
- 万能 solver 接口；
- 通用网站图谱；
- generic JSON `domain.invoke(anything)`。

领域操作继续可以是 typed domain service / typed model tools。

### 3.2 Payload owner 不集中

不要建立一个“所有 Domain Artifact 都写进中央数据库”的大平台。

原则：

```text
Generic Domain Runtime
  owns identity / registry / metadata contract

FC provider
  owns FC Reality / Plan payload persistence

Future GitHub provider
  owns GitHub payload persistence
```

Generic runtime 路由读取，不复制 owner payload。

### 3.3 Artifact immutable

Reality Snapshot 和 Plan Artifact 都是不可变事实。

Reality 变化：

```text
snapshot #41
→ 新观察
→ snapshot #42
```

不是修改 #41。

Plan 变化同理。

### 3.4 Unknown 不推断

- partial 不是 complete；
- stale 不是 fresh；
- 没读到不是不存在；
- bounded search 没找到，不是 mathematical no-solution；
- page dispatch observed，不是业务完成。

### 3.5 Domain Runtime 只读 / 规划

Phase A 不允许任何 external write。

如果某个现有 FC 函数可能触发页面或市场写入，不纳入本线 execution path。

---

## 4. DRP-WP1 — Generic Domain Artifact Contract

第一步建立最小系统合同。

建议词汇：

```ts
interface DomainArtifactRef {
  domain: string
  kind: string
  id: string
  digest?: string
}

interface DomainSourceRef {
  kind: string
  id: string
  provider?: string
  revision?: string
  label?: string
}

interface DomainArtifactHeader {
  ref: DomainArtifactRef
  createdAt: string

  observedAt?: string
  expiresAt?: string

  coverage?: {
    status: 'complete' | 'partial' | 'unknown'
    reasons: readonly string[]
  }

  freshness?: {
    status: 'fresh' | 'stale' | 'unknown'
    observedAt?: string
    expiresAt?: string
  }

  derivedFrom: readonly DomainArtifactRef[]
  sourceRefs: readonly DomainSourceRef[]

  issues: readonly {
    code: string
    severity?: 'info' | 'warning' | 'blocked'
    detail?: string
  }[]
}

interface DomainArtifactView {
  header: DomainArtifactHeader
  payload: unknown
}
```

实际类型应使用 repo 现有 brand / schema / bounded-text convention。

### 通用内核必须做的事

- provider registry；
- provider discovery；
- read artifact by ref；
- read header without payload；
- lineage traversal，至少 parent refs；
- validation；
- bounded metadata；
- duplicate provider id rejection；
- unknown provider fail closed；
- detached clone，caller 不能修改 owner state。

### 通用内核不要做

- 持久化领域 payload；
- 理解 FC；
- 执行 domain action；
- 生成 Planning Proposal；
- 运行 LLM；
- 评价业务 plan 好坏。

### Package placement

Codex/Dot 先做 reconnaissance 后选择位置。

候选是建立新的最小 capability family，例如：

```text
packages/domain-runtime/
  README.md
  domain-runtime/
```

但不要机械创建新顶级 group。

必须先回答：

- 是否已有 group 能自然拥有“跨领域 artifact registry / metadata contract”；
- 若没有，新 group 是否比塞入 browser/planning/experimental 更清晰。

如果创建新 group，同步更新 package group docs 和 architecture owner docs。

不建议放 `packages/experimental` 后再让 released FC consumer 依赖它，因为 experimental group 明确不应被外部 released product 依赖。

---

## 5. Domain Provider Contract

Generic runtime 不调用万能 JSON operation。

Provider 最小接口建议类似：

```ts
interface DomainRuntimeProvider {
  readonly domain: string

  descriptor(): DomainDescriptor

  readArtifact(
    ref: DomainArtifactRef,
    signal?: AbortSignal,
  ): Promise<DomainArtifactView | undefined>

  readArtifactHeader(
    ref: DomainArtifactRef,
    signal?: AbortSignal,
  ): Promise<DomainArtifactHeader | undefined>
}
```

`DomainDescriptor` 可以描述：

- domain id；
- human label；
- artifact kinds；
- capability names；
- 是否只读 / 是否规划 / 是否执行。

但 descriptor 不是调用接口。

Domain-specific typed service 继续拥有真正动作，例如 FC：

```text
inspect
plan
status
```

---

## 6. DRP-WP2 — FC27 Reality Adapter

这是第一套真实 provider。

目标：

> 把现有 FC 页面 / EA service read / inventory contracts 编译成一个不可变、可追溯、带 coverage/freshness 的 Reality Artifact。

建议 artifact：

```text
domain = "fc27"
kind   = "sbc-reality"
```

最小 payload：

```ts
interface FcSbcRealitySnapshot {
  pageIdentity: {
    installationId?: string
    tabId?: number
    frameId?: number
    documentId?: string
    clubId?: string
    platform?: string
  }

  group: {
    id?: string
    title: string
    taskType: 'puzzle' | 'item-score' | 'unknown'
    challenges: readonly ChallengeSnapshot[]
  }

  inventory: {
    status: 'complete' | 'partial' | 'unknown'
    cards: readonly CardInstance[]
    summary: unknown
  }

  marketAccess: {
    status: 'visible' | 'blocked' | 'unknown'
    observedAt?: string
  }

  capturedAt: string
}
```

具体字段复用现有 FC contracts，不复制另一套同义类型。

### Reality compiler

输入优先来自现有：

- `fc-sbc-main-read`
- `fc-sbc-page-model`
- `fc-sbc-inventory-snapshot`
- 当前 application-model evidence

编译器必须：

- 保留 stable instance identity；
- 保留 task / challenge identity 能证明多少就写多少；
- inventory complete 只有现有证据满足时才标 complete；
- 明确 market access；
- 记录 capturedAt；
- 生成 deterministic digest；
- 保存 source refs / provenance；
- issues 有界；
- 原始大 DOM / 敏感 token 不进入 artifact。

### Persistence

FC owner 使用 Storage Domain 持久化 Reality Artifact。

- immutable；
- bounded；
- idempotent capture request；
- restart 后可读；
- artifact payload 归 FC owner，不归 generic registry。

---

## 7. DRP-WP3 — FC27 Plan Artifact

Goal：

> 基于一个精确 Reality Artifact，调用现有 solver 形成一个不可变、可复查的 Plan Artifact。

建议：

```text
domain = "fc27"
kind   = "sbc-plan"
```

最小 payload：

```ts
interface FcSbcPlanArtifact {
  realityRef: DomainArtifactRef

  solver: {
    version: string
    searched: number
    searchComplete: boolean
    incompleteReasons: readonly string[]
  }

  candidates: readonly {
    id: string
    challengePlans: readonly unknown[]
    purchaseCount: number
    maxSpend?: number
    provisional: boolean
    issues: readonly string[]
  }[]

  selectedCandidateId?: string

  quoteStatus: {
    status: 'not-requested' | 'missing' | 'partial' | 'ready'
    quoteRefs: readonly DomainArtifactRef[]
  }

  readiness: {
    status: 'candidate' | 'blocked' | 'ready-for-approval'
    blockers: readonly string[]
  }
}
```

具体内容继续复用现有：

- puzzle solver；
- native chemistry；
- core plan variants；
- quote preflight；
- readiness。

### 关键语义

- Plan Artifact 必须绑定 exact Reality ref。
- Reality stale 后旧 Plan 不自动重算或改写。
- limited search 没有 candidate 时，artifact 必须保留 `searchComplete=false`。
- 缺真实 quote 时可以产生 candidate，但不能伪装成 ready-for-approval。
- Plan Artifact 只是执行候选，不是 Planning canonical state，也不是 Safety Approval Artifact。

---

## 8. Domain Capability 层

Phase A 需要把 FC 低层零件收敛成一个稳定 facade。

建议 Host service：

```text
ctx.fcSbcDomain
```

方法概念：

```text
captureReality(...)
buildPlan(realityRef, ...)
getStatus(...)
readArtifact(...)
```

实际 service key/name 由 repo naming convention 决定。

### Agent-facing facade

不要让 Agent 直接编排十几个 `fc-sbc-*.js`。

Phase A 至少提供 read-only typed model tools，命名可按工具规范：

```text
fc_sbc_inspect
fc_sbc_plan
fc_sbc_status
```

要求：

- tool 只调用 domain service；
- 不直接 Browser write；
- 不买卡；
- 不填阵；
- 不 Submit；
- 返回 artifact refs + bounded summaries；
- 大 payload 通过 artifact read / spill pattern，而不是塞满 tool result。

如果现有 Agent tool package结构更适合一个单 tool + closed action union，可使用现有 convention，但必须保持 typed domain facade。

---

## 9. Artifact Lineage

第一版只需要轻量 lineage，不建图数据库。

目标链：

```text
Browser / FC observation refs
        ↓
FcRealitySnapshot #R41
        ↓
FcSbcPlanArtifact #P9
        ↓
未来：Quote / Approval / Safety / Execution
```

每个 Artifact Header 保留：

- `derivedFrom`
- `sourceRefs`

即可。

### Planning integration

Planning 如果要引用 Domain Artifact，只转换成现有 `ResourceRef`：

```text
kind = domain artifact kind
id = artifact id
provider = fc domain provider
revision/digest = artifact immutable identity
```

不要扩 Planning schema。

本阶段不要求自动把每个 artifact 都写入 Planning。

---

## 10. 与 Thinking Desk 的关系

Thinking Desk WP4 未来可以把 Domain Artifact refs 放入 Thinking Context。

例如：

```text
Design Case
  resourceRefs:
    FcRealitySnapshot #R41
    FcSbcPlanArtifact #P9
```

但本线不修改 Thinking Desk。

Domain Runtime 只确保：

- artifact 可通过 ref 读取；
- metadata / lineage 有界；
- owner 清晰。

---

## 11. 与 Side-effect Safety Plane 的关系

Safety Plane未来消费的是：

```text
Frozen Plan Artifact
+
Durable Approval Artifact
```

Domain Runtime 不做：

- risk budget；
- lease；
- gate；
- ledger；
- UNKNOWN reconciliation。

Safety 不负责：

- 读取完整库存；
- solver；
- quote planning；
- 解释 SBC requirements。

边界必须保持。

---

## 12. DRP-WP4 — Quote Provider（后续）

不在 Phase A 默认实现。

Phase A 只保留 quote artifact / quote status 位置。

后续 FC provider 可接：

```text
batchQuote(cardVersionIds, platform)
→ PriceQuoteArtifact
```

PriceQuote 必须有：

- cardVersion；
- platform；
- source；
- observedAt；
- expiresAt；
- price；
- status。

Quote Provider 是 FC/domain provider，不属于 generic kernel。

---

## 13. DRP-WP5 — Replay / Evaluation（后续但要留接口）

Domain Runtime 的一个重要长期收益是：

```text
真实 Reality
→ artifact
→ fixture
→ offline replay
→ solver / planner regression
```

Phase A 测试先使用脱敏 fixture。

不要读取或提交真实 FC 凭据。

后续可以把一次真实 capture 转成可审计 regression asset。

---

## 14. Phase A 当前实施范围

Dot 当前任务实施：

### DRP-WP1
Generic Domain Artifact Contract + provider registry。

### DRP-WP2
FC27 Reality Adapter + immutable persisted `FcSbcRealitySnapshot`。

### DRP-WP3
FC27 Plan Artifact + Reality → existing solver → immutable plan lineage。

### DRP-WP3.5
最小 read-only FC Domain Capability facade / model tools：

- inspect
- plan
- status

只要不造成 scope 爆炸，和 WP3 同批交付。

不要进入：

- real quote provider；
- Safety；
- Executor；
- live purchase/fill/submit。

---

## 15. Phase A 验收

### A. Generic kernel 不认识 FC

用至少两个 fake provider 测试：

```text
provider A -> artifact kind alpha
provider B -> artifact kind beta
```

证明：

- registry 路由正确；
- kernel 不检查 domain payload；
- duplicate provider 拒绝；
- unknown provider fail closed；
- detached read；
- metadata bounds。

### B. FC Reality

给一个脱敏 fixture / existing test sample：

```text
raw FC read
→ Reality compiler
→ FcRealitySnapshot
→ persist
→ restart
→ same immutable artifact readable
```

验证：

- coverage 不被夸大；
- inventory partial 不会标 complete；
- capturedAt / freshness；
- provenance；
- no credential/token；
- digest stable。

### C. Reality → Plan

```text
Reality #R1
→ solver input compiler
→ existing solver
→ PlanArtifact #P1
```

验证：

- `P1.derivedFrom = [R1]`
- solver search incomplete 时 artifact 明确保留；
- quote 缺失时不是 ready-for-approval；
- old Reality 不被 Plan 修改；
- 同一 canonical input 幂等。

### D. Agent-facing facade

在 deterministic model/tool test 中：

```text
fc_sbc_inspect
→ returns Reality ref

fc_sbc_plan
→ returns Plan ref

fc_sbc_status
→ bounded current artifact summary
```

模型工具不能触达 FC external write。

### E. No side effects

测试明确证明：

- browser write = 0；
- purchase = 0；
- fill = 0；
- submit = 0；
- Planning mutation = 0；
- Safety execution = 0。

---

## 16. Dot 工作方式

本任务适合 Dot 长程自主执行。

允许 Dot 自主：

- reconnaissance；
- package placement；
- implementation plan；
- code changes；
- docs；
- tests；
- commit / push 到明确授权分支。

只有以下情况回来询问：

- 需要改变本文的系统边界；
- 需要扩大到 Safety / Executor；
- 需要真实登录 FC / 使用用户凭据；
- 需要产生真实外部副作用；
- 需要 merge master；
- 发现现有 owner contract 与本文 invariant 根本冲突。

不要因为普通实现选择频繁询问。

---

## 17. 明确非目标

Phase A 不做：

- 自动买卡；
- 自动填阵；
- 自动 Submit；
- market write；
- Side-effect Safety；
- Approval Artifact；
- Executor；
- BrowserTask 改写；
- Thinking Desk 改写；
- Planning core schema 扩展；
- 通用 graph；
- 通用 domain workflow DSL；
- 通用 solver framework；
- universal domain JSON invocation；
- 中央 Artifact payload database；
- 第二个真实业务 adapter；
- 自动 Memory / Knowledge promotion。

---

## 18. Dot 完成报告

最终必须报告：

1. Generic Domain Runtime 放在哪个 package group，为什么。
2. public contract / service key。
3. provider registry 如何工作。
4. Artifact identity / immutability / digest。
5. coverage / freshness / lineage 的精确语义。
6. payload persistence owner。
7. FC Reality compiler 复用了哪些现有模块。
8. Reality completeness 如何证明，哪些仍可能 partial。
9. solver input compiler 如何从 Reality 构建。
10. Plan Artifact 如何表达 bounded search / provisional / quote missing。
11. Agent-facing domain facade 实际有哪些工具。
12. 为什么 Agent 不再需要直接拼十几个低层 FC 函数。
13. Planning / Thinking / Safety 各自如何引用 artifact，而不复制 payload。
14. tests / restart / fixture evidence。
15. 明确确认没有任何真实 FC/browser external write。

如果发现现有代码已经提供等价机制，优先复用，不要为了匹配本文名字复制一套。

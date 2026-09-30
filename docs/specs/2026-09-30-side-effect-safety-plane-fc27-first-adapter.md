# Side-effect Safety Plane：通用副作用安全内核与 FC27 首个 Adapter

> 日期：2026-09-30；并行开发分支：`codex/side-effect-safety-plane`；分支基线：`13f1de5f64c5d40af8902ec30984ae082a6618f6`；定位：建立 DSH 通用的副作用安全机制；FC27 SBC 是第一个真实压力测试实例，不是该能力的产品边界。
>
> 本线与 Thinking Desk WP4 独立并行。不要修改 `codex/planning-ui-workspace` 上正在推进的 Agent Thinking 闭环。

## 0. Codex 接手结论

这条线不是：

- “再做一个 FC27 risk-preflight”；
- “马上写自动买卡 / 自动 Submit”；
- “把现有 BrowserTask、Approval、Delivery 再复制一遍”。

这条线要解决的是：

> 当 DSH 即将执行一个可能产生外部副作用、资源消耗、不可逆变化或未知结果的动作时，是否存在一层通用、持久、fail-closed 的机制，保证动作只有在授权、风险、运行时身份和恢复条件都满足时才会发送；一旦发送后的结果未知，系统绝不盲目重放，而进入可审计的 reconciliation。

FC27 负责提供第一批真实动作：

- market search；
- purchase；
- fill-squad；
- submit。

但通用内核不能认识：

- 球员；
- chemistry；
- SBC challenge；
- cardVersion；
- coin。

这些属于 FC adapter / policy。

长期模型：

```text
Agent / Workflow / Domain Planner
              │
              ▼
        Proposed Action
              │
              ▼
┌─────────────────────────────────────┐
│       Side-effect Safety Plane      │
│                                     │
│  Approval Artifact   授权范围       │
│  Risk Budget         风险预算       │
│  Execution Lease     独占执行权     │
│  Runtime Gate        动作前门禁     │
│  Action Ledger       副作用账本     │
│  Readback            结果读回       │
│  Reconciliation      未知恢复       │
│  Circuit Breaker     熔断 / 暂停    │
└──────────────────┬──────────────────┘
                   │ ALLOW
                   ▼
              Domain Executor
                   │
          ┌────────┴────────┐
          ▼                 ▼
       CONFIRMED          UNKNOWN
          │                 │
          ▼                 ▼
       Evidence        Reconciliation
```

---

## 1. 开始实现前必须阅读的上下文

### 仓库规则

- [根级 AGENTS](../../AGENTS.md)
- [架构](../architecture.md)
- [packages 约定](../../packages/AGENTS.md)
- [package group map](../../packages/README.md)

### DSH 已有的通用安全机制

#### 一次性人类审批

- [Approval 子系统](../subsystems/approval.zh.md)
- [Approval seam 决策](../../.agents/notes/implemented/feature/2026-07-06-approval-seam.zh.md)
- [user-approval package](../../packages/interaction/user-approval)

关键事实：

- `ctx.approval` 回答“这个具体操作现在可不可以继续”；
- outcome 是 `allowed-once | rejected | cancelled | unavailable`；
- 缺少 answerer 时 fail closed；
- 它是**一次性动作审批 seam**，不是长期业务 Approval Artifact store。

Side-effect Safety Plane 应复用它作为需要人工确认时的**交互通道**，但不能把一个 `allowed-once` 误当成“整组 FC27 方案在未来一小时内全部获批”的 durable authority。

#### Browser unknown-write / recovery

- [BrowserTask](../../packages/browser/browser-task/README.zh.md)
- [extension journal](../../apps/chrome-extension/src/assistant-journal.js)
- [extension recovery](../../apps/chrome-extension/src/assistant-recovery.js)

关键事实：

- BrowserTask 在 write 发送前保留 dispatch intent；
- 扩展 journal 在 executor 发送前持久化 intent；
- 已发送的 unknown write **只能 reconcile，不会 replay action**；
- restart recovery 是 lookup-only；
- unknown 不能被“没查到请求”推导成 not-sent；
- BrowserTask 已有预算、资源 lease、blocker、当前 evidence 与完成条件。

Safety Plane 的 UNKNOWN 语义必须与这套机制对齐。

不要做一套“FC unknown 可以自动 retry”的平行语义。

#### Delivery unknown side effect

- [Delivery 子系统](../subsystems/delivery.zh.md)

重点查看 `IssuePublication` 生命周期：

```text
prepared
→ publishing
→ published | failed | unknown
```

其中：

- side effect 前先持久 prepared / publishing；
- unknown 不自动重试；
- 只有显式 reconciliation 才能确认 published 或 confirm-not-created。

这已经是 DSH 中另一个成熟的 unknown-side-effect 例子。

本线应借鉴并统一语义，不要求第一版迁移 Delivery 到新 kernel。

#### Session persistence lease

- [跨进程 Session write lease](../../.agents/notes/implemented/feature/2026-08-31-cross-process-session-write-lease.zh.md)

注意：这是**日志 writer ownership**，不是业务副作用授权 lease。

不要把它和 Safety Plane 的 Execution Lease 混为一谈。

### FC27 当前能力

至少阅读：

- [FC27 SBC 设计](2026-09-25-fc27-sbc-assistant.md)
- [FC27 SBC handoff](2026-09-26-fc27-sbc-handoff.md)
- [risk preflight](../../apps/chrome-extension/src/fc-sbc-risk-preflight.js)
- [approval preview](../../apps/chrome-extension/src/fc-sbc-approval-preview.js)
- [execution dry run](../../apps/chrome-extension/src/fc-sbc-execution-dry-run.js)
- [execution gate](../../apps/chrome-extension/src/fc-sbc-execution-gate.js)
- [write lease](../../apps/chrome-extension/src/fc-sbc-write-lease.js)
- [transaction readback](../../apps/chrome-extension/src/fc-sbc-transaction-readback.js)
- [readiness](../../apps/chrome-extension/src/fc-sbc-readiness.js)
- [inventory snapshot](../../apps/chrome-extension/src/fc-sbc-inventory-snapshot.js)
- [solver](../../apps/chrome-extension/src/fc-sbc-puzzle-solver.js)
- [MAIN-world read](../../apps/chrome-extension/src/fc-sbc-main-read.js)

当前这些 FC 模块已经有很多正确概念，但多数还是：

> pure calculation / preview / contract

而不是一条任何真实 write 都无法绕过的 durable runtime safety path。

这正是本线要补的 seam。

---

## 2. 机制与领域策略必须分离

### Safety Kernel 拥有

Kernel 只处理通用机制：

- durable action identity；
- approval identity / digest binding；
- risk budget counters；
- prepared-before-send；
- sent / unknown / reconcile lifecycle；
- execution lease ownership；
- fail-closed gate；
- circuit breaker；
- idempotency；
- evidence references；
- restart-safe ledger；
- action 不可重放规则。

### FC27 Adapter / Policy 拥有

FC adapter 解释具体业务：

- 什么是 purchase / fill / submit；
- 哪个 cardVersion 在批准范围；
- maxPrice；
- challengeId；
- 最大市场搜索次数；
- coin 总预算；
- market access 是否可用；
- inventory 是否完整；
- transaction readback 如何解释；
- submit 后什么证据算完成；
- 哪些异常必须触发 FC breaker。

Kernel 不应该 import FC-specific types。

---

## 3. 第一版通用概念

名称可按仓库约定微调，但语义必须保留。

### 3.1 SideEffectActionIntent

表示“准备执行哪个外部副作用动作”。

建议：

```ts
interface SideEffectActionIntent {
  id: string
  executionId: string

  domain: string
  kind: string

  targetRef: {
    kind: string
    id: string
  }

  parametersDigest: string

  approvalArtifactId: string

  riskCost: {
    actions?: number
    externalWrites?: number
    resourceSpend?: number
    domainUnits?: Record<string, number>
  }
}
```

Kernel 保存 identity / digest，不需要理解 domain parameters。

完整 domain payload 由 adapter / executor owner 保留。

### 3.2 Approval Artifact

这是 durable business authorization，不是 `ctx.approval.allowed-once`。

最小通用部分：

```ts
interface EvidenceRef {
  uri: string
  digest: string
}

interface SideEffectApprovalArtifact {
  id: string
  domain: string
  subjectRef: { kind: string; id: string }

  scopeDigest: string
  policyDigest: string

  createdAt: string
  startsAt?: string
  expiresAt: string

  approvedBy: {
    kind: 'human'
    actorId: string
  }

  evidenceRefs: readonly EvidenceRef[]
}
```

领域 scope 由 FC adapter 保留，例如：

- challenge ids；
- purchase scope；
- card versions；
- max price；
- max coin spend；
- submit scope。

Kernel 只验证：

- artifact identity；
- 是否过期；
- action 是否由 adapter 证明在 scope 内；
- digest 是否一致。

### 3.3 Risk Budget

第一版确定性预算即可，不使用模型打分。

通用预算示意：

```ts
interface SideEffectRiskBudget {
  maxActions?: number
  maxExternalWrites?: number
  maxUnknownActions?: number
  maxConsecutiveFailures?: number
  maxRuntimeMs?: number
  maxResourceSpend?: number

  domainLimits?: Record<string, number>
}
```

FC adapter 可映射：

```text
domainLimits.marketSearches
domainLimits.purchases
domainLimits.submits
maxResourceSpend = coin cap
```

### 3.4 Execution Lease

不要复用“SessionWriteLease”这个名称。

建议叫：

`SideEffectExecutionLease`

它绑定：

- execution；
- approval；
- runtime owner；
- domain target identity；
- acquiredAt / expiresAt；
- release state。

它回答：

> 当前哪一个 runtime owner 被允许推进这组已批准副作用？

它不表示动作已经通过 gate。

每个动作仍要单独 gate。

### 3.5 Action Ledger

这是最重要的 durable record。

建议状态机：

```text
PREPARED
   │ markSent() — 必须在 executor 发送前 durable commit
   ▼
SENT
   ├────► CONFIRMED
   ├────► NOT_APPLIED
   └────► UNKNOWN
                │
                ▼
          RECONCILING
            ├────► CONFIRMED
            └────► NOT_APPLIED
```

允许的语义：

- `PREPARED`：尚未跨过副作用边界，可安全取消；
- `SENT`：系统已承诺“动作可能发生”；
- `CONFIRMED`：有 readback / evidence 证明发生；
- `NOT_APPLIED`：有 evidence 证明未发生；
- `UNKNOWN`：已经发送，但无法证明结果；
- `RECONCILING`：仅允许查询/对账，不允许重新执行原 action。

**UNKNOWN 绝不能直接回 PREPARED。**

### 3.6 Circuit Breaker

第一版不需要复杂策略。

通用状态：

```text
READY
RUNNING
PAUSED
RECONCILING
BLOCKED
COMPLETED
```

例如：

- unresolved UNKNOWN > 0 → `RECONCILING`；
- budget exhausted → `BLOCKED`；
- lease expired → `PAUSED`；
- policy hard block → `BLOCKED`；
- all approved actions terminal + verified → `COMPLETED`。

Domain policy 可以提出 additional blockers。

---

## 4. Safety Gate 必须是强制路径

任何真正的 external write 需要满足：

```text
Domain Action
   ↓
compile ActionIntent
   ↓
Safety Kernel prepare
   ↓
Domain Policy validation
   ↓
Approval scope validation
   ↓
Risk Budget validation
   ↓
Lease validation
   ↓
Unknown / Breaker validation
   ↓
ALLOW
   ↓
mark SENT durably
   ↓
Domain Executor send
   ↓
Readback
   ↓
settle ledger
```

### 关键不变量

Domain Executor 的 public execution path 不应接受：

```text
execute(action)
```

然后内部“顺便”做 gate。

更安全的 seam 是：

```text
prepare/admit → 取得一个短生命周期、单 action 的 admitted handle
→ executor 只接受 admitted handle
```

具体实现形式由 Codex结合仓库决定，但必须做到：

> 生产路径无法仅凭 domain action payload 绕过 Safety Gate。

测试也必须证明 bypass 不存在或 fail closed。

---

## 5. 用户审批如何复用已有 Approval seam

不要替代 `ctx.approval`。

两层含义不同：

### `ctx.approval`

回答：

> 用户是否允许“创建 / 激活这份 durable Approval Artifact”？

这是交互机制。

### Safety Approval Artifact

回答：

> 在接下来这段已定义 scope 与时间窗口内，哪些 domain actions 被批准？

这是业务授权事实。

FC27 示例：

```text
Approval Preview
      ↓
用户点击确认
      ↓
ctx.approval / explicit UI confirmation
      ↓
Durable FC Approval Artifact
      ↓
Safety Kernel references artifact id
```

不要每买一张卡重复弹一次 Approval UI，除非 scope 发生变化或 artifact 失效。

---

## 6. FC27 Adapter 第一版

FC 当前已有 pure calculators 不要删除。

把它们变成 adapter 的输入来源。

### 6.1 复用当前 Approval Preview

当前 `fc-sbc-approval-preview` 已经有：

- reviewDigest；
- identity；
- purchaseScope；
- submitChallengeIds；
- approvalWindow；
- budget；
- risk status。

第一阶段可以定义：

```text
FC Approval Preview
→ validate
→ freeze
→ FC Approval Artifact
→ generic Safety Approval ref
```

不要直接让 generic kernel 解析 preview JSON。

### 6.2 复用 current risk-preflight

`fc-sbc-risk-preflight` 继续负责 plan-time domain assessment。

FC Runtime Policy 再补：

- accumulated market searches；
- accumulated purchases；
- actual coin spend；
- unknown count；
- consecutive failures；
- current identity；
- current inventory freshness；
- market access；
- transaction consistency。

### 6.3 复用 execution-gate

当前 `fc-sbc-execution-gate` 不应被简单删除。

它可以逐步变成 FC adapter 的 domain gate：

```text
Generic Safety Kernel
      +
FC Domain Gate
      ↓
admitted FC action
```

其中 generic 判断：

- ledger state；
- approval existence / expiry；
- lease；
- budget；
- unknown；
- breaker。

FC gate 判断：

- purchase 在批准 scope；
- max price；
- challenge scope；
- current club/document identity；
- FC-specific freshness。

### 6.4 复用 transaction-readback

FC readback adapter 把浏览器 observation 分类成：

```text
CONFIRMED
NOT_APPLIED
UNKNOWN
BLOCKED/INVALID
```

再由 generic kernel 结算 ledger。

Kernel 不解释 balance / card pool。

---

## 7. FC27 真实落地的其它缺口——本线只定义接口，不全部实现

Safety Plane 不是 FC27 全部缺失。

当前还存在这些独立依赖：

### A. Inventory Completeness

必须证明：

- club inventory 已完整分页；
- SBC Storage 完整；
- stable instance identity；
- duplicates 去重；
- lock / tradeable 状态新鲜；
- snapshot freshness。

Safety Policy 应能要求一个：

`inventory-proof`

但本线不要重写 inventory reader。

### B. Market Access / Quote

需要真实验证：

- account transfer market access；
- platform；
- current listing / price；
- quote freshness；
- per-card search bound。

Safety Plane只消费事实。

### C. Solver Proof

需要把：

- requirements；
- inventory snapshot id；
- solver result；
- candidate instances；
- substitutes；
- budget assumptions

冻结成可引用 artifact。

Safety Plane不负责求解。

### D. Domain Executor

真实 purchase / fill / submit executor 尚未完成。

本线先实现 **executor contract + synthetic/no-side-effect executor**。

不要在 SSP-WP1–3 中直接上线真实购买。

---

## 8. SSP-WP1 — Generic Durable Kernel

这是当前第一实施单元。

### 目标

建立一个完全不执行外部动作的 generic safety owner。

最小功能：

- create execution；
- freeze approval ref；
- set risk budget；
- acquire / release Execution Lease；
- prepare action；
- gate action；
- mark sent；
- settle confirmed / not-applied / unknown；
- begin reconciliation；
- resolve unknown；
- compute breaker state；
- detached snapshot；
- restart persistence；
- idempotency / CAS。

### 存储

使用 Storage Domain。

必须：

- bounded records；
- byte / count limits；
- serialized writes；
- deterministic idempotency keys；
- no transcript duplication；
- no domain payload dump。

### 推荐 package 位置

优先评估现有 `packages/guard/` 是否适合作为 runtime guard family。

候选：

```text
packages/guard/side-effect-safety/
packages/guard/side-effect-safety-local/
```

但 Codex 必须先读 `packages/guard/README.md` 和 `packages/AGENTS.md`。

如果该 group 的 contract 明显不适合，不要硬塞；提出一个最小替代位置并说明理由。

不要新增一个 `packages/safety/` 顶级 group，除非已有 group 无法承载且能给出明确依赖/所有权理由。

### SSP-WP1 验收

纯 synthetic：

```text
approval
→ lease
→ action A PREPARED
→ gate allow
→ SENT
→ UNKNOWN
→ restart
→ gate action B blocked because unresolved unknown
→ reconciliation
→ NOT_APPLIED
→ action B can proceed
```

并证明：

- UNKNOWN 不会被 replay；
- restart 后语义不变；
- 同 request 重试不重复 ledger action；
- 不同 payload + 同 idempotency identity 冲突。

---

## 9. SSP-WP2 — FC27 Adapter + Risk Budget

第二实施单元。

### 目标

把现有 FC pure contracts 接到 generic kernel，但仍不真实购买。

实现一个 FC policy / adapter：

- freeze current approval preview 成 FC approval artifact；
- compile purchase / fill / submit action intent；
- map FC plan limits → generic Risk Budget；
- FC-specific scope validation；
- runtime identity validation；
- map transaction readback → generic settlement；
- FC blocker → generic circuit breaker contribution。

### 默认 FC policy

保留当前默认值来源，不擅自放大：

- max purchases；
- max submits；
- max market searches；
- coin cap；
- approval start / expiry；
- write lease / runtime identity。

测试用显式 fixture，不把生产默认值当用户永久偏好。

### SSP-WP2 验收

使用现有 dry-run / approval-preview fixture：

```text
FC preview
→ freeze approval
→ compile actions
→ Safety execution
→ synthetic executor
→ ledger / budget updates
→ one unknown purchase
→ breaker enters RECONCILING
→ later actions blocked
```

---

## 10. SSP-WP3 — Reconciliation + Evidence

第三实施单元。

### 目标

把 UNKNOWN 做成真正可恢复的 durable workflow。

Generic API 至少允许：

- list unresolved actions；
- begin reconciliation；
- attach evidence refs；
- resolve confirmed；
- resolve not-applied；
- keep unknown。

### 不允许

- “超时后自动认为没发生”；
- “journal 查不到就认为没发生”；
- “重启后重新发送相同 purchase”；
- “人工点继续即清掉 UNKNOWN”。

如果用户真的想在证据不足时继续，未来需要独立的 explicit waiver / new execution epoch 设计；本轮不要偷偷加入。

### Evidence

优先复用已有 `EvidenceRef` / content-addressed evidence 体系，避免再造 blob store。

若 Safety Kernel 只需要 opaque ref，则只保存 ref + digest/identity，不复制 evidence bytes。

---

## 11. SSP-WP4 — Browser Runtime Integration

只有 WP1–3 稳定后才进入。

目标：

```text
Safety admitted action
→ BrowserTask / extension journal
→ external browser action
→ exact requestId / locator
→ readback
→ settle Safety ledger
```

必须复用：

- BrowserTask dispatch intent；
- extension journal；
- unknown-write lookup-only recovery。

### 双层 journal 的关系

不要出现两个互相竞争的“谁说动作有没有发送”的 owner。

建议：

- Safety Ledger：业务级 action lifecycle；
- BrowserTask / extension journal：浏览器传输级 request lifecycle。

映射必须显式：

```text
SafetyActionId
    ↕
Browser requestId / locator
```

Safety 的 `SENT` 只有在低层发送边界的持久 intent 已经成立时才能推进。

Codex 必须在实现规格中明确 commit order。

---

## 12. SSP-WP5 — FC27 第一条真实 write slice

**不在当前默认实施范围。**

等以下条件都成立后再做：

- inventory completeness proof；
- market access proof；
- Safety WP1–4；
- approval artifact；
- real readback；
- recovery UI；
- user explicit acceptance。

第一条真实 write 建议优先选择风险更低、可逆性更高的动作来验证 safety path，而不是直接 Submit。

候选顺序：

1. bounded market search（只读或低副作用）；
2. reversible fill-squad；
3. 极低预算单次 purchase；
4. submit 最后。

是否实际运行真实 purchase / submit 必须另行获得用户明确授权。

---

## 13. Recovery / Operator UI

Safety Plane 最终需要一个通用 operator projection。

第一版不必做完整独立工作台，但至少要有一个可供 UI 消费的 snapshot：

```text
Execution
READY / RUNNING / RECONCILING / BLOCKED / COMPLETED

Budget
actions 3 / 10
external writes 1 / 5
resource spend 850 / 5000
unknown 1 / 1

Pending attention
Purchase action #A17
SENT → UNKNOWN

Evidence
...
```

FC adapter 可进一步显示：

```text
购买 <card>
最高价 12,000
发送前余额 ...
结果：未知
```

但 generic UI 不解释 card。

---

## 14. Kill Switch

至少设计两种停止语义：

### Pause

- 不再 admit 新 action；
- 已 SENT action 仍需 readback / reconcile；
- 不把它们取消成 NOT_APPLIED。

### Abort new work

- 释放未发送 PREPARED actions；
- 已 SENT / UNKNOWN 仍保留；
- Execution 不能宣称 clean completion。

不要实现“kill 后把所有状态清空”。

---

## 15. Circuit Breaker 第一版规则

Generic hard rules：

- unresolved unknown > budget → RECONCILING/BLOCKED；
- expired / invalid approval → BLOCKED；
- invalid / expired lease → PAUSED/BLOCKED；
- total risk budget exceeded → BLOCKED；
- ledger consistency failure → BLOCKED；
- idempotency conflict → BLOCKED。

FC policy hard rules示例：

- club / document / grant identity changed；
- purchase over approved max price；
- inventory proof stale；
- balance delta 无法解释；
- submit readback 与 card-pool change 不一致；
- market access lost；
- approved card instance / version 不再满足条件。

测试验证“规则能阻断”，不要把这些具体阈值固定成通用 kernel 语义。

---

## 16. 第二个 Case 如何验证“真的通用”

本线第一版**不要**强迫 BrowserTask 或 Delivery 迁移。

但在 SSP-WP1 评审时至少做一个“语义对照”：

### Delivery IssuePublication

检查：

```text
prepared → publishing → unknown → resolve
```

能否自然映射到：

```text
PREPARED → SENT → UNKNOWN → RECONCILING → terminal
```

### BrowserTask

检查：

- dispatch intent；
- unknown write no replay；
- reconcile-only；
- budget / blocker。

如果 generic kernel 的词汇无法解释这两个已有机制，说明抽象过于 FC-specific，需要在实现前修正。

这只是 conformance review，不要求代码迁移。

第二个真正 adapter 等 FC27 实际使用后再选。

---

## 17. 与 Planning / Thinking Desk 的关系

Safety Plane 不成为 Planning 子系统。

关系：

```text
Thinking Desk
   ↓
产生候选方案 / Design Context / Planning Delta
   ↓
Planning
   ↓
正式采用目标 / scope
   ↓
Domain Planner / Executor
   ↓
Side-effect Safety Plane
   ↓
真实副作用
```

Planning adoption **不等于** Side-effect Approval。

例如：

> “FC27 首个版本允许自动购买”

被 Planning accepted，

仍然不表示：

> “今天这个具体 SBC 可以花 25,000 coin 买这些具体卡”。

后者必须有独立 Approval Artifact。

---

## 18. 与 Delivery 的关系

不要把 Safety Plane 变成第二个 Delivery。

Delivery 拥有：

- requirement contract；
- packet；
- dispatch；
- verification；
- evidence；
- human acceptance。

Safety Plane 拥有：

- 已授权 external side-effect 的运行时 admission；
- durable action ledger；
- unknown / reconciliation；
- runtime budget / breaker。

某些 Delivery executor 未来可能消费 Safety Plane，但本轮不做集成。

---

## 19. 明确非目标

SSP-WP1–3 不做：

- FC27 live purchase；
- FC27 live submit；
- 自动交易；
- 市场套利；
- 自动扫价；
- LLM 风险评分；
- 全局安全策略 DSL；
- RBAC；
- multi-user approval；
- 分布式 multi-host lease；
- 自动 semantic recovery；
- 把 BrowserTask 全部改写为 Safety Plane；
- 把 Delivery IssuePublication 迁移到 Safety Plane；
- 新建第二套 evidence byte store；
- 将 Planning acceptance 当成执行授权；
- 让 Agent 可以覆盖 breaker；
- timeout 后自动把 UNKNOWN 变成 NOT_APPLIED。

---

## 20. 推荐开发顺序

### SSP-WP1
Generic durable kernel：

- execution；
- approval ref；
- budget；
- execution lease；
- action ledger；
- gate；
- breaker；
- unknown / reconciliation；
- persistence / CAS / idempotency。

### SSP-WP2
FC adapter：

- approval freeze；
- action compiler；
- FC policy；
- current risk-preflight / gate / readback mapping；
- synthetic executor。

### SSP-WP3
Recovery / evidence：

- restart；
- unresolved listing；
- reconciliation；
- evidence refs；
- operator projection。

### SSP-WP4
Browser integration：

- BrowserTask；
- extension journal；
- exact send/readback mapping。

### SSP-WP5
Live FC slice：

- separate user authorization；
- first low-risk real write；
- evidence；
- rollback/reconcile drill。

---

## 21. SSP-WP1–3 的完整验收案例

### Generic synthetic case

```text
create execution
→ attach durable approval
→ set budget
→ acquire lease
→ prepare A
→ gate ALLOW
→ durable SENT
→ executor returns UNKNOWN
→ restart host
→ execution = RECONCILING
→ prepare B is blocked
→ reconcile A with evidence = NOT_APPLIED
→ breaker clears
→ B can be admitted
→ B CONFIRMED
→ evidence retained
```

### FC dry-run case

```text
FC approval preview
→ freeze artifact
→ compile purchase/fill/submit actions
→ generic Safety execution
→ synthetic executor
→ purchase #1 confirmed
→ purchase #2 unknown
→ all later writes blocked
→ FC readback reconciles #2
→ budget updates correctly
→ execution resumes
```

### Authority case

必须证明：

- Agent 不能直接 mark confirmed；
- domain executor 不能凭 raw action 绕过 gate；
- Planning accepted state 不能构成 Safety approval；
- `ctx.approval.allowed-once` 自身不能伪造长期 Approval Artifact；
- stale / expired artifact fail closed。

---

## 22. Codex 实现要求

先完成 repository reconnaissance，再生成一份**最小 implementation planning**，只实施 SSP-WP1；WP1 通过后再继续 WP2 / WP3。

第一份 implementation planning 必须回答：

1. Safety Kernel 放在哪个现有 package group，为什么。
2. 哪些能力直接复用 `user-approval`，哪些明确不属于它。
3. 如何与 BrowserTask / extension journal 的 unknown semantics 对齐。
4. 如何与 Delivery IssuePublication 语义对照，而不复制 Delivery。
5. durable storage owner 是谁。
6. action ledger 的精确状态机和合法 transition。
7. 哪个 commit point 表示 `SENT`。
8. 如何保证 UNKNOWN 不 replay。
9. risk budget 如何原子消费。
10. Execution Lease 与 SessionWriteLease 的区别。
11. 如何做 idempotency / CAS。
12. FC adapter 会复用哪些现有 `fc-sbc-*` 模块。
13. 哪些 FC 依赖仍是外部缺口，不在本线实现。
14. 测试如何证明 executor bypass fail closed。
15. 是否需要新增 Agent Note 与 subsystem / package docs；按仓库文档规则同步。

不要为了并行效率启动或委派额外子代理，除非用户在给 Codex 的实际执行会话里明确授权。

---

## 23. 完成报告必须包含

不要只说 “implemented”。

至少报告：

- generic kernel 的 package / service owner；
- public types；
- ledger state machine；
- storage schema；
- admission / send / settle commit order；
- unknown recovery 行为；
- risk budget；
- breaker；
- lease；
- approval seam 的复用点；
- BrowserTask / Delivery conformance analysis；
- FC adapter 映射；
- synthetic tests；
- restart tests；
- bypass tests；
- 是否产生任何真实 FC external write。

SSP-WP1–3 的正确答案应该是：

> 没有产生真实 FC purchase / fill / submit。

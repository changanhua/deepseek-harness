# Requirement Investment Review v1 — RIR-WP1

- 日期：2026-10-01
- 状态：待实现规格；尚未实现
- 范围：只实现 RIR-WP1（Minimum Useful Review）。不要顺手推进 WP2 / WP3。

## 0. 任务目标

为 DSH 增加一个独立的 **Requirement Investment Review（RIR，需求投资评估）** 能力，用于在投入工程资源前回答：

> 基于当前 DSH、当前模型能力、当前已有资产与未来替代风险，这个需求值得投入什么，真正应该工程化的是哪一部分？

RIR 不是需求打分器、Roadmap 排序器、Planning 的审批门，也不拥有用户最终决策权。

第一版成功的标准不是“算出一个更漂亮的分数”，而是能改变工程下注方式，例如把“完整自研 Solver”收敛成“只建设长期耐久的 constraint / state / execution 基础设施”。

## 1. Authority 与必须先读的当前事实

实现前按仓库 authority hierarchy 工作，并至少读取：

- [根级 AGENTS](../../AGENTS.md)
- [架构](../architecture.md)
- [Planning 子系统](../subsystems/planning.md)
- [Planning / Execution 边界](../../.agents/notes/implemented/architecture/2026-09-27-project-planning-and-execution-boundaries.md)
- [Planning UI 当前规格](2026-09-30-planning-ui-object-workspace-redesign.md)
- [Requirement Shaping 交接](../../outputs/2026-09-29-requirement-shaping-handoff.md)
- 与 Planning / ResourceRef / Session / Delivery / plugin composition 相关的实际 source 和 package README

若本规格与更高 authority 的当前 source / contract 冲突，以更高 authority 为准，并在 PR 中报告冲突；不要自行扩大 scope 解决无关问题。

实现事实核对基线为 `master@b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`。实现前重新检查当前 master。Planning UI 规格描述目标设计，不证明四个 tab 已经落地。[提案决策记录](../../.agents/notes/proposed/feature/2026-10-01-requirement-investment-review-wp1.md)说明职责划分理由；WP1 的验收要求以本文为准。

## 2. 系统边界

### 2.1 RIR 是独立 owner

RIR 应拥有自己的评估对象、持久化与模型评估流程。

Planning 继续拥有 canonical Plan / Focus / immutable revision / Proposal / source / review / dependency / Session binding / Delivery handoff。

优先通过现有 extensible `ResourceRef` 连接 Planning 与 RIR；不要为了 RIR 给 Planning core 增加专用字段。

概念关系：

```text
Planning Plan / Focus
        |
        | ResourceRef
        v
Requirement Assessment
```

如果实现者认为 `ResourceRef` 不足，必须先在 PR 中给出具体合同缺口与替代方案，不得直接扩 Planning schema。

### 2.2 RIR 不是 canonical truth

```text
Assessment != User Decision
Assessment != Planning Revision
Assessment != Delivery Approval
```

RIR 输出只能是建议事实。任何 route 都不能自动修改 Planning、创建 Delivery、dispatch Queue 或执行真实副作用。

### 2.3 RIR 与 Requirement Shaping 分工

Requirement Shaping 回答：

> 到底想解决什么问题、成功结果是什么？

RIR 回答：

> 对这个已经足够成形的方向，现在值得投什么？

输入允许不完整，但 RIR 不应通过强制填完整需求表来替代 Shaping。

### 2.4 RIR 与 Thinking Desk 分工

Thinking Desk 用于探索、比较、推演；RIR 用于投资判断。

Thinking Desk 的 exploration 不能因一次 Assessment 自动进入 Planning canonical state。

## 3. RIR-WP1 领域对象

第一版新增独立的 immutable Assessment 对象。最终类型名可按仓库命名规则调整，但语义必须保留。

概念模型：

```text
interface RequirementAssessment {
  id: string
  workspaceId: string

  subject: AssessmentSubject
  mode: 'quick'

  baseline: AssessmentBaseline

  dimensions: DimensionAssessment[]
  stressTests: StressTestResult[]
  allocation: InvestmentAllocation

  route: AssessmentRoute
  uncertainties: AssessmentUncertainty[]

  createdAt: string
  createdBy: ActorRef

  supersedes?: string
}
```

### 3.1 Subject

RIR-WP1 至少支持：

- Manual subject；
- Planning Plan；
- Planning Focus。

可以设计 extensible subject reference，为后续 Proposal / Design Case / Requirement owner 留扩展位，但 WP1 不要求把所有未来 subject 接通。

### 3.2 Immutable history

已完成的 Assessment 不原地覆盖。

“重新评估”创建新 Assessment，并通过 `supersedes` 或等价稳定关系连接旧结果。

旧判断必须可读。

## 4. Assessment Baseline

每次评估必须记录足够的 baseline，避免把判断伪装成永久真理。

至少包含：

- assessment time；
- subject identity 与被评估的 Planning revision（若适用）；
- DSH / workspace 可稳定识别的当前基线；
- 参与判断的相关 capability / component refs；
- 使用的模型 / evaluator identity（按当前 runtime 可可靠记录的粒度，不得伪造）；
- 其他能可靠取得的评估上下文版本信息。

若某项当前没有可靠事实，允许明确记录 unknown；不要生成虚假版本。

当 Plan / Focus 当前 revision 已不同于 Assessment baseline 时，UI / projection 必须能显示 baseline drift / stale 状态，但不得自动重新评估。

### 4.1 固定评估输入

调用模型前，通过有权访问的 owner 读取并固定 subject 与实际评估输入。完成的 Assessment 必须保留该输入快照，或仍可解析的不可变引用；只有摘要或可变定位符不能重建输入。记录的 baseline 必须描述这份已固定输入，不能使用模型完成时读到的更新 revision。

- Plan：保存 Plan id、被评估 revision，以及实际送入模型的相关上下文。
- Focus：保存所属 Plan id/revision、Focus id/version，以及被评估的 title/objective/status。当前 Focus 字段可变，历史 Plan revision 不包含旧 Focus 内容。
- Manual：保存评估时提交的文本与证据；后续修改或重新评估不得改写旧输入。
- Evidence：保留提供的摘录或不可变引用、来源及核验状态、实际选择的上下文和省略项；区分用户陈述、owner 观察事实、模型推断与未知。

WP1 使用人工提供的材料与现有授权 owner 的有界读取。opaque `ResourceRef` 不代表自动抓取 URL、任意读取文件系统或自动联网 / GitHub 研究流水线。无法取得的材料明确为 unknown；不得伪造已检索证据，也不得把秘密复制到评估上下文中。

读取评估时，将当前所属 Plan revision 及 Focus version（适用时）与固定基线比较。subject 缺失或不可读时显示 unavailable/unknown，不能默认为 fresh。评估期间 subject 改变时，保留原输入并在完成结果上提示 drift，不静默重跑。历史 Assessment 使用固定输入，不能用当前 Planning context 重建当时依据。这是 RIR 评估记录，不是第二套 Planning 历史库。

## 5. 八个固定维度

WP1 固定八个维度，不新增总分：

1. `real_utility` — 是否解决真实且重复出现的问题；
2. `system_leverage` — 是否放大多个现有 DSH 能力；
3. `model_durability` — 模型明显增强后仍剩多少价值；
4. `flywheel` — 使用是否积累数据、经验、证据或规则；
5. `composability` — 能否被多个 Agent / Skill / Workflow 重复利用；
6. `option_value` — 是否增加后续选择并保持可逆；
7. `engineering_burden` — 实现、维护、迁移、测试成本；
8. `substitution_risk` — 模型、上游或第三方直接替代的可能性。

每个维度不是单独数字，至少保存：

```text
level
confidence
claim
evidence / grounds
counterArguments
unknowns
```

可以使用稳定枚举或 0–4 等内部 level，但产品 UI **不得生成总分、百分制或加权总分**。

## 6. 三个强制 Stress Tests

每次 Quick Review 都必须输出以下三个反事实测试。

### 6.1 Model x2

假设模型推理、上下文、tool calling 与 computer-use 能力显著提升。

要求明确：

- 哪些当前拟建能力价值下降；
- 哪些保持；
- 哪些因更强模型反而更有价值；
- 最终 `model-durable core` 是什么。

### 6.2 Upstream Substitution

假设 DeepSeek Harness 上游、OpenAI / Codex 或其他依赖在未来提供类似能力。

要求明确：

- 哪些资产可能被删除；
- 哪些个人状态、证据、协议、历史、接口仍然保留；
- 是否应避免投入上游很可能原生覆盖的薄层。

### 6.3 No-Build

假设未来一段时间完全不实现该需求。

要求明确：

- 当前 workaround；
- 不做造成的实际损失；
- 是否有足够证据支持现在投资；
- 哪个未知最值得先通过最小实验消除。

WP1 不需要把“90 天”等时间常数硬编码为领域 invariant；模型可在上下文中采用合理近期窗口并明确说明。

## 7. Investment Allocation

每次评估必须把需求按所有权拆成至少三类：

### SYSTEM-OWNED

适合工程化的长期系统资产，例如状态、协议、权限、证据、执行接口、持久化事实。

### MODEL-OWNED

应继续交给当前或未来模型动态推理的部分，例如策略比较、解释、语义判断、候选生成。

### EXPERIMENT

价值可能存在但证据不足、替代风险高或实现成本不确定的部分。

允许额外显示 `AVOID` / `DO_NOT_OVERBUILD` 展示层，但 WP1 的 durable contract 不必把它做成第四种 owner，除非实现上确有必要。

## 8. Route

WP1 只支持五类 route：

```ts
type AssessmentRoute =
  | 'MODEL_ONLY'
  | 'EXPERIMENT'
  | 'BUILD_CORE'
  | 'BUILD'
  | 'DEFER'
```

语义：

- `MODEL_ONLY`：现有模型 / 人工工作流已经足够，不值得工程化；
- `EXPERIMENT`：先做最小验证，不进入重建设；
- `BUILD_CORE`：只投资长期耐久核心；
- `BUILD`：整体工程化已有充分依据；
- `DEFER`：当前机会成本不合适，保留对象和判断。

不要增加 `REJECT`，也不要让 route 自动触发 downstream action。

## 9. Option Value / Regret

RIR 必须显式考虑：

- Cost of false positive：做了但不值得的损失；
- Cost of false negative：没做但后来证明该做的损失；
- reversibility：做错后是否容易回退。

这些判断应进入 `option_value` 的 claim 或专门结构化字段。

不要用未经验证的 ROI 数学公式制造精确数值。

## 10. Quick Review 模型行为

WP1 只实现 Quick Review。

模型规则：

1. 不把需求描述本身当成收益证据；
2. 区分已知事实、推理判断、用户假设和未知；
3. 不因功能复杂就判断价值更高；
4. 不因模型当前能力不足就默认写代码补齐；
5. 必须运行 Model x2 / Upstream Substitution / No-Build；
6. 必须分出 system-owned / model-owned / experiment；
7. 不输出总分；
8. 推荐最小值得投资的 slice；
9. 不自动修改 Planning；
10. 不自动启动 Delivery；
11. 不把未确认建议写成用户要求；
12. 缺证据时降低 confidence 或给出最小验证，而不是补造事实。

实现者应优先复用现有模型 runtime / tool / Skill 机制，不建立第二套 Agent runtime。

## 11. UI / 产品入口

WP1 只做最小但真实可用的 UI。

### 11.1 Planning 侧

不要为 RIR 增加额外的一级 tab。

在 Plan / Focus 上提供轻入口，例如：

```text
Investment Review
BUILD_CORE · 基于 r12
当前 Plan: r14 · baseline drift

主要结论：优先建设 Browser execution contract

[查看评估]
[重新评估]
```

入口的确切组件位置由当前 UI 结构决定；不得把另一条线的 Planning 四 tab 重构带入 RIR-WP1。

已核对基线通过 [PlanningWorkbench](../../packages/client/ui-planning/src/client/PlanningWorkbench.tsx) 展示 Plan 详情。链接规格中的四 tab 目标不是 WP1 的前置条件。轻入口加入现有 Plan / Focus 组件；若实现时该重构已经落地，适配其当前结构，不扩大工作包。

### 11.2 Assessment View

Assessment 详情至少显示：

- subject；
- baseline / drift；
- route；
- 八个维度（level + claim + confidence，而非雷达总分）；
- 三个 stress tests；
- Investment Allocation；
- main uncertainties；
- re-evaluate。

Quick Review 应能在一屏到少量滚动内理解结论；不要做大而全的 Portfolio Dashboard。

## 12. Planning 连接

优先复用 `ResourceRef` 表示 Assessment identity。

概念上：

```text
RIR-owned relation
  subject: Plan r12 / Focus version
  assessment: ResourceRef
    kind=requirement-assessment
    id=RIR-018
    revision=<stable assessment identity/version>
Planning UI: read-only projection of this relation
```

连接不能把 Assessment route 当成 Planning canonical state。

如果 ResourceRef 只适合 identity 而不适合展示“最新 Assessment”，可以在 RIR adapter / projection 层解决，不得默认把 RIR 字段塞进 Planning item revision。

RIR 按可信 workspace 与 subject identity 持有并持久化 subject-to-assessment 关系。Planning UI 通过 RIR adapter / projection 做只读关联查询。创建、查看与重新评估不得调用 Planning `add-resource-link`、`workspace-change`、Proposal adoption 或其他 Planning mutation。现有 [workspace 操作](../../packages/planning/planning-local/src/workspace.ts) 即使只添加 resource link 也会推进 Plan revision，因此不能复用该写入路径。复用的是 `ResourceRef` 定位结构，不是 Planning mutation。

## 13. Persistence / authority

RIR 的 durable write 必须遵循 DSH 现有 trusted identity、workspace authority、idempotency / stale-write 等既有模式。

不要允许浏览器或模型调用者自行提供可信 actor、伪造 source provenance、伪造 workspace identity。

精确实现方式应复用仓库现有 Provider / Cordis plugin 习惯，并在 Agent Note 中解释 owner 与边界。

## 14. WP1 验收案例

实现完成后至少用以下三个真实案例验收，依据证据区分其投资性质，不以模板化复述代替分析：

### Case A — FC27 SBC Solver

期望系统能识别：

- constraint / state / execution / evidence 等长期资产；
- 大型自研 Solver 容易受模型升级影响；
- 可能更适合 BUILD_CORE / EXPERIMENT，而不是机械整体 BUILD。

具体 route 由实际证据决定，本规格不预先硬编码结果。

### Case B — Side-effect Safety Plane

检查 RIR 是否能识别跨 Browser / Codex / Agent / FC27 等场景的系统杠杆，以及副作用合同、权限、证据等 system-owned 能力。

具体 route 由实际证据决定。

### Case C — Requirement Investment Review 自己

用 RIR 评估 RIR-WP1，检查它是否会无条件为自身扩张辩护。

应能识别：

- WP1 的最小价值；
- WP2 Deep Review / WP3 Outcome Learning 尚无必要默认实现；
- 自身也受流程负担和过度工程风险约束。

### 14.1 可复现证据与决策增益

每个案例保留以下验收证据；这是 WP1 的评估产物，不是 Outcome Learning 子系统：

1. 固定的需求与证据材料包，包括来源引用、基线、提供的事实、假设及已知遗漏。分别标明 master 实现、未合并工作与提案；没有证据时，不得将 SSP 或其他 active branch 写成已落地能力。
2. 评估前的工程选择、替代方案与关键未知。如果原本没有决定，如实记录，不编造前后变化故事。
3. 实际 Quick Review 调用上下文、可取得的模型 identity/settings、prompt 或其版本，以及未编辑的原始输出，并引用保留的输入与结果。排除秘密；不得用手写或 mock 输出代替真实模型运行。
4. 经人工审阅的前后比较，说明哪些投资边界、最小 slice、假设或实验发生改变，哪些维持原判断，以及相应证据。事实错误、无依据断言与流程负担记为失败或限制，不删去不利结果。

按提供的证据判断推理质量，不以命中预期 route 为标准。三个案例都必须覆盖八维、三个 stress tests 与三类 allocation，区分事实与假设，并遵守不修改 Planning / 不 dispatch 的边界。有依据时允许相同 route；有证据地维持原决定也可以有价值。仅模板化复述案例描述或预期结论，不构成决策增益证据。

真实案例逐项报告 passed、failed 或 unverified，并给出原因。真实模型访问或事实输入不足时，WP1 质量验收保持 unverified，不能由 schema tests 顶替。验证这些投资判断不需要也不得执行真实 FC / browser 写操作。

## 15. 自动化验收

实现者需要补齐与当前架构匹配的测试，至少覆盖：

- Assessment immutable creation / re-evaluate；
- Plan / Focus subject identity；
- baseline 与 drift；
- route 五枚举；
- 八维结构完整；
- 三个 stress test 结构完整；
- allocation 三分类；
- Planning 连接不改 canonical revision；
- route 不触发 Delivery / Queue；
- UI 能读取并显示一份 Assessment；
- stale / baseline drift 只提示，不自动重跑；
- reload 后 Assessment 仍可恢复；
- 评估中或评估后修改 Focus，旧输入仍保留且显示 drift；subject 缺失不得显示 fresh；
- 修改 Manual 输入及重新评估后，旧文本与证据仍保留；
- 创建 / 查看 / 重新评估均不改变 Planning Board version、Plan head、Focus version 与 resource links；
- 恶意模型输出或调用输入不能让评估 runner 调用 Planning mutation 或 Delivery / Queue dispatch；验证实际允许的 tool / 调用路径，不能只检查 prompt 文案。

模型质量不能只靠 schema test。还需要至少三个上述真实案例的可复现 evaluation evidence，报告模型实际输出是否产生决策增益。

## 16. 明确非目标

RIR-WP1 不做：

- Deep Review；
- 自动联网 / GitHub / upstream research pipeline；
- realized outcome learning；
- predicted vs actual cost calibration；
- Portfolio 排序；
- Roadmap optimizer；
- 全局需求优先级；
- 总分 / 0–100 分；
- 自动审批；
- 自动 Planning mutation；
- 自动 Delivery / Queue dispatch；
- 自动扫描所有 Idea；
- 强制“未经过 RIR 不得 Planning”；
- 通用 Thinking Desktop 平台重构；
- FC27 专用业务字段进入 RIR core；
- 第二套 Knowledge / Memory / Agent runtime。

## 17. 实现原则

优先最小 owner 与现有能力复用。

建议概念拆分：

```text
requirement-assessment
├─ domain
├─ local provider
├─ context assembler
├─ quick review runner
└─ remote / host projection

ui-requirement-assessment
└─ minimal assessment view
```

这只是概念边界，不是强制 package 名。实现者必须先检查当前 package conventions 后决定实际文件布局。

禁止为了未来 WP2 / WP3 预建复杂抽象。

## 18. PR 交付要求

完成 RIR-WP1 时，PR 必须包含：

1. 实现摘要；
2. owner / authority / persistence 边界；
3. 是否修改 Planning core schema；若修改，为什么 ResourceRef / adapter 不足；
4. Quick Review context 如何装载；
5. 八个维度与三类 allocation 的 durable schema；
6. 三个 stress tests 如何被强制执行；
7. route 为什么不能触发下游副作用；
8. baseline / drift 如何计算；
9. 三个真实验收 Case 的输入、输出与观察；
10. targeted tests 与 repo-required checks；
11. WP1 之外的工作必须明确留在 WP2 / WP3，不得藏在“后续优化”中；WP1 必需项未完成时，必须报告为未完成，不能改称后续工作。

## 19. 执行约束

- 不自行 merge master；
- 不自行扩大工作包到 RIR-WP2 / RIR-WP3；
- 不修 unrelated baseline failures；
- 不调用 Work / Codex 等额外高成本代理能力，除非用户明确授权；
- 可以在本 PR 分支内自主读取、编辑、测试、提交；
- 真实外部副作用、破坏性操作、现有架构 invariant 改变需先停下并报告；
- 完成必须提供可复现 evidence，而不是只报告“代码已实现”。


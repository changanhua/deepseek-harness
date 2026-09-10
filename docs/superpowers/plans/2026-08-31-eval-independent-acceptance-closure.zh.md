# DSH Eval 独立验收闭环

[English](2026-08-31-eval-independent-acceptance-closure.md) | 中文

> 本计划冻结 Eval 的完整产品结果。现有 replay kernel 是第一个前置条件，不代表 Epic 已完成。

## 全局约束

- 被评测的 Agent、Goal、Workflow、Skill、Prompt、模型或 subject DSH runtime 绝不能认证自身成功。
- 确定性检查先于独立模型 grader，grader 不能覆盖确定性失败。
- 每次运行固定 Git revision、Suite version、Profile/configuration、Provider/model/Preset route、可见 Tool/Skill 集合和证据身份。
- Live execution、recorded replay 和 fixture-only tests 是不同证据类别，任何一种都不能冒充另一种。
- Queue 拥有持久有限执行，Storage 拥有 Eval 记录与报告，Bridge package 连接领域但不把领域所有权搬进 Eval core。
- 默认组合不加入模型可见 Eval Tool；第一个产品入口只接受 human 或 Host 授权。
- Private holdout prompt、rubric、答案和 raw output 不进入已提交公共 suite，也不自动晋升知识。
- DSH 开发 DSH 时，known-good controller、隔离 subject 和 independent verifier 使用冻结的 Skill 与 Verifier-plan 身份；被修改 runtime 不能认证自己。

## Feature Charter

### Epic 结果

维护者或获批的 DSH self-development controller 通过受支持 DSH 入口选择版本化 Eval Suite、固定 subject revision 和至少两条 Provider/model/Preset route。DSH 持久执行真实 Agent/Session 工作，应用确定性检查与独立 grader，保留每个 case 的证据，并生成可驱动模型选择、回归判断以及 Goal 或 Workflow 验收的持久报告。

报告而非被评测生产者拥有验收结果。报告区分任务失败、无效证据和基础设施不确定性；保留失败样本而非只有平均值；记录 Token、延迟、成本精度、revision、environment、Session、fixture 和可见能力 provenance。

### 能力边界

| 关注点 | 冻结决定 |
| --- | --- |
| Definition | `@deepseek-ai/dsh-eval` 拥有版本化 Suite、Case、Route、Run、Outcome、Report、execution request/result 和 run-lifecycle contract。 |
| Providers | Local durable provider 拥有 Eval 记录；DSH execution 与 independent grader provider 拥有各自 external call 和 lifecycle；现有 Session Snapshot adapter 继续作为 replay provider。 |
| Consumers | Human/Host 入口启动和检查 run；CI 与 self-development 消费 report；Goal 与 Workflow 通过 Bridge 消费明确 acceptance policy。 |
| Bridges | Queue admission/execution、Goal/Workflow certification、Budget evidence 和可选 UI/API projection 保持独立 Bridge。 |
| Authority | Human 或 trusted Host 定义 Suite、route、grader、baseline、credential、cost ceiling 和 acceptance policy。被评测 Agent 可以生产证据，但运行期间不能修改或批准这些输入。 |
| Lifecycle | Eval run 是 host-durable、可取消、restart-convergent 且幂等的。Dispatch 后结果未知的 work 保持 pending review，不评分也不静默重试。 |
| Entry | 第一个 Consumer 是显式 Eval-capable Profile 中受支持的 human/Host DSH command 或 API；不新增 package bin 或默认模型 Tool。 |
| Artifacts | Durable provider 拥有 EvalRun、per-case evidence reference、EvalReport、baseline identity、price/cost precision，以及终态失败或不确定记录。 |

### DSH 自开发边界

| 世界 | 必需身份和隔离 |
| --- | --- |
| Controller | Known-good checkout/build/Profile、immutable Skill snapshot 与 digest、独立 `DSH_HOME`、data/log root 和 port。 |
| Subject | 固定 start/result revision、隔离 worktree/build/Profile/home/data/log/port，且不能访问 controller policy 或 durable state。 |
| Verifier | Previously approved identity，以及 subject 执行前冻结的 controller-owned immutable Verifier plan。 |
| Verifier plan | Assertion、command、checker/parser、input fixture、golden output、allowed environment input 和 per-file/manifest digest 位于 subject worktree 外。 |
| Credential 与 cost | `none` 或明确 run authorization，包含 target、Provider/model、scope 或 usage limit、budget ceiling 和 expiry。 |
| Human authority | 任何 merge、push、publication、durable-data migration、credential use 或 paid request 都停在记录的 approval boundary。 |

### 必需真实纵切

1. 获批 actor 选择一个固定 subject revision、一个包含确定性 case 与 grader-backed case 的 Suite，以及两条真实 route。
2. 受支持 DSH 入口把 route × case 矩阵作为持久 typed Queue work 准入，并返回稳定 Eval run identity。
3. 每条 route 启动目标 Profile 和 Agent/Session execution。一个 case 修改或检查 Workspace state，一个 case 需要独立 grading，至少一个 case 按设计失败。
4. Host 在声明的 pre-dispatch 或 post-dispatch 点停止并重启。Recovery 不丢 case，也不重复 model 或 Workspace side effect。
5. Deterministic checker 检查 external state，grader 使用独立 identity 和固定 prompt/rubric version。缺失或失败的 grading 保持 invalid 或 infrastructure-uncertain。
6. Durable report 包含有序 per-case result、failure sample、Token、latency、cost precision、environment、可见 Tool/Skill surface、Session/artifact reference 和 route provenance。
7. Goal、Workflow、CI gate 或 DSH self-development acceptance Consumer 读取报告并产生可观察 pass/block 决定，不信任被评测 Agent 的声明。
8. 无 credential 重放已录制 run，除显式声明 live-only 的字段外，得到相同 normalized report bytes。

### 关闭证据

| 层级 | 处置 | 必需证明 |
| --- | --- | --- |
| `source-contract` | required | Public contract、provider、Bridge、authority、recovery 和 negative path 通过 focused test。 |
| `generated-declaration` | required | Package export 和受影响 Cordis/config/persistence/module surface 保持 fresh。 |
| `composed` | required | 真实 Loader/Profile 选择 Eval provider、Queue Bridge、grader 和 human/Host Consumer。 |
| `runtime-observed` | required | 精确 live Profile 暴露 run、scope、durable state、cancellation、restart 和 report lifecycle。 |
| `behavior-verified` | required | 必需真实纵切产生独立报告和 downstream pass/block 决定。 |

### 明确非目标

- 不建设通用 benchmark marketplace、training platform、generic Artifact Store、distributed scheduler 或第二套 Queue/Storage registry。
- 不把 Eval failure 自动晋升为 Skill、knowledge、prompt、training data 或 accepted baseline。
- 不要求每个 evaluator 都是 LLM；deterministic evaluator 和 domain-specific evaluator 仍可作为有效 provider。
- 第一个闭环不做 invoice-grade currency reconciliation；cost record 保留 price identity 和 exact/estimated/unknown precision。
- 第一个闭环不要求 GUI。后续 UI 必须消费同一 Definition 与 durable provider，不能拥有第二份 Eval state。

## 需求追踪

| ID | 需求 | 关闭证据 |
| --- | --- | --- |
| R1 | Versioned Suite/Case/Route/Run/Outcome/Report contract 固定 revision 与 provenance。 | Strict parsing、public API test、generated/export check。 |
| R2 | Real Agent/Session execution 与 keyless replay 同时存在且不混淆证据。 | Live Profile run 加 byte-stable replay report。 |
| R3 | Deterministic Workspace/output/Session check 先于任何 grader。 | External-state assertion 与 deterministic-failure negative test。 |
| R4 | Independent grader 拥有固定 identity、prompt/rubric、usage、latency 和 failure classification。 | Separate grader invocation 与 missing/failing grader case。 |
| R5 | Queue 以持久、幂等、可取消、可重启、受限并发方式执行 route × case work。 | 注入故障的真实 Queue run，且无重复 side effect。 |
| R6 | Durable report 保留 per-case evidence、failure sample、Token、latency、cost precision 和 baseline identity。 | Store/reload 与稳定 JSON/Markdown artifact。 |
| R7 | 受支持 human/Host 入口启动、观察、取消并读取 Eval run。 | 通过选定 Profile 的真实 command/API path。 |
| R8 | Goal、Workflow、CI 或 self-development 消费明确 Eval acceptance policy。 | 独立可观察 pass/block 决定。 |
| R9 | Self-hosted Eval 分离 controller、subject、verifier、policy snapshot、credential、cost 和 rollback。 | 使用冻结 Verifier plan 的 fenced two-world run。 |
| R10 | 完整真实纵切可复现且获得独立验收。 | Final acceptance record 与保留 artifact。 |

## Delivery DAG

```text
E1 kernel ───────────────┬→ E3 DSH executor/checkers ─┐
                        ├→ E4 independent grader ─────┼→ E5 Queue bridge → E6 composition → E7 human/Host consumer ─┐
E2 durable provider ────┘                            │                                                        ├→ E9 acceptance
                                                     └────────────────────────────→ E8 downstream Bridges ───┘
```

### E1 — Eval contract 与 replay kernel

- Role：`kernel`；当前实现是前置条件，不代表 Epic 关闭。
- Owns：`packages/eval/eval` 和 `packages/eval/eval-session-snapshot` contract、四类 outcome、有序 report 与 replay provenance。
- DoD：扩展 contract 时仅服务已证明 Consumer，同时保持当前 focused test；保留 invalid 与 infrastructure-uncertain evidence。
- Does not close：live execution、generic checker、grader Provider、Queue、durable run storage、product entry 或 downstream acceptance。

### E2 — Durable Eval provider

- Role：`provider`；依赖 E1。
- Owns：run/case lifecycle、canonical record、report persistence、baseline identity、evidence reference、cost precision、cancellation，以及通过现有 Storage Domain 实现的 restart reconciliation。
- DoD：run 在 provider restart 后存活；duplicate admission 返回相同 identity；post-dispatch ambiguity 保持 reviewable；Eval state 不只存于 Session history。
- Evidence：provider test 加真实 Storage restart 与 reload。

### E3 — DSH live executor 与 deterministic checker

- Role：`provider`；依赖 E1，并消费 Agent、Session、Workspace/filesystem 与 Profile launch contract。
- Owns：fixed-revision subject execution；file existence/content/equality、structured output、Session fact、exit-state 与 Workspace-diff check；live-to-replay recording handoff。
- DoD：deterministic failure 不能被覆盖；真实 Profile 产生 external Workspace 与 Session evidence；live 与 replay artifact 标明不同 evidence mode。
- Evidence：focused checker test、REAL Loader/Profile execution 和一次受控 live recording。

### E4 — Independent grader provider

- Role：`provider`；依赖 E1。
- Owns：独立 grader identity/Session、prompt 与 rubric version、strict structured result、evidence visibility、usage/latency、cancellation 和 error classification。
- DoD：被评测 Agent 不能访问 hidden rubric 或 grader authority；malformed、missing、canceled 或 failed grading 都不能变成 task failure 或 pass。
- Evidence：strict protocol test、leak negative test 和一次另行授权的 real grader request。

### E5 — Queue-to-Eval Bridge

- Role：`bridge`；依赖 E2、E3 和 E4。
- Owns：typed `eval.run@1` admission、route × case Batch expansion、bounded parallelism、Handler lifecycle、Result projection、cancellation/retry mapping 和 report finalization。
- DoD：dispatch 前后重启均收敛，且不重复 model 或 Workspace effect；result payload 只含 trusted identity，不含 raw untrusted model text。
- Evidence：fake Handler property test，随后完成真实 Queue-backed run。

### E6 — Eval composition

- Role：`composition`；依赖 E5。
- Owns：Bundle/Profile row，选择 Definition、durable provider、execution/checker provider、grader provider、Queue Bridge、Budget policy 和 human/Host Consumer dependency。
- DoD：精确 Profile 通过 REAL Loader composition，generated catalog fresh，HMR disposal 移除 registration，denied scope 不能调用 Eval。
- Does not close：没有 E7 与 E9 时，不证明 user reachability 或最终 Eval behavior。

### E7 — Human/Host Eval consumer

- Role：`consumer`；依赖 E6。
- Owns：受支持 command 或 API operation，用于 submit、inspect、cancel、report、baseline comparison 和 failure-sample access，且不提供默认模型 Tool。
- DoD：authorized actor 通过 shipped DSH entry 启动并观察必需 run；unauthorized 或 model-only caller 在 admission 前失败。
- Evidence：built entry-path test 与真实 Profile invocation。

### E8 — Goal、Workflow、CI 与 self-development Bridge

- Role：`bridge`；依赖 E5 与 E6。
- Owns：从 immutable Eval report 到 pass/block/retry/manual-review decision 的明确 acceptance-policy mapping；任何 domain core 都不导入 concrete Eval provider。
- DoD：至少一条 Goal 或 Workflow path 和一条 DSH self-development path 消费相同 report semantics；忽略 producer 的 self-declared completion。
- Evidence：composed policy test 加可观察 downstream state transition。

### E9 — 独立产品验收

- Role：`acceptance`；依赖 E7 与 E8。
- Owns：必需真实纵切、适用时冻结的 self-hosting identity、保留的 report/evidence、failure injection、replay comparison 和 operator recovery instruction。
- DoD：R1–R10 证据全部存在；independent verifier 记录 downstream pass/block 决定；缺少 credential、restart 或 live Provider work 时保持 `not run`，绝不标为 `N/A`。
- Verification budget：每个 owning task 运行 focused test；hardening 前完成最早真实纵切；freeze 时运行一次完整 Host/Client/Web build；运行一次获批的双 route Provider/grader；最终运行一次 keyless replay。只有相关代码、环境或证据改变时才重跑 broad lane。

## 自开发执行记录

DSH 使用 DSH 实现或验证任何 delivery card 前，必须冻结：

- controller、subject 和 verifier checkout/build/Profile/Skill identity；
- 独立 worktree、`DSH_HOME`、data/log root、module output 和 port；
- subject worktree 外的 immutable Verifier plan，以及 assertion/checker/fixture/golden/environment-input digest；
- credential 与 cost authorization，或 `none`；
- merge、push、publication、migration、credential use 和 paid call 的 human authority stop；
- known-good rollback launch 与 subject base/result revision。

Subject test、report、transcript、Git diff 和 Workspace artifact 只是 candidate evidence。Independent verifier 使用冻结 plan 检查 subject behavior 与 external state。

## 最终门槛

只有当必需真实纵切达到 `behavior-verified`、authorized Consumer 能使用 durable report 产生独立 pass/block 决定，并且 R1–R10 始终可追踪到保留证据时，Eval Epic 才完成。Package、schema、replay fixture、unit suite、build 或 kernel-only PR 都不能关闭本计划。

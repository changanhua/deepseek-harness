# DSH System Gap Audit

[English](2026-10-01-dsh-system-gap-audit.md) | 中文

2026-10-01 事实审计参考文档。实现基线：`master@b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`。2026-09-30 20:40 UTC 已用 `git ls-remote` 重新读取并抓取远端 master，与任务创建时基线一致。本报告是固定证据快照，不取代 package owner 文档，也不是实现规格。

## Summary

用本审计区分已有职责、尚未完成的既定工作、明确非目标和未经证实的抽象。“已实现”表示核查了源码、schema 与接线，不代表本次重新通过真实运行验收。未合入分支单独标明。

## Table of Contents

- [1. Executive Summary](#1-executive-summary)

- [2. Current System Map](#2-current-system-map)

- [3. Active Work Map](#3-active-work-map)

- [4. Hypothesis Audit](#4-hypothesis-audit)

- [5. Newly Discovered Gaps](#5-newly-discovered-gaps)

- [6. False Positives](#6-false-positives)

- [7. Cross-project Lessons](#7-cross-project-lessons)

- [8. Architecture Candidates](#8-architecture-candidates)

- [9. Build Candidates](#9-build-candidates)

- [10. Watchlist](#10-watchlist)

- [11. Final Matrix](#11-final-matrix)

- [12. Verification and Evidence](#12-verification-and-evidence)

## 1. Executive Summary

DSH 已是以 owner 分权、可组合的 agent（智能体）运行时，具备 durable Session／Queue 事实、明确执行权限、来源约束的 Knowledge／Memory 治理，以及可选 Planning／Delivery 产品链。不能把它理解成等待补 Context、Memory、Runtime 或 Capability Plane 的聊天循环。当前未完成工作主要集中在既有 owner 之间的可信组合与验收。

以下三个是证据最充分、尚未闭合的责任合同，均已有 planned owner，不属于无 owner 的 CONFIRMED_GAP。依据不只是 Issue 未关闭，还包括当前代码及 active work 对照。

1. 真实 Eval 执行身份、隔离 subject／grader 与独立回归验收仍由 [#49](https://github.com/changanhua/deepseek-harness/issues/49)–[#60](https://github.com/changanhua/deepseek-harness/issues/60) 规划；master 已有确定性回放和报告合同，但不等于完整可信执行链。[E13](#e13) [E14](#e14)
2. Queue 终态通知不会冷启动已授权 Goal；[#42](https://github.com/changanhua/deepseek-harness/issues/42) 已明确拥有 Activation Grant／Request／Receipt 桥接，Schedule／Webhook／IM 扩展被明确推迟。[E20](#e20)
3. 跨 Session／Goal／Workflow 的请求、Token、墙钟预留与结算归 [#43](https://github.com/changanhua/deepseek-harness/issues/43)；已有 Token 测量、Queue 容量和 Goal 轮数限制不能替代这项共享预算权限。[E04](#e04) [E17](#e17) [E43](#e43)

重要反证：最终模型上下文已有装配、提交与重建链；Knowledge 和 Memory 已有审核、晋升与失效治理；Planning 已存依赖、人工顺序、估计和跨 Plan 排序建议；能力安装和生命周期由真实 owner 分担。SSP 在 [PR #78](https://github.com/changanhua/deepseek-harness/pull/78) 有实现，Domain Runtime Phase A 已在分支实现，RIR 在 [PR #79](https://github.com/changanhua/deepseek-harness/pull/79) 仅有规格 seed。未合入不等于无设计，规格存在也不等于已实现。

本次没有新增通用 Plane 达到 L4／L5。Generic Runtime、Constitution、统一 Context Fabric、Credential Plane、Portfolio Manager、Experience Compiler 均没有足够依据成为新权威。未核实到必须把职责迁入这些抽象的当前重复失败。审计发现局部 owner 限制、67 项既有 invariant companion／publication 违规及过时 owner 文档，按原尺度记录，不扩成新平台。

## 2. Current System Map

持久化按事实 owner 列出，不按页面。Definition 不等于已部署 Provider；base 组合与可选 add-on 分开取证，接线存在也不等于真实验收通过。

| Concern | Canonical Owner | Persistence | Authority | Key Contract | Status |
| --- | --- | --- | --- | --- | --- |
| Session / Session Query | Session；SessionQuery | append-only Session 日志；派生查询索引 | Session append；调用方查询授权 | id + seq；canonical fold / trace [E09](#e09) [E10](#e10) | 已实现；全文检索可选 |
| Agent / Context | Agent registry；agent-loop；systemPrompt | 模型可见事实进入 Session | prepared request 准入；scoped 来源 | assemble → commit → derive/freeze [E01](#e01) [E02](#e02) [E03](#e03) | 已实现 |
| Goal | Goal；goal-round-driver | Session 中 goal/change | exact Agent + Goal revision；临时 arming | 单一当前目标；轮数限制 [E43](#e43) | 已实现；冷 Activation 已规划 |
| Workflow | WorkflowEngine；worker-thread provider | 调用者拥有 live run；Session 事实归 Session | run holder cancel/dispose | 前台编排；子任务生命周期 [E44](#e44) | 已实现；不是 durable Queue |
| Queue | task-queue；task-queue-local | 原子 ChangeSet 日志／恢复投影 | 已验证 Agent／operator；handler claims | Attempt / unknown / retry / capacity [E16](#e16) [E17](#e17) | 已实现；base |
| Planning / Thinking Desk | Planning Board；planning-local；独立探索分支 | Board revisions、proposals、reviews、refs | CAS + 显式 adoption；探索非 canonical | Plan / Focus / ResourceRef [E33](#e33) [E35](#e35) [E48](#e48) | Planning 已实现；UI／Desk 进行中 |
| Eval | eval library；snapshot adapter；planned execution owners | fixtures／reports；规划 durable run／evidence | 独立检查；未来 Host-resolved Plan | route/case/fixture/Session refs [E13](#e13) [E14](#e14) | 回放已实现；真实执行已规划 |
| Browser / Cognition | Browser provider；BrowserTask；独立 cognition consumer | receipts／journal + Session task facts | grant／epoch／page／task；quiescence 证据 | unknown → reconcile，不重放 [E51](#e51) [E36](#e36) | Browser 已实现；cognition PR #73 验收未闭合 |
| Content / Knowledge / Memory | Content；KnowledgeBase；projectMemory | 各自 Storage Domain、immutable versions／releases／decisions | 来源检查；publish checks；Memory 人类决定 | 不可互换的事实 owner [E25](#e25) [E21](#e21) [E23](#e23) | 已实现；治理组合可选 |
| Delivery | Delivery；deliveryEvidence；local providers | Contract／Packet／decision domain + evidence bytes | 人类 requirement approval／acceptance | 已验证 Packet／Attempt／check 绑定 [E11](#e11) [E12](#e12) [E47](#e47) | 可选链已实现；Epic #13 仍 open |
| RepositoryWorkspace | repoWorkspace；git-local | Git worktree + Attempt owner marker | verified commit token；exact lease holder | quiescence 后 checkpoint；remove／preserve [E15](#e15) | 已实现；Eval bridge 已规划 |
| Activation / Budget | planned services #42／#43 | 规划 Grant／Request／Receipt 与 reservation／settlement domains | human grant／budget + 最终 dispatch enforcement | [#42](https://github.com/changanhua/deepseek-harness/issues/42) [#43](https://github.com/changanhua/deepseek-harness/issues/43) | 已规划；非 master runtime |
| SSP | side-effect-safety；Host-bound adapter | 有界原子 Storage Domain 文档 | human proof + opaque admission + 排他 effect lease | SENT／risk 先于 send；UNKNOWN 仅查询 [E39](#e39) | PR #78 有实现；可选；无生产 adapter |
| Domain Runtime | domainArtifacts registry；fcSbcDomain provider | provider-owned immutable Reality／Plan artifacts | 有界 typed read／planning；无执行权 | provider refs；coverage／freshness／lineage [E55](#e55) [E58](#e58) [E59](#e59) | Phase A 分支已实现；未合入 |
| RIR | 规划独立 Assessment owner | 规划 immutable assessment 与 baseline drift | 仅建议；Planning 仍 canonical | 无自动 approval／dispatch [E38](#e38) | PR #79 仅 spec |
| Capabilities / Credentials | Tool／Skill／Preset／MCP／Loader；CredentialProvider | owner 来源／lockfile／events；credential records | scoped 执行；Host／provider／human flow 边界 | Host 只读投影 ≠ authority [E26](#e26) [E31](#e31) | 已实现；有局部生命周期限制 |

## 3. Active Work Map

快照时间：2026-09-30 20:41–20:52 UTC。已读全部 30 个 open Issue、9 个 open PR 的正文、diff 元数据和可见讨论；分支分页已到尾，共 56 个可见 head，并与 Git remote heads 交叉核对。逐分支 package tree 未见 Activation／Budget 目录；含 Eval 的 head 仅两种目录树，均未新增规划中的可信 executor。另查相关 owner 的分支增量，但不能据命名扫描证明任意别名实现不存在。较慢的历史全源码 grep 未完成，不计入证据。

| Open PR | Head / frozen commit | Base | Audited status |
| --- | --- | --- | --- |
| [PR #79](https://github.com/changanhua/deepseek-harness/pull/79) | `codex/requirement-investment-review-wp1` / [`3e670dd29c`](https://github.com/changanhua/deepseek-harness/commit/3e670dd29ca056fff8efb831d9ee3693024d3755) | `master` | Draft；仅规格 seed |
| [PR #78](https://github.com/changanhua/deepseek-harness/pull/78) | `integrate/ssp-wp1` / [`f64e9699ef`](https://github.com/changanhua/deepseek-harness/commit/f64e9699ef5d2f1aeec954f3356b940a5eca136e) | `master` | Open，非 Draft；SSP 内核；无生产 adapter |
| [PR #73](https://github.com/changanhua/deepseek-harness/pull/73) | `codex/browser-cognition-alignment-20260923` / [`0626052e73`](https://github.com/changanhua/deepseek-harness/commit/0626052e73bed8799b8baef0a82e930453892e83) | `codex/browser-semantic-map` | Draft；有 cognition 实现，质量验收未闭合 |
| [PR #72](https://github.com/changanhua/deepseek-harness/pull/72) | `codex/pcp-composition-proposal` / [`6aa2a0e668`](https://github.com/changanhua/deepseek-harness/commit/6aa2a0e66816ba3483c59d1c4de2e99dff650779) | `master` | Draft；组合提案，不新建 control store |
| [PR #71](https://github.com/changanhua/deepseek-harness/pull/71) | `codex/pr1-tool-terminal-state` / [`a3a1b95f77`](https://github.com/changanhua/deepseek-harness/commit/a3a1b95f771b9feca986d071e916ac6f28243d59) | `master` | Draft；终态闭合修复，真实验收未闭合 |
| [PR #70](https://github.com/changanhua/deepseek-harness/pull/70) | `codex/project-context-baseline` / [`8c5cfc4440`](https://github.com/changanhua/deepseek-harness/commit/8c5cfc4440aa17d2224664053b73ce64b99981d9) | `codex/personal-mainline-integration` | Draft；项目上下文文档，非 runtime 权威 |
| [PR #69](https://github.com/changanhua/deepseek-harness/pull/69) | `codex/eval-scenario-design` / [`7f8927a73e`](https://github.com/changanhua/deepseek-harness/commit/7f8927a73e066046df64d73dddf06dbe76eb60fb) | `master` | Draft；多轮 Eval／Browser 设计，无 runtime 实现 |
| [PR #9](https://github.com/changanhua/deepseek-harness/pull/9) | `learning/dsh-mastery-course` / [`e421f9dc5d`](https://github.com/changanhua/deepseek-harness/commit/e421f9dc5d9f93c64247f06c7c8ddfc6883e3de1) | `master` | Open，非 Draft；人类学习 runtime，学习者证据待补 |
| [PR #7](https://github.com/changanhua/deepseek-harness/pull/7) | `intelligence/phase0` / [`f425ef240f`](https://github.com/changanhua/deepseek-harness/commit/f425ef240f4c287ab6b34a18789ae4bc97a8f5c7) | `master` | Open，非 Draft；仓库 intelligence Phase 0，无 runtime service |

其他重要分支证据：`codex/planning-ui-workspace@78a9d52c2accbdf5e026b4114a86a4285bbf0e5b` 已有 native Thinking Desk Agent loop 与人工 canvas；该分支 implementation／WP4 spec 优先于 master 中旧 UI spec 描述其目标。`dot/domain-runtime-plane@7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2` 已含 Phase A 代码，tree 为 `09fa9991147243c6872127d65bd4cd9cb35b9fb6`，不只是 [#77](https://github.com/changanhua/deepseek-harness/issues/77) 设计（[E58](#e58) [E59](#e59) [E60](#e60)）。`codex/session-review-v0@8e41cc18d55427f011423df027b0f1930b4a25e7` 是实现候选，明确未通过 runtime 验收。分支存在不证明当前有人正在执行它。[E40](#e40)

| Open Issues / Roadmap | Fact and boundary |
| --- | --- |
| [#13](https://github.com/changanhua/deepseek-harness/issues/13) | Delivery 纵切；master 已有大量实现 |
| [#40](https://github.com/changanhua/deepseek-harness/issues/40), [#41](https://github.com/changanhua/deepseek-harness/issues/41) | 自主闭环 roadmap 与 Eval 基础；planned／in progress |
| [#42](https://github.com/changanhua/deepseek-harness/issues/42), [#43](https://github.com/changanhua/deepseek-harness/issues/43), [#44](https://github.com/changanhua/deepseek-harness/issues/44) | Activation、Budget、能力 Eval gate；planned |
| [#45](https://github.com/changanhua/deepseek-harness/issues/45), [#46](https://github.com/changanhua/deepseek-harness/issues/46), [#47](https://github.com/changanhua/deepseek-harness/issues/47), [#48](https://github.com/changanhua/deepseek-harness/issues/48) | Eval Web 工作台；标签 in progress，不等于执行证明 |
| [#49](https://github.com/changanhua/deepseek-harness/issues/49), [#50](https://github.com/changanhua/deepseek-harness/issues/50), [#51](https://github.com/changanhua/deepseek-harness/issues/51), [#52](https://github.com/changanhua/deepseek-harness/issues/52), [#53](https://github.com/changanhua/deepseek-harness/issues/53), [#54](https://github.com/changanhua/deepseek-harness/issues/54), [#55](https://github.com/changanhua/deepseek-harness/issues/55), [#56](https://github.com/changanhua/deepseek-harness/issues/56), [#57](https://github.com/changanhua/deepseek-harness/issues/57), [#58](https://github.com/changanhua/deepseek-harness/issues/58), [#59](https://github.com/changanhua/deepseek-harness/issues/59), [#60](https://github.com/changanhua/deepseek-harness/issues/60), [#61](https://github.com/changanhua/deepseek-harness/issues/61) | 可信 Eval 执行与验收；#50 ready，其余 planned |
| [#62](https://github.com/changanhua/deepseek-harness/issues/62), [#63](https://github.com/changanhua/deepseek-harness/issues/63), [#64](https://github.com/changanhua/deepseek-harness/issues/64) | Delivery import 验收 canary，不是三个平台缺口 |
| [#74](https://github.com/changanhua/deepseek-harness/issues/74), [#75](https://github.com/changanhua/deepseek-harness/issues/75) | 显式多页面接续与 connector 重启恢复 |
| [#76](https://github.com/changanhua/deepseek-harness/issues/76), [#77](https://github.com/changanhua/deepseek-harness/issues/77) | SSP-WP1 与 Domain Runtime Phase A；已有未合入实现 |

现有 roadmap 已排除分布式 scheduler、通用 Artifact store、第二 Capability Registry 和自动模型／Skill 晋升。[#52](https://github.com/changanhua/deepseek-harness/issues/52) 复用 RepositoryWorkspace，[#55](https://github.com/changanhua/deepseek-harness/issues/55) 不把 Delivery Evidence 扩成全局存储；[PR #72](https://github.com/changanhua/deepseek-harness/pull/72) 提议组合与 owner-routed commands，不建立新 canonical control database。[PR #73](https://github.com/changanhua/deepseek-harness/pull/73) 虽报告真实传输／模型链路，仍明确 cognition 质量验收失败，不能把 Source／Focus 绑定写成完成。

## 4. Hypothesis Audit

分类针对明确责任，不针对 package 名称。L0＝假设；L1＝局部信号；L2＝完成 owner／active-work 核查后的确认缺口；L3＝至少两个真实重复未满足案例；L4＝有依据的通用架构；L5＝具备真实 case、owner、边界、不变量与验收的建设候选。N/A 表示该局部机制不主张剩余缺口。已规划工作可被确认尚未完成，而不成为无 owner 的 CONFIRMED_GAP；两段代码或两个 fixture 不算 L3。

### H1 — Cross-domain Context Composition

**Classification** — PARTIAL；现有装配链已实现，新统一 owner 的必要性为 HYPOTHESIS。

**Maturity** — 跨来源统一仲裁 L1；既有装配 N/A。

**FACT / Evidence** — SystemPrompt 组装 scoped sections／contexts／tools，loop 投影 runtime context、准入输入和 prepared model route，提交可见事实，再从 Session derive／freeze 消息。TokenMeter／Compaction 处理压力，runtime-facts 拥有局部 relevance／freshness。[E01](#e01) [E02](#e02) [E03](#e03) [E04](#e04) [E49](#e49)

**Current owner / Existing contract** — systemPrompt 拥有组合，各 domain 拥有事实，agent-loop 拥有准入，Session 拥有 durable model history。合同包含 PromptSection／PromptContext、scope disposal、逐步投影、request/header/context 与 derived messages。这是分工，不是无 owner 环节。

**Planned owner / Explicit non-goal** — [#43](https://github.com/changanhua/deepseek-harness/issues/43) 规划用量预算准入，不负责语义相关性选择。Planning 使用有界 context pack／ResourceRef；[PR #73](https://github.com/changanhua/deepseek-harness/pull/73) 的 Browser selection 负责 page／task 证据，不负责所有 domain。SystemPrompt 不是全局检索／排序权威。

**Actual gap** — 未见全局 assembly admission cap；Skill body 整体返回，其他 resource 有有界 renderer。这是具体局部限制，但未核实到两个真实任务证明存在必须新建 owner 才能解决的跨域重复或溢出。[E01](#e01) [E50](#e50)

**Not a gap / Repeated need / Ownership collision** — 不同事实 authority／freshness 对应多个局部 compiler 是正常分工。未确认重复 canonical fact store。平行 Context store 会冲撞 Session 重建权威，共用 relevance 分可能抹掉领域权限。重复未满足案例：未建立。

**PROPOSAL / Recommendation** — observe；真实案例确有需要时，先在既有 owner 内约束过大 Skill 输出。出现实测来源竞争失败后再讨论共享准入合同，不迁移事实权威。

#### Context contribution boundaries

Session／historical facts 走 canonical projection 和显式 SessionQuery reference（[E10](#e10)）；Goal 提供自有 prompt guidance（[E61](#e61)）；Planning 提供 current-revision context pack，不自动展开外部 transcript（[E56](#e56)）；Knowledge／Memory 暴露有界、经 owner 检查的 tool result，不静默注入整个库（[E21](#e21) [E24](#e24)）；Browser Observation／Task receipt 仍受 page／epoch 约束（[E51](#e51)），Cognition selected context 是 PR #73 的 active work，质量验收未闭合。Skill／Tool／Preset 通过 scoped registry 决定可见内容与 schema（[E27](#e27) [E06](#e06) [E29](#e29)）。Evidence 需经原 owner 获取，不默认全局可信（[E12](#e12)）；TokenMeter 测压力，不判语义 relevance（[E04](#e04)）。因此局部 freshness 归来源 owner，最终 admission 归 loop；没有仓库证据证明每次调用前都会自动取齐所有这些输入。

### H2 — System Constitution / Machine-readable Ownership

**Classification** — PARTIAL：operation enforcement 与 diagnostic 机制已存在，但仓库 companion／publication 合规未完整满足。

**Maturity** — 已确认 companion 合规缺口 L2；新 Constitution Plane 仍为 L0–L1 假设。

**FACT / Evidence** — Tool 执行强制 scoped visibility 与 monotonic guard；package-owned invariant 注册拒绝重复占有并回收 effects。静态检查验证 companion、namespace ownership 与省略理由；module／config／Cordis catalog 显示结构。[E06](#e06) [E07](#e07) [E08](#e08) [E05](#e05)

**Current owner / Existing contract** — Service Definition 与操作 owner 强制 mutation 边界，Cordis 拥有 topology／lifecycle，package checks 验证声明的依赖／发布规则，diagnostic companion 观察偏差。状态归 domain，不归 diagnostics registry。

**Planned owner / Explicit non-goal** — [PR #7](https://github.com/changanhua/deepseek-harness/pull/7) 是仓库 intelligence，不是 runtime constitution 权威。diagnostics 按组合可选；minimal SDK 挂 companion，base 并未普遍启用。observer 不替代操作时拒绝，也不保护任意 direct one-shot LLM call。

**Observed compliance limit** — exact base 与 audit head 的 verify-package-invariants 都失败，67 项输出完全相同：54 个空 companion installer、7 个位置不当的 client peer dependency、2 个无效 invariant export、2 个无效 publication file entry、2 个缺失省略理由。它们是静态 companion／publication 违规，不证明 operation-time refusal 失效；但不能再把机制存在理解为全库合规。另一个静态 graph check 在两版都报告 12 个缺失 service-role classification，详见第 12 节。

**Actual gap** — 自然语言 owner 文档会漂移：Skill README 否认的 diagnostics／shadow inspection 已由 managementSnapshot 和 Host projection 实现。这是文档准确性问题，不是 runtime ownership 缺失。[E42](#e42) [E27](#e27) [E26](#e26)

**Not a gap / Repeated need / Ownership collision** — 没有统一 graph 不会抹掉已有 enforcement。同一 README 的两条过时陈述不算两个独立 runtime 失败。中央规则引擎会重复领域拒绝逻辑，并可能削弱它。

**PROPOSAL / Recommendation** — 不新增 Constitution Plane；另行授权后修 companion／publication 合规与过时 owner 文案，再针对具体 invariant 核验 profile 覆盖。

### H3 — Cross-domain Provenance / Causal Trace

**Classification** — PARTIAL；强域内 provenance 已有，统一 causal query 必要性未证实。

**Maturity** — 统一 cross-link consumer 为 L1；已规划 Eval evidence 工作为 L2。

**FACT / Evidence** — Session 有稳定 id／seq、source relations、lineage 与 canonical trace；Delivery 将 evidence digest 绑定 Packet／Work／Attempt／check，并在人类 acceptance 前验证；Eval 保留 revision／route／fixture／Session，但 evidenceRefs 是字符串，不等同 Delivery EvidenceRef。[E09](#e09) [E10](#e10) [E11](#e11) [E12](#e12) [E13](#e13) [E14](#e14)

**Current owner / Existing contract** — Session／SessionQuery、Delivery／Evidence、Queue、Eval 各自拥有身份和验证。Content 捕获已验证 settled Session 来源，Memory decision 绑定 exact revision 与 human command identity。同名字符串或任意 URI 不自动成为 causal edge。

| Requested chain segment | Evidence | Boundary |
| --- | --- | --- |
| Requirement → RIR → Planning | 可选 RIR 路径：仅规格；baseline 与 advice refs 已规划 | 非强制 gate，也非唯一 Planning 入口 |
| Requirement → Planning / Planning → Goal | Planning 可不经 RIR 捕获来源并 adopt revision [E33](#e33) [E35](#e35)；未核实 typed Plan-revision→Goal bridge | 首边已有；次边仍不确定 |
| Planning → Delivery → Queue → evidence → human acceptance | 已有 Board handoff／Packet／Attempt／check 绑定 [E62](#e62) [E11](#e11) [E12](#e12) | 这些 owner 范围内已实现 |
| Goal ↔ Agent / Queue terminal → Goal | Goal 在 Session；已有终态通知；冷 activation 归 [#42](https://github.com/changanhua/deepseek-harness/issues/42) | 已有 + planned |
| Tool action → SSP → Domain artifact | 不同分支已有 SSP 内核和 immutable domain refs [E39](#e39) [E55](#e55) | 生产桥接未证实 |
| Artifact / Session → Eval → acceptance | 已有 Session／fixture refs；强真实 evidence 与 Gate consumer 归 [#55](https://github.com/changanhua/deepseek-harness/issues/55) [#58](https://github.com/changanhua/deepseek-harness/issues/58) | partial／planned；非通用 acceptance |

**Planned owner / Explicit non-goal** — [#55](https://github.com/changanhua/deepseek-harness/issues/55) 拥有 Eval evidence，[#58](https://github.com/changanhua/deepseek-harness/issues/58) 桥接 Gate consumer。Session trace 是有界 direct citation／replacement 语义，不是任意递归全局因果。未见 accepted spec 要求第二 event store。

**Actual gap / Repeated need** — 未验证到覆盖整条设想链的单一查询，但这不能证明底层 identity 缺失或必须新建存储。未建立两个当前失败的跨域追查案例。

**Not a gap / Ownership collision** — 不可用 telemetry graph 取代 Session fold、Delivery integrity 或 owner authorization。查询可视化／typed link consumer 与 durable fact owner 是不同问题。

**PROPOSAL / Recommendation** — observe；仅针对真实追查需求扩展只读 consumer，解析原 owner refs，不复制事实。

### H4 — Generic Runtime / Execution Environment

**Classification** — 新通用 runtime 为 HYPOTHESIS；现有 scoped runtime 已实现，Eval 复用为 PLANNED。

**Maturity** — L1；Eval 隔离整合 L2，不构成新 Plane 证据。

**FACT / Evidence** — RepositoryWorkspace 拥有 verified commit／worktree lease／cleanup；Queue 拥有 Attempt settlement／unknown；Browser 拥有 grant／epoch／receipt／quiescence；SSP lease 保护副作用准入，不提供 cwd／process／network。这些保护对象不同。[E15](#e15) [E16](#e16) [E51](#e51) [E39](#e39)

**Current owner / Existing contract** — Checkout：exact revision、Attempt marker、进程 quiescence 后 checkpoint、remove／preserve。Queue：admission、resource claims、prepare／start、cancel／drain、unknown recovery。Browser：exact page／epoch 与仅状态 reconciliation。SSP：approval／risk／CAS 与 opaque admitted handle。

**Planned owner / Explicit non-goal** — [#52](https://github.com/changanhua/deepseek-harness/issues/52) 明确为 Eval cell 复用 RepositoryWorkspace；[#53](https://github.com/changanhua/deepseek-harness/issues/53)／[#59](https://github.com/changanhua/deepseek-harness/issues/59) 负责 subject／grader／controller 隔离。回放 harness 的临时 DSH_HOME 与环境继承不能证明 secret、network、OS 隔离。[E52](#e52)

**Actual gap / Repeated need** — 可信 Eval 执行尚未完成，但已有 owner。未建立两个同合同、真实未满足的 runtime 用例。Delivery + planned Eval 反而证明应复用已有 lease，不是复制它。

**Not a gap / Ownership collision** — 都叫 lease 不代表 authority／recovery 可互换。若新 manager 同时拥有 credential、workspace、Browser 写操作、Queue retry 与 approval，就会成为 God Plane。

**PROPOSAL / Recommendation** — 通用架构 do nothing；先完成并验证 #52／#53／#59 的有限合同。

### H5 — External Trigger Integration

**Classification** — Queue→Goal Activation 为 PLANNED；后续 Schedule／Webhook／email／IM bridge 为 DEFERRED_BY_DESIGN。

**Maturity** — 已确认冷续跑未闭合为 L2；统一 external-event 抽象为 L1。

**FACT / Evidence** — Webhook 已经 adapter authentication，将 verified delivery 派发到 Workspace Session，但无 durable dedup／receipt／replay。Schedule 为 live root Agent 持久化提醒，cold 后变 overdue。Queue 通知在后续 pre-step 注入，不唤醒冷 Session。[E18](#e18) [E19](#e19) [E20](#e20)

**Current owner / Existing contract** — Webhook 拥有入口验证与 trusted routing，Schedule 拥有 live reminder，Queue 拥有 terminal fact，Goal 拥有 objective，普通 Session activation 拥有恢复接入。这些合同已存在，不是缺一套 scheduler。

**Planned owner / Explicit non-goal** — [#42](https://github.com/changanhua/deepseek-harness/issues/42) 已规定 Activation Grant／Request／Receipt、trigger identity、过期／撤销／次数、确定性握手／reconciliation、flush 后消费和一次 Goal round；排除 Schedule／Webhook／email／IM、任意 prompt cron／DAG、分布式 exactly-once。所查计划没有冻结 Git／file／browser event 的通用 bridge 合同。

**Actual gap / Repeated need** — 具体冷续跑是真实既定工作，不是无 owner。Queue 完成、timer 到期、webhook 到达对应不同产品承诺，不能凑成同一缺失框架的三次失败。

**Not a gap / Ownership collision** — 没有依据另建 scheduler、authentication 系统或 Agent loop。未来 bridge 必须保留 ingress owner 的 verified identity 与 Activation 的 grant 限制；HTTP receipt 不是执行完成。

**PROPOSAL / Recommendation** — 沿现有 #42 bridge 扩展既有 owner；其他 bridge 等真实 trigger case 出现后逐项设计。

### H6 — Knowledge Governance

**Classification** — 总体 PARTIAL；在既定范围内，persistence、provenance、review／promotion、freshness 均已有。

**Maturity** — 更广语义／跨库治理 L1；既有生命周期 N/A。

**FACT / Evidence** — Knowledge 验证 source snapshot／citation，以 stage input／review hash 防漂移，传播依赖 stale，只在当前检查通过后发布 immutable release。Memory 有 candidate／accept／reconfirm／retire 历史、exact human revision decision、source SHA、复查期限与冲突抑制。Content 有 immutable version 与独立 draft。[E21](#e21) [E22](#e22) [E23](#e23) [E24](#e24) [E25](#e25)

**Current owner / Existing contract** — Content 拥有保存的用户文本，KnowledgeBase 拥有 source-backed 知识编写与发布，projectMemory 拥有可复用项目 claim 与 eligibility。Storage 提供持久化但不接管领域权限。人类 acceptance 允许复用，不等于事实真实性证明。

**Planned owner / Explicit non-goal** — Knowledge 将语义重复／矛盾检查标为 `not_run`；Memory 的 lexical／topic matching 不检测任意语义冲突，也不自动抽取。可选组合确实存在，但并非所有部署默认启用。[E21](#e21) [E46](#e46) [#40](https://github.com/changanhua/deepseek-harness/issues/40) 将更广知识整合推迟到前序闭环证据之后。

**Actual gap** — A retrieval：已有 lexical 与 Session full-text，语义召回仍有限；B persistent knowledge：已有；C provenance：已有；D review／promotion：已有；E freshness／supersession：已有来源失效、复查过期、active revision／current release 与 retirement。剩余语义关系检测与跨库 policy 尚未被证明是通用系统缺口。

**Not a gap / Repeated need / Ownership collision** — 未核实两个必须用统一 Memory governor 解决的当前语义漏判案例。saved Content、accepted Memory、published Knowledge 不是可互换信任等级。自动 promotion 会冲撞现有人类 authority。

**PROPOSAL / Recommendation** — observe；保留既有治理。真实矛盾重复出现时，在所属 Knowledge／Memory service 内扩展 advisory check 与人工裁决，不建第二 store 或全局真相引擎。

### H7 — Capability Lifecycle / Supply Chain

**Classification** — PARTIAL；各类 capability 已有生命周期，剩余限制需按 owner 缩窄。

**Maturity** — 以下已验证局部遗漏 L2；新统一 lifecycle authority 仍为 L1。

**FACT / Evidence** — Tool 有 scoped 执行／disposal／guard；Skill 有 provider、invalidation、selection、diagnostics、shadow inspection；Preset 有 generation isolation 与边界检查 swap；MCP 有 generation-bound reconnect／refresh／disposal。Host capabilityRegistry 是 scoped 只读投影，不是安装权限 owner。[E06](#e06) [E27](#e27) [E29](#e29) [E30](#e30) [E26](#e26)

**Current owner / Existing contract** — installation／version：profile package manager 与 manifest／lockfile；activation：Loader；tool permission：ToolRuntime；Skill content／freshness：provider／registry；Preset replacement：generation owner；MCP connection health：connection supervisor。deprecation／replacement 按类型分治，不是共用 enum。CLI plugin transaction 与 Desktop shell-owned installation 已存在。[E57](#e57)

**Planned owner / Explicit non-goal** — [#44](https://github.com/changanhua/deepseek-harness/issues/44)／[#58](https://github.com/changanhua/deepseek-harness/issues/58) 规划能力评测门，不是另建 registry。MCP tools-only bridge 与模型侧 Skill body 版本通知有明确范围限制。Host 只读投影不能悄悄取得安装／权限修改权。

**Actual gap** — 三个具体 owner 遗漏：MCP connection state／last sync 未暴露到管理投影；无效 filesystem Skill 在进入 registry 前只被日志记录并丢弃，未进入 provider diagnostics；superseded Preset generation 缺少 joined-agent 回收记账。已查 active owner 增量没有这些修复。[E26](#e26) [E28](#e28) [E29](#e29)

**Not a gap / Repeated need / Ownership collision** — registered tool 数量不等于连接健康；旧 Agent 仍在使用时保留 generation 是必要合同，不是 bug。未取得这些遗漏对应的两个真实当前失败／资源增长轨迹，不能达 L3。全局 manager 猜测 health 或杀 fiber 会违反原 owner。

**PROPOSAL / Recommendation** — 真实任务有需要时仅 extend existing owner：sanitized MCP status、已有 SkillProviderObservation diagnostics、Preset lifetime accounting。保留 generation identity／disposal，不建第二 capability store。

### H8 — Identity / Credential / Secret Authority

**Classification** — 跨部署隔离总体 PARTIAL；CredentialProvider 与 authority 边界已存在。

**Maturity** — 已规划 budget／isolation 未闭合 L2；新 Credential Plane 仍 L1。

**FACT / Evidence** — CredentialProvider 分离 reference、metadata 与 plugin-owned record，由 provider 逐操作解析并通过 human authorization flow 授权。同 OS user 文件访问被明确声明不构成 secret isolation。Browser grant／epoch、Host authority、provider credential、SSP approval 保护不同动作。[E31](#e31) [E32](#e32) [E51](#e51) [E39](#e39)

**Current owner / Existing contract** — Credentials 拥有解析／存储协议，各 provider 拥有 record 语义，Host 拥有可信入口，Browser 拥有 site／action grant，SSP 拥有 effect approval／admission。CredentialRef 定位 secret；authorization reference 允许具体操作，二者不能替换。

**Planned owner / Explicit non-goal** — [#50](https://github.com/changanhua/deepseek-harness/issues/50) [#51](https://github.com/changanhua/deepseek-harness/issues/51) [#53](https://github.com/changanhua/deepseek-harness/issues/53) [#59](https://github.com/changanhua/deepseek-harness/issues/59) 要求 Host-approved Eval credential／cost refs 及 controller／subject／verifier 分离；[#43](https://github.com/changanhua/deepseek-harness/issues/43) 定义用量预算，排除货币账单、chargeback、通用 RBAC、分布式配额。SSP risk accounting 不是 LLM usage settlement。

**Actual gap / Repeated need** — private path 或 isolated DSH_HOME 本身不能证明 hostile-subject 隔离；该需求已归 planned execution provider。没有重复证据支持把这些权限合成单一 credential service。本次只读合同，不读取 secret 值。

**Not a gap / Ownership collision** — secret 解析成功不等于获准消费；Browser-authenticated 操作不等于获准调用付费模型。合成一个 ledger 会混淆撤销、用量结算和不可逆 effect risk。

**PROPOSAL / Recommendation** — 扩展已规划 #43／#53／#59 owner，要求负向 cross-access 与 dispatch admission 验收；不新增全局 authority wrapper。

### H9 — Requirement Portfolio / Engineering Capital Allocation

**Classification** — PARTIAL；“没有组合排序 owner”已被部分证伪。

**Maturity** — 专门新增 portfolio owner 的必要性为 L1；未确认责任空缺。

**FACT / Evidence** — Planning 已持久化人工顺序、依赖、版本化八因子估计与 review。UI 以 value／urgency／reuse／compounding 减 time／token／risk／cognitive cost 生成跨 Plan suggestedOrder，因子未知则不评分；Queue 另行仲裁真实 resource capacity。[E33](#e33) [E34](#e34) [E35](#e35) [E17](#e17)

**Current owner / Existing contract** — Planning 仍是 canonical priority／order／dependency owner；用户决定、CAS、rationale、review、Session 记录、ResourceRef 已支持比较与留痕。Delivery approval／Queue execution 另有 owner。已有评分投影是被审计事实，不是本报告建议引入总分。

**Planned owner / Explicit non-goal** — RIR [PR #79](https://github.com/changanhua/deepseek-harness/pull/79) 规划 immutable 单 subject assessment、baseline drift、定性 allocation 与 advice route，WP1 排除 portfolio ordering／realized outcome learning。Budget [#43](https://github.com/changanhua/deepseek-harness/issues/43) 限制 runtime usage，不负责工程机会成本。[E38](#e38)

**Actual gap / Repeated need** — 未找到现有 Planning review／Session／refs 无法表达的具体必须动作。schema 没有专用 comparison record 不足以证明 gap；RIR 预定验收案例也不是重复失败的资本配置决定。

**Not a gap / Ownership collision** — 新 Portfolio Manager 容易重复 Planning order、RIR assessment、Budget settlement、Queue dispatch。投资建议不能变成 approval 或 canonical mutation。

**PROPOSAL / Recommendation** — observe；先用现有 Planning + 有界模型／人工比较 review；两次真实决定无法通过既有合同重建或落实时再审。

### H10 — Experience to System Improvement

**Classification** — PARTIAL；局部 runtime recovery 与人工改进闭环已存在。

**Maturity** — 通用自动 learner 为 L1；既有计划尚未闭合的验收归原 owner。

**FACT / Evidence** — BrowserTask 持久化 deterministic failure fingerprint，需 changed precondition 才解锁；Planning review 绑定 revision／outcome／lessons／follow-up refs；Memory promotion 由人类控制。两个已解决事故报告证明真实 failure→诊断→guardrail／test 修正，不证明两个未解决的新 learner 需求。[E36](#e36) [E37](#e37) [E35](#e35) [E23](#e23) [E53](#e53) [E54](#e54)

**Current owner / Existing contract** — Session feedback 拥有纠错事实，BrowserTask 拥有 task recovery，Planning 拥有 review／follow-up，Memory 拥有 usable claim，Eval 拥有回归证据，Skill maintenance 拥有经审阅修改。学习不产生新权限。

**Planned owner / Explicit non-goal** — Session Review 分支是实现候选，不自动触发、不晋升 memory、不改 Skill、不建 Issue；其 33 个替身测试声明不等于真实验收。私有 human-review Skill maintenance 提案只记录零 candidate 的部分试跑，不是已完成晋升。[E40](#e40) [E41](#e41) [#44](https://github.com/changanhua/deepseek-harness/issues/44) [#58](https://github.com/changanhua/deepseek-harness/issues/58) [#61](https://github.com/changanhua/deepseek-harness/issues/61) 规划其他评测／编写连接；RIR outcome learning 明确 deferred。

**Actual gap / Repeated need** — 未验证从任意 friction 到经审阅 rule／Skill／Eval／Knowledge 变更的通用自动链；已有局部闭环和禁止自动晋升边界很实质。未建立两个当前未满足案例支持统一 Experience Compiler。

**Not a gap / Ownership collision** — 不可把历史失败当当前事实、自评当 acceptance、unknown 写当可重试，或把 experience 变第二状态库。仓库 intelligence／人类学习 PR 不等于产品自改进 runtime。

**PROPOSAL / Recommendation** — observe；先将一个已授权真实纠错沿现有 feedback、owner 修改、独立 Eval、人类 review 手工串联，测出增益再自动化。

## 5. Newly Discovered Gaps

以下是超出原假设标题的具体责任／限制；“新发现”不表示仓库 roadmap 以前不知道，也不授权本次审计实施。

### N1 — Trusted Eval execution and independent acceptance

**Classification / Maturity** — PLANNED / L2。

**FACT / Evidence** — master 验证 replay／report schema 与 fixture／Session identity，但不含 [#49](https://github.com/changanhua/deepseek-harness/issues/49)–[#60](https://github.com/changanhua/deepseek-harness/issues/60) 指定的完整 Host-approved live execution proof、隔离 subject／grader、durable strong evidence／Gate 链。[E13](#e13) [E14](#e14) [E52](#e52)

**Current owner / Existing contract / Planned owner** — Eval library／snapshot adapter；Session 记录实际 trace；RepositoryWorkspace 提供 lease；Queue 拥有 Attempt。planned Eval PlanProvider、execution provider、evidence owner 与窄 bridge 补剩余合同。

**Actual gap / Explicit non-goal** — 独立执行身份与验收不能从回放通过、manifest 声明或 Agent 自报推导；既定计划禁止第二 loop、workspace manager、generic artifact store。

**Not a gap / Repeated need / Ownership collision** — Eval 不是不存在。声明场景／测试不算多个新真实失败，本次未运行 provider。新建 Eval Plane 会重复已有工作。

**PROPOSAL / Recommendation** — extend existing owner；先补 roadmap 的 provenance／isolation 合同，再扩 dashboard 或声称可信 self-development。

### N2 — Unified runtime usage admission

**Classification / Maturity** — PLANNED / L2。

**FACT / Evidence** — TokenMeter 测量用量，Goal 限轮数，Queue 限资源并发；均不是 durable shared request／Token／wall-clock reservation ledger。[E04](#e04) [E43](#e43) [E17](#e17) [#43](https://github.com/changanhua/deepseek-harness/issues/43) 已定义该 ledger，涵盖 retry 和 prepared／direct stream enforcement。

**Current owner / Existing contract / Planned owner** — LLM runtime 拥有最终 dispatch，usage adapter 拥有实测用量；planned Budget 拥有 Scope／Limit／Reservation／Settlement／Decision，bridge 保留各 domain lifecycle。

**Actual gap / Explicit non-goal** — 原子父子 reservation、crash settlement、permission-to-spend 尚未闭合；排除货币账单、替换 Queue capacity 或 SSP risk accounting。

**Not a gap / Repeated need / Ownership collision** — 确有多个 consumer，但不支持第二 Budget／Policy engine。本次未测量真实经济损失或生产超额。

**PROPOSAL / Recommendation** — 沿 planned owner 扩展 adapter dispatch；保留 usage uncertainty，不编造精确成本。

### N3 — Owner prose contradicts existing management contracts

**Classification / Maturity** — owner 文档准确性 PARTIAL／L2；无需新系统权威。

**FACT / Evidence** — Skill README 写 diagnostics／shadow inspection 不存在，但 managementSnapshot 已暴露且 Host 已消费。[E42](#e42) [E27](#e27) [E26](#e26)

**Current owner / Existing contract / Planned owner** — Skill owner 文档及现有 source／tests／catalog checks；未定位 active 修复。此为源码／文案冲突，以实现优先。

**Actual gap / Explicit non-goal** — 结构 freshness gate 不能证明任意自然语言陈述正确。两条过时陈述证明文档误导，不证明 registry／permission engine 缺失。

**Not a gap / Repeated need / Ownership collision** — 两条都在同一 README，不满足两个独立真实系统用例。audit index 应链接 owner，不能变第二 canonical architecture catalog。

**PROPOSAL / Recommendation** — 窄化扩展已有文档验证；另行授权后修复。本次不改产品代码或旧文案。

### Investment judgement for confirmed remaining contracts

严重性与建设优先级不同。以下是定性审计推断，不是预测、总分，也不声称上游承诺提供替代。

| Responsibility | System leverage | Model substitution risk | Upstream substitution | No-build alternative | Wrong-abstraction risk | Reversibility | Evidence quality |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Eval 可信执行 | 跨 validation／Delivery／Goal 杠杆高 | 强模型不证明 isolation／identity | 通用 evaluator 可替代，DSH owner 绑定仍本地 | 未完成时用现有 replay + 人工独立验证 | 另建 runtime／store 风险高 | 现在复用 lease；UI 可后置 | 合同证据强；未重跑 live 验收 |
| Activation／未来 trigger | 无人值守续跑杠杆高 | 授权／撤销／dedup 不随模型消失 | 入口 adapter 可替代，grant 语义属 domain | 显式人工 resume；已有 live reminder | 替换 scheduler／认证风险高 | 窄 bridge 可逆；新 canonical scheduler 昂贵 | 一个冻结冷续跑 case；通用重复性未证实 |
| Budget 准入 | 跨 fan-out／retry／continuation 杠杆高 | 硬消费边界不是推理质量 | 通用 token accounting 可替代，不能直接替 exact DSH admission | 轮数／并发 cap 与人工监督仅部分替代 | 限定范围中等；通用 policy 高风险 | 广泛自动化前应冻结 ledger 语义 | 缺合同证据强；未测实际损失 |
| 能力诊断／回收 | 局部运维杠杆 | 模型能辅助诊断，不能靠猜安全回收 fiber | 通用工具可用，lifecycle 仍 owner-specific | 日志、受控 reload、已有管理视图 | 全局 manager 高；窄 owner read API 低 | 只读诊断易撤回，disposal 要谨慎 | 源码遗漏确认；缺重复真实事故 |
| owner 文案漂移 | 影响判断准确性，修复局部 | 强模型可查源码，漂移仍存在 | generator 有助结构，不能证明所有语义 | 修 owner 文案并对照 source review | 以此建 Constitution Plane 风险极高 | 文档修复易撤回 | 同 owner 两条陈述，矛盾证据强 |
| Invariant companion 合规 | 影响广泛诊断与 CI 一致性 | 强模型不会使无效 publication 合同变有效 | 通用 package 工具可替代，owner 声明仍属本地 | 复用已有 gate／review；无需新架构 | 扩成 Constitution Plane 风险高 | 窄 metadata／companion 修复可逆；保留真实 runtime check | 强：base／head 67 项一致；未证明 runtime refusal 失效 |

## 6. False Positives

| Initial appearance | Audit result | Reason |
| --- | --- | --- |
| 没有 Context owner | 原表述已证伪 | 已有 composition／Session request 权威；统一选择仍未证实 |
| 无 Constitution Plane 就无 enforcement | 已证伪 | 操作 guard、Definition 边界、package invariant check 已存在 |
| 缺 provenance／event store | 笼统说法已证伪 | 强 Session／Delivery 身份；部分 crosslink 已规划、Eval refs 较弱 |
| 所有 lease 应归 Generic Runtime | 未成立 | 保护对象／恢复义务不同；Eval 明确复用 RepoWorkspace |
| 缺 Memory／governance／promotion | 已证伪 | 已有 Knowledge review／stale／release 和 Memory human acceptance／expiry／retirement |
| 能力生命周期缺失 | 已证伪 | 按类型已有 installation、scope、version／generation、replacement、guard、diagnostics |
| 无 Credential Plane 就无 secret owner | 已证伪 | 已有 CredentialProvider；same-user isolation 与 cost authorization 是另一个问题 |
| RIR 已是投资引擎 | 已证伪 | PR #79 仅 spec；Planning 已有排序／估计 |
| 无 experience-learning loop | 笼统说法已证伪 | 已有 task recovery、人工事故改进、review／promotion 闭环 |
| SSP／Domain Runtime 未合入所以缺失 | 已证伪 | 未合入实现已存在；生产 effect／真实 capture 仍受限 |

明确拒绝的架构坏味道：复制 Planning／Queue／Session 事实；第二 Agent loop；为 trigger integration 新建 scheduler；在 refs／evidence 上方再造通用 Artifact store；覆盖 SSP／Host／human approval 的 policy engine；同时拥有 context／event／state／execution 的 God Plane；仅凭 FC27 或一个 Browser task 泛化。这些是提案风险，不是声称 master 已存在所有坏味道。

## 7. Cross-project Lessons

外部来源在内部假设与 active-work 审计后才查阅，仅提供已确认未闭合合同的实现经验，不作为 DSH 缺口证据。本次不做外部产品功能清单，也不建议直接引入供应商。

### GitHub webhook delivery

Observed pattern：delivery identity 在 redelivery 时不变，authentication 与 event／action validation 先于处理；失败投递不会自动 redeliver。Problem it solves：重复、丢失或伪造入口事件。DSH analogue：已有 VerifiedWebhookDelivery 缺 durable dedup／receipt，未来 Activation bridge 明确 deferred。Transferability：adapt 身份与 reconciliation 到未来窄 bridge，不替换 scheduler，也不把 HTTP 成功当业务完成。来源：[GitHub best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)、[failed delivery handling](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries)。

### LangSmith evaluation separation

Observed pattern：offline regression 用 curated examples 比较版本，code evaluator 与 model judge 是不同方式。Problem it solves：把 benchmark evidence 与生产印象分开，选择合适 oracle。DSH analogue：既有 Eval roadmap 需要可信执行证据与独立验收，不能只读 Agent 成功声明。Transferability：adapt 输入、实际 run、evaluator 的分离到已有 Eval 合同；展示方式仅 inspiration。该外部模式不证明 OS isolation，也不替代 DSH human approval。来源：[LangSmith evaluation types](https://docs.langchain.com/langsmith/evaluation-types)。

## 8. Architecture Candidates

本次没有新候选达到 L4。这不否定已有 Activation、Budget、Eval、RIR 设计，也不把它们升级成更大架构。两个实现都使用 lease／context／evidence 字样，不等于共享同一未满足责任。

## 9. Build Candidates

本次审计没有足够证据支持立即新增系统 Plane。没有新增 L5 build candidate。已有有限 Issue 保留各自规格、依赖与验收，本审计不构成实施授权，也不替代优先级决定。

## 10. Watchlist

| Watch item | Maturity | Evidence required to upgrade |
| --- | --- | --- |
| Context arbitration | L1 | 两个真实任务在已有局部限额下仍因 domain 输入竞争丢失必要信息，并保留 exact request／log |
| Causal query | L1 | 两个具体追查无法连通现有 typed identity／refs，先指出缺失边，再考虑 index |
| Generic Runtime | L1 | #52／#53 复用验收后，两个 domain 仍需同一无法表达的 lease 语义 |
| Knowledge semantics | L1 | 两个不同真实任务中 source-backed 矛盾 claim 漏检，保留人工判断 |
| Capability lifecycle omissions | L2 | 真实 MCP 排障、Skill 丢失、无人使用 generation 资源轨迹证明窄 owner 修改有收益 |
| Portfolio comparison | L1 | 两次真实配置决定无法由 Planning review、Session、refs 表达或重建 |
| Experience automation | L1 | 重复经审阅纠错证明超出既有人工闭环的增益，独立评估可拒绝不安全晋升 |
| Owner documentation accuracy | L2 | 矛盾陈述可定位到当前源码；修原 owner，不建平行 inventory |

模型升级可能显著降低定制 relevance scoring、portfolio reasoning、语义重复 heuristic、通用经验摘要器的收益，宜先用 prompt／Skill／人工 review 验证。它不会消除 durable identity、exact human authority、撤销、原子准入、来源有效性、独立执行证据的需要。这是架构推断，不是任何厂商发布预测。

## 11. Final Matrix

| Candidate | Classification | Maturity | Existing Owner | Evidence Strength | Recommended Action |
| --- | --- | --- | --- | --- | --- |
| H1 Cross-domain Context | PARTIAL | L1 | systemPrompt／loop／Session／domain contributors | 既有链强；重复缺口证据弱 | observe |
| H2 Ownership enforcement | PARTIAL | L2 | operation owner／Cordis／package checks | 机制已存在；67 项 baseline 合规违规 | 在已有检查内修复；不新建 Plane |
| H3 Causal trace | PARTIAL | L1 | SessionQuery／Delivery／Eval／Queue | 域内 provenance 强；全局查询需求不确定 | observe；复用 refs |
| H4 Generic Runtime | HYPOTHESIS | L1 | #52 复用既有 domain owner | 合同区别明确；抽象需求弱 | do nothing；复用 #52 |
| H5 External triggers | PLANNED | L2 | Activation #42 + ingress／Goal／Queue | 窄合同强；通用 bridge deferred | extend existing owners |
| H6 Knowledge governance | PARTIAL | L1 | KnowledgeBase／Memory／Content | 生命周期强；语义泛化弱 | observe |
| H7 Capability lifecycle | PARTIAL | L2 | Tool／Skill／Preset／MCP／Loader | 局部遗漏强；无重复事故证明 | 窄 owner 扩展 |
| H8 Credentials and authority | PARTIAL | L2 | Credentials／Host／Browser／Budget／Eval | 边界强；隔离验收未闭合 | 已有 planned owner |
| H9 Portfolio | PARTIAL | L1 | Planning；RIR assessment 已规划 | 排序已存在；新 owner 必要性未证实 | observe／no-build review |
| H10 Experience improvement | PARTIAL | L1 | feedback／Browser／Planning／Memory／Eval／Skill | 真实局部／人工闭环；通用自动化未证实 | observe |
| N1 Trusted Eval execution | PLANNED | L2 | Eval #49–#60 | 实现／roadmap 对照强 | extend existing owners |
| N2 Usage admission | PLANNED | L2 | Budget #43／LLM runtime | 有限未闭合合同证据强 | extend planned owner |
| N3 Owner prose drift | PARTIAL | L2 | Skill owner docs／source checks | 直接 source／prose 矛盾 | 另行修 owner 文档 |

PARTIAL 行的 maturity 指所述剩余问题，不是既有产品成熟度。H5 的未来 ingress bridge 为 DEFERRED_BY_DESIGN，H9 的新专门 owner 仍为 HYPOTHESIS。不计算总分，也不因缺 package 名、专用 record 或统一 dashboard 就标 CONFIRMED_GAP。

## 12. Verification and Evidence

审计范围：master source／schema／service definition／runtime wiring／profile patch，root／package／docs AGENTS，architecture／subsystem／owner README 与 active decision note，active spec、全部可见 open Issue／PR 和相关 branch code。不把 archived note 当当前权威。本次没有产品实现、重构、真实 provider request 或 Browser／FC 业务写操作；只交付本审计与双语配对。

位置：按要求使用 docs/audits，存放有日期的参考快照。状态与固定 commit 是审计证据，不是滚动架构权威。本文件不修改 owner 合同，不形成架构决定。已有矛盾文案和 unrelated baseline failure 均不顺手修复。

复现方式：checkout exact baseline，通过下方固定源码链接复查；active ref 按记录 commit 比较，不按当前 branch tip。远端状态会变化，open Issue／PR 搜索应另行重做。否定结论限于已查 owner 与可见来源；私有本地工作、secret 值、实际部署状态、未披露分支不在证据范围。

写文档前已运行 baseline 静态检查：verify-md-links 报 19 项，verify-md-wrap 报 36 项，verify-translation-pairing 报 136 项。仓库 test:docs wrapper 在进入 gate 前因 tsx CLI 无法打开本地 IPC pipe（EPERM）失败；使用 node --import tsx 直接入口完成上述三项检查。这些是 baseline／工具结果，不是审计新增缺陷。本地审计未运行产品测试、完整 build、完整 lint／doc-sync 或 live model／browser 验收；远端 CI 执行另列于下文。

最终聚焦验证结果记录在交付 PR 或附带交付说明：检查 source citation 存在性／行号、双语结构、Markdown link／wrap、patch 范围与 exact baseline，不改产品代码。源码测试与 PR 自报验收仅作为已读证据，不冒充本次重跑。

### CI follow-up on the audit delivery

首个审计提交 70e3ab330b6934a0cd7e8817772bbf2ed9099fb4 的两项 CI workflow 失败。Linux 在 verify-package-invariants 报 H2 所述 67 项，exact baseline 与 head 静态输出逐字一致；该 CI 未执行到后续 verify-doc-graphs --check。另行在两版做只读检查，都报告相同 12 个缺失 role classification：browser、browserActivity、browserMonitor、browserTasks、content、contentBrowser、contentRemote、contentSession、knowledgeBase、knowledgeQueue、planning、planningDelivery。stack trace 的绝对 checkout 路径不同，所以 graph 仅语义错误相同。本次只记录，不修复。[Linux job](https://github.com/changanhua/deepseek-harness/actions/runs/36777835841/job/110100135072)。

Windows repository build 通过，随后 personal-source-distribution 测试 1 过 1 失败：5 个 plugin 未激活。session-projection-cache／delivery-local 等待 storageDomain；delivery-task-queue／delivery-remote 等待 delivery；runtime-probe 等待 delivery／deliveryRemote。相关产品源码、配置、fixture、workflow、lockfile 与 exact baseline 无差异，未发现文档引入原因；但未独立重跑 Windows baseline runtime，故运行时原因仍未确认。C0 在 scope detection 后 job 显示成功，实质 gate／test 均跳过，不能称 C0 测试通过。失败步骤后的 Client typecheck 未执行。[Windows job](https://github.com/changanhua/deepseek-harness/actions/runs/36777835811/job/110100135124)、[C0 scope job](https://github.com/changanhua/deepseek-harness/actions/runs/36777835811/job/110100135286)。

CI 运行 synthetic merge commit b1296a34bc4859622f6533595772eac53049ea90，其 tree c71401bc9c3d1226420da95cefb10991fcbf4b91 已独立确认与首个审计提交相同。本地静态 baseline 比较使用 exact baseline 与 audit head，不使用无关分支。

### Frozen branch inventory and negative-search boundary

以下 56 个 ref 是排除性检查使用的完整可见分支快照。目录证据可用 git ls-tree -r --name-only COMMIT 与 git rev-parse COMMIT:packages/eval 复现；未合入 owner 工作按 git merge-base(BASELINE, COMMIT) 到 COMMIT 做 git diff --name-status，路径限定 packages/mcp、packages/skill、packages/preset，并另查 Eval／Goal／Workflow／Queue／LLM owner。缺 package 名只是一个探针，实现结论同时使用上文源码与 Issue 合同。

| Branch at snapshot | Commit | packages/eval tree |
| --- | --- | --- |
| `architecture-explorer-assets` | [`4032b71f2a0e1e6c06ac1350bea495f3d4e11539`](https://github.com/changanhua/deepseek-harness/commit/4032b71f2a0e1e6c06ac1350bea495f3d4e11539) | — |
| `codex/architecture-explorer` | [`7d4adda41c72753a1a127d9de36f6a6527470276`](https://github.com/changanhua/deepseek-harness/commit/7d4adda41c72753a1a127d9de36f6a6527470276) | — |
| `codex/architecture-explorer-base` | [`7606e15ab69836d053b3ac2c35e1c7a4281f9b1e`](https://github.com/changanhua/deepseek-harness/commit/7606e15ab69836d053b3ac2c35e1c7a4281f9b1e) | — |
| `codex/browser-cognition-alignment-20260923` | [`0626052e73bed8799b8baef0a82e930453892e83`](https://github.com/changanhua/deepseek-harness/commit/0626052e73bed8799b8baef0a82e930453892e83) | `697218857e06427b5e6d900b4f8c8d21f7f0b715` |
| `codex/browser-page-model-v1` | [`a10b51ce0dbd884ec246c62e4c8381516202abfb`](https://github.com/changanhua/deepseek-harness/commit/a10b51ce0dbd884ec246c62e4c8381516202abfb) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/browser-semantic-map` | [`373adc182f539c2fbba0097cbb5c996e893471ca`](https://github.com/changanhua/deepseek-harness/commit/373adc182f539c2fbba0097cbb5c996e893471ca) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/control-mcp-isolated` | [`14ab024ee62ccc1a25305ec149a47fbea45b7cfe`](https://github.com/changanhua/deepseek-harness/commit/14ab024ee62ccc1a25305ec149a47fbea45b7cfe) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/delivery-c0` | [`f6c961c44e05cc8d7eb1c1704a8bd682463b1ebd`](https://github.com/changanhua/deepseek-harness/commit/f6c961c44e05cc8d7eb1c1704a8bd682463b1ebd) | — |
| `codex/delivery-c0-windows-durability-deps` | [`ed08c90a9e356e690af3e937d1171104aa6ec91d`](https://github.com/changanhua/deepseek-harness/commit/ed08c90a9e356e690af3e937d1171104aa6ec91d) | — |
| `codex/delivery-contract` | [`ce633df6c54f5291cb020a8bf59742ab51544d9d`](https://github.com/changanhua/deepseek-harness/commit/ce633df6c54f5291cb020a8bf59742ab51544d9d) | — |
| `codex/delivery-d1-local` | [`e127eee5090ddfa33fafec4729fcb200d2773a1f`](https://github.com/changanhua/deepseek-harness/commit/e127eee5090ddfa33fafec4729fcb200d2773a1f) | — |
| `codex/delivery-d2-workspace-evidence` | [`c807cdb779bc274ba5d528e8ba584f8ae59ec6a3`](https://github.com/changanhua/deepseek-harness/commit/c807cdb779bc274ba5d528e8ba584f8ae59ec6a3) | — |
| `codex/delivery-d3-codex-runner` | [`8bc5f4ef8f83dba51b314419332d8e9b10ebff51`](https://github.com/changanhua/deepseek-harness/commit/8bc5f4ef8f83dba51b314419332d8e9b10ebff51) | — |
| `codex/delivery-d4-verifier` | [`9b45563c3b9f0b2ca7a789bbea23291ee323628c`](https://github.com/changanhua/deepseek-harness/commit/9b45563c3b9f0b2ca7a789bbea23291ee323628c) | — |
| `codex/delivery-d5-github-intake` | [`b9093af522ed99bbf7a997d5269e420fbd0f7dac`](https://github.com/changanhua/deepseek-harness/commit/b9093af522ed99bbf7a997d5269e420fbd0f7dac) | — |
| `codex/delivery-d6-remote-ui` | [`68deab5836c872199d90b683d23a4dbfecc7d86d`](https://github.com/changanhua/deepseek-harness/commit/68deab5836c872199d90b683d23a4dbfecc7d86d) | — |
| `codex/delivery-gate-b-proof` | [`a580dcb1917454b76a18960201eb45fcde298634`](https://github.com/changanhua/deepseek-harness/commit/a580dcb1917454b76a18960201eb45fcde298634) | — |
| `codex/delivery-i1-queue-bridge` | [`36a4f57ed1ae7c9cfe3bda3873b271df0f5a2427`](https://github.com/changanhua/deepseek-harness/commit/36a4f57ed1ae7c9cfe3bda3873b271df0f5a2427) | — |
| `codex/delivery-i2-bundle-e2e` | [`2e3b29ca1a8972ba51c99e35fcfbe7a689bc42d6`](https://github.com/changanhua/deepseek-harness/commit/2e3b29ca1a8972ba51c99e35fcfbe7a689bc42d6) | — |
| `codex/delivery-queue-readiness` | [`858892b33a0b168272d36b3c8cdfd5073f456d6f`](https://github.com/changanhua/deepseek-harness/commit/858892b33a0b168272d36b3c8cdfd5073f456d6f) | — |
| `codex/delivery-spike-codex` | [`1df9b53b2c56cda31ff8e80a969eb6c94b8e3251`](https://github.com/changanhua/deepseek-harness/commit/1df9b53b2c56cda31ff8e80a969eb6c94b8e3251) | — |
| `codex/delivery-spike-queue` | [`bf3e3ddeda3fb3c19d1ebb15311eaa62fa2b499d`](https://github.com/changanhua/deepseek-harness/commit/bf3e3ddeda3fb3c19d1ebb15311eaa62fa2b499d) | — |
| `codex/downstream-governance` | [`f2b2fb0b4603863cfe6026ad78a890adbef2188c`](https://github.com/changanhua/deepseek-harness/commit/f2b2fb0b4603863cfe6026ad78a890adbef2188c) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/downstream-maintenance-policy-port` | [`9d052f241ea3aa842873efaf867b6254843eda38`](https://github.com/changanhua/deepseek-harness/commit/9d052f241ea3aa842873efaf867b6254843eda38) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/eval-scenario-design` | [`7f8927a73e066046df64d73dddf06dbe76eb60fb`](https://github.com/changanhua/deepseek-harness/commit/7f8927a73e066046df64d73dddf06dbe76eb60fb) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/fork-linux-compute` | [`1eb34610ca88e8bc2b05079f6350d49710d90fce`](https://github.com/changanhua/deepseek-harness/commit/1eb34610ca88e8bc2b05079f6350d49710d90fce) | — |
| `codex/fork-linux-compute-master` | [`2a7bf484afb7ec4abf6d0d4733591337ffa3f96d`](https://github.com/changanhua/deepseek-harness/commit/2a7bf484afb7ec4abf6d0d4733591337ffa3f96d) | — |
| `codex/fork-windows-ci` | [`21acf271d364c0dacaec691f51229f199561e581`](https://github.com/changanhua/deepseek-harness/commit/21acf271d364c0dacaec691f51229f199561e581) | — |
| `codex/fork-windows-ci-args` | [`f75144dbc0c8c22792c1f459216ac5b896a5d331`](https://github.com/changanhua/deepseek-harness/commit/f75144dbc0c8c22792c1f459216ac5b896a5d331) | — |
| `codex/fork-windows-ci-pnpm` | [`7bee0add32fb6f4a73cbf61e7963dd7316a7de0b`](https://github.com/changanhua/deepseek-harness/commit/7bee0add32fb6f4a73cbf61e7963dd7316a7de0b) | — |
| `codex/fork-windows-ci-scope` | [`7945fcf580faef789d8d16b90f380449435e71f1`](https://github.com/changanhua/deepseek-harness/commit/7945fcf580faef789d8d16b90f380449435e71f1) | — |
| `codex/incremental-planning` | [`ee35ae9398f9e2bf4a848822390122ed30372db9`](https://github.com/changanhua/deepseek-harness/commit/ee35ae9398f9e2bf4a848822390122ed30372db9) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/master-backup-before-upstream-candidate-20260915` | [`d3421cf170d6729978d93f22db40b633274ec5a9`](https://github.com/changanhua/deepseek-harness/commit/d3421cf170d6729978d93f22db40b633274ec5a9) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/merge-reuse-agent-instructions` | [`e2af960a81b97159d392e324bdeafcc23e60e591`](https://github.com/changanhua/deepseek-harness/commit/e2af960a81b97159d392e324bdeafcc23e60e591) | — |
| `codex/pcp-composition-proposal` | [`6aa2a0e66816ba3483c59d1c4de2e99dff650779`](https://github.com/changanhua/deepseek-harness/commit/6aa2a0e66816ba3483c59d1c4de2e99dff650779) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/personal-delivery-foundation` | [`527338cf077a475e82b718faa12cc16bfc82283f`](https://github.com/changanhua/deepseek-harness/commit/527338cf077a475e82b718faa12cc16bfc82283f) | — |
| `codex/personal-delivery-rollup` | [`f3e056333e0dc80fa7db379065857b0c9523ef21`](https://github.com/changanhua/deepseek-harness/commit/f3e056333e0dc80fa7db379065857b0c9523ef21) | — |
| `codex/personal-mainline-integration` | [`ae2fa15c1289aa3161feccf422ba4abb3857daec`](https://github.com/changanhua/deepseek-harness/commit/ae2fa15c1289aa3161feccf422ba4abb3857daec) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/planning-ui-workspace` | [`78a9d52c2accbdf5e026b4114a86a4285bbf0e5b`](https://github.com/changanhua/deepseek-harness/commit/78a9d52c2accbdf5e026b4114a86a4285bbf0e5b) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/pr1-tool-terminal-state` | [`a3a1b95f771b9feca986d071e916ac6f28243d59`](https://github.com/changanhua/deepseek-harness/commit/a3a1b95f771b9feca986d071e916ac6f28243d59) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/project-context-baseline` | [`8c5cfc4440aa17d2224664053b73ce64b99981d9`](https://github.com/changanhua/deepseek-harness/commit/8c5cfc4440aa17d2224664053b73ce64b99981d9) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/project-memory-mainline` | [`c2798b2e804a61936c0da431300af65cfb798636`](https://github.com/changanhua/deepseek-harness/commit/c2798b2e804a61936c0da431300af65cfb798636) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/requirement-investment-review-wp1` | [`3e670dd29ca056fff8efb831d9ee3693024d3755`](https://github.com/changanhua/deepseek-harness/commit/3e670dd29ca056fff8efb831d9ee3693024d3755) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/session-review-v0` | [`8e41cc18d55427f011423df027b0f1930b4a25e7`](https://github.com/changanhua/deepseek-harness/commit/8e41cc18d55427f011423df027b0f1930b4a25e7) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/side-effect-safety-plane` | [`a607f579d781aab0ef247dd1089198c5110f95a2`](https://github.com/changanhua/deepseek-harness/commit/a607f579d781aab0ef247dd1089198c5110f95a2) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `codex/task-queue-service-authorization` | [`9df74bfc4c1e5213c79af8d3c5c9c14deb03d1e2`](https://github.com/changanhua/deepseek-harness/commit/9df74bfc4c1e5213c79af8d3c5c9c14deb03d1e2) | — |
| `codex/working-context-v0` | [`eb00de8d41df7e4bb1ea89b62882efed63945f90`](https://github.com/changanhua/deepseek-harness/commit/eb00de8d41df7e4bb1ea89b62882efed63945f90) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `docs/architecture-intelligence` | [`0d1ea7303298aa0562673a8fae1738e083a4e25b`](https://github.com/changanhua/deepseek-harness/commit/0d1ea7303298aa0562673a8fae1738e083a4e25b) | — |
| `docs/runtime-awareness-clean` | [`8ae68fc1a23b8ce3137a76bd23b90748a1524945`](https://github.com/changanhua/deepseek-harness/commit/8ae68fc1a23b8ce3137a76bd23b90748a1524945) | — |
| `docs/runtime-awareness-design` | [`e1085c49c38da0b8604b416924f1c5491851b1ce`](https://github.com/changanhua/deepseek-harness/commit/e1085c49c38da0b8604b416924f1c5491851b1ce) | — |
| `dot/domain-runtime-plane` | [`7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2`](https://github.com/changanhua/deepseek-harness/commit/7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `integrate/ssp-wp1` | [`f64e9699ef5d2f1aeec954f3356b940a5eca136e`](https://github.com/changanhua/deepseek-harness/commit/f64e9699ef5d2f1aeec954f3356b940a5eca136e) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `intelligence/phase0` | [`f425ef240f4c287ab6b34a18789ae4bc97a8f5c7`](https://github.com/changanhua/deepseek-harness/commit/f425ef240f4c287ab6b34a18789ae4bc97a8f5c7) | — |
| `learning/dsh-mastery-course` | [`e421f9dc5d9f93c64247f06c7c8ddfc6883e3de1`](https://github.com/changanhua/deepseek-harness/commit/e421f9dc5d9f93c64247f06c7c8ddfc6883e3de1) | — |
| `master` | [`b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`](https://github.com/changanhua/deepseek-harness/commit/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3) | `6d26daaa097d396c1f726d8905700158f546e8d3` |
| `tmp/task5-runtime-inspect-trigger` | [`54be7b0e31ec5ec9c40a665061018c7212394bc2`](https://github.com/changanhua/deepseek-harness/commit/54be7b0e31ec5ec9c40a665061018c7212394bc2) | — |

扫描摘要：22 个 head 含 packages/eval，21 个与 baseline 同树；另一个 cognition 分支修改 invariant companion／文档／构建元数据，没有新增可信 Eval executor。全部可见 head 的未合入 MCP／Skill／Preset owner 增量仅为 Planning 分支的两个 Thinking Desk preset 文件；Goal／Workflow 无未合入 owner 变更，已查 Queue／Eval 变更与旧 LLM 类型扩展不实现 #42／#43／#49。这是有边界的源码证据，不是对未披露工作或任意别名的不存在证明。

### Pinned source ledger

每个 E 引用定位具体仓库文件、符号与 commit；行号按该 Git object 校验。非 master source 明确固定到分支 commit。行号指向核心合同，符号说明可注明邻近其他方法。

<a id="e01"></a>

**E01** — [`packages/core/system-prompt/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/core/system-prompt/src/index.ts#L553-L627) — `SystemPrompt.assemble`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e02"></a>

**E02** — [`packages/core/agent-loop/src/agent.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/core/agent-loop/src/agent.ts#L240-L270) — `preStep; request construction also at 542–629`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e03"></a>

**E03** — [`packages/core/agent-loop/src/runtime-context.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/core/agent-loop/src/runtime-context.ts#L83-L157) — `SystemPromptProjection; RuntimeContextProjection`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e04"></a>

**E04** — [`packages/llm/token-meter/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/llm/token-meter/src/index.ts#L100-L214) — `TokenMeter.measure`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e05"></a>

**E05** — [`packages/core/agent-loop/src/invariant.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/core/agent-loop/src/invariant.ts#L19-L56) — `assert log-derived frozen loop request`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e06"></a>

**E06** — [`packages/core/tools/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/core/tools/src/index.ts#L1466-L1506) — `guarded ToolRuntime execution`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e07"></a>

**E07** — [`packages/runtime-diagnostics/invariants/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/runtime-diagnostics/invariants/src/index.ts#L136-L194) — `InvariantRegistry.register`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e08"></a>

**E08** — [`scripts/package-invariants.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/scripts/package-invariants.ts#L191-L340) — `companion registration and omission validation`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e09"></a>

**E09** — [`packages/core/session/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/core/session/src/index.ts#L669-L744) — `append validation; owned sequence and source event references`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e10"></a>

**E10** — [`packages/session-query/session-query/src/tracing.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/session-query/session-query/src/tracing.ts#L26-L106) — `canonical foldSurface and traceEvent`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e11"></a>

**E11** — [`packages/delivery/delivery-protocol/src/schemas.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/delivery/delivery-protocol/src/schemas.ts#L658-L699) — `human acceptance decision and typed EvidenceRef provenance`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e12"></a>

**E12** — [`packages/delivery/delivery-local/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/delivery/delivery-local/src/index.ts#L940-L1019) — `evidence resolution and acceptance provenance validation`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e13"></a>

**E13** — [`packages/eval/eval/src/run.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/eval/eval/src/run.ts#L47-L70) — `evalCaseResultSchema; evalRunSchema`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e14"></a>

**E14** — [`packages/eval/eval-session-snapshot/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/eval/eval-session-snapshot/src/index.ts#L135-L211) — `recorded identity validation and Session/fixture refs`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e15"></a>

**E15** — [`packages/delivery/repo-workspace/src/types.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/delivery/repo-workspace/src/types.ts#L86-L148) — `change and verification workspace lease contracts`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e16"></a>

**E16** — [`packages/task-queue/task-queue-local/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/task-queue/task-queue-local/src/index.ts#L445-L576) — `claimNext and Attempt execution lifecycle`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e17"></a>

**E17** — [`packages/task-queue/task-queue-local/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/task-queue/task-queue-local/src/index.ts#L824-L859) — `resource and Batch capacity enforcement`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e18"></a>

**E18** — [`packages/webhook/webhook/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/webhook/webhook/src/index.ts#L57-L174) — `VerifiedWebhookDelivery dispatch and effect disposal`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e19"></a>

**E19** — [`packages/schedule/schedule/src/runtime.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/schedule/schedule/src/runtime.ts#L228-L316) — `live reminder maintenance and followup barrier`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e20"></a>

**E20** — [`packages/task-queue/tool-task-queue/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/task-queue/tool-task-queue/src/index.ts#L98-L159) — `pre-step notification injection; durable flush before ack`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e21"></a>

**E21** — [`packages/knowledge/knowledge-base/src/repository.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/knowledge/knowledge-base/src/repository.ts#L707-L848) — `immutable release; current publishability checks; semantic checks not_run`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e22"></a>

**E22** — [`packages/knowledge/knowledge-base/src/repository.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/knowledge/knowledge-base/src/repository.ts#L479-L508) — `current stage input and review fingerprints`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e23"></a>

**E23** — [`packages/memory/memory/src/schema.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/memory/memory/src/schema.ts#L14-L134) — `source-backed revisions and human decisions`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e24"></a>

**E24** — [`packages/memory/memory-local/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/memory/memory-local/src/index.ts#L105-L120) — `accept source and review deadline validation; eligibility at 210–231`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e25"></a>

**E25** — [`packages/content/content/src/schema.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/content/content/src/schema.ts#L48-L125) — `immutable content versions, draft fence, Session source`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e26"></a>

**E26** — [`packages/host/capability-registry/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/host/capability-registry/src/index.ts#L117-L218) — `read-only scoped inventory and MCP projection`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e27"></a>

**E27** — [`packages/skill/skill/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/skill/skill/src/index.ts#L614-L630) — `managementSnapshot; provider diagnostics at 786–847`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e28"></a>

**E28** — [`packages/skill/skill-filesystem/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/skill/skill-filesystem/src/index.ts#L814-L846) — `parseSkillFile: log and discard invalid candidates`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e29"></a>

**E29** — [`packages/preset/agent-presets/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/preset/agent-presets/src/index.ts#L730-L815) — `turn-boundary swap; superseded generation reclamation TODO`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e30"></a>

**E30** — [`packages/mcp/mcp-client/src/connection.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/mcp/mcp-client/src/connection.ts#L137-L287) — `generation-bound connection, refresh and retry lifecycle`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e31"></a>

**E31** — [`packages/credentials/credentials/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/credentials/credentials/src/index.ts#L170-L247) — `CredentialProvider reference and record APIs`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e32"></a>

**E32** — [`packages/credentials/credentials-local/README.md`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/credentials/credentials-local/README.md#L113-L115) — `same-user filesystem access is not secret isolation`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e33"></a>

**E33** — [`packages/planning/planning/src/schema.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/planning/planning/src/schema.ts#L95-L106) — `planningEstimateSchema; Board and mutations at 277–346`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e34"></a>

**E34** — [`packages/client/ui-planning/src/client/projections.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/client/ui-planning/src/client/projections.ts#L3-L25) — `planningPriorityScore`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e35"></a>

**E35** — [`packages/planning/planning-local/src/store.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/planning/planning-local/src/store.ts#L343-L389) — `manual order, dependencies, revision-bound reviews`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e36"></a>

**E36** — [`packages/browser/browser-task/src/failure.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/browser/browser-task/src/failure.ts#L4-L38) — `stable deterministic failure fingerprint`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e37"></a>

**E37** — [`packages/browser/browser-task/src/evidence.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/browser/browser-task/src/evidence.ts#L27-L49) — `changed-precondition recovery proof`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e38"></a>

**E38** — [`docs/specs/2026-10-01-requirement-investment-review-wp1.md`](https://github.com/changanhua/deepseek-harness/blob/3e670dd29ca056fff8efb831d9ee3693024d3755/docs/specs/2026-10-01-requirement-investment-review-wp1.md#L399-L438) — `RIR non-goals and reuse boundaries`; commit `3e670dd29ca056fff8efb831d9ee3693024d3755`.

<a id="e39"></a>

**E39** — [`packages/guard/side-effect-safety/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/f64e9699ef5d2f1aeec954f3356b940a5eca136e/packages/guard/side-effect-safety/src/index.ts#L75-L94) — `restart uncertainty; persist-before-send at 217–238`; commit `f64e9699ef5d2f1aeec954f3356b940a5eca136e`.

<a id="e40"></a>

**E40** — [`downstream/plugins/session-review/README.md`](https://github.com/changanhua/deepseek-harness/blob/8e41cc18d55427f011423df027b0f1930b4a25e7/downstream/plugins/session-review/README.md#L5-L24) — `implementation candidate; no automatic promotion`; commit `8e41cc18d55427f011423df027b0f1930b4a25e7`.

<a id="e41"></a>

**E41** — [`.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md#L33-L77) — `private maintenance proposal and partial trial evidence`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e42"></a>

**E42** — [`packages/skill/skill/README.md`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/skill/skill/README.md#L143-L152) — `stale negative statements about diagnostics and shadow inspection`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e43"></a>

**E43** — [`packages/goal/goal/README.md`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/goal/goal/README.md#L158-L161) — `goal state, round cap and scheduling boundary`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e44"></a>

**E44** — [`packages/workflow/workflow/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/workflow/workflow/src/index.ts) — `WorkflowEngine definition and run ownership`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e45"></a>

**E45** — [`packages/bundle/base/cordis.patch.yml`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/bundle/base/cordis.patch.yml) — `base profile composition`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e46"></a>

**E46** — [`packages/bundle/personal-memory/cordis.patch.yml`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/bundle/personal-memory/cordis.patch.yml) — `explicit Memory add-on`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e47"></a>

**E47** — [`packages/bundle/personal-delivery/cordis.patch.yml`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/bundle/personal-delivery/cordis.patch.yml) — `explicit Delivery composition`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e48"></a>

**E48** — [`packages/bundle/personal-planning/cordis.patch.yml`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/bundle/personal-planning/cordis.patch.yml) — `explicit Planning composition`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e49"></a>

**E49** — [`packages/context/runtime-facts/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/context/runtime-facts/src/index.ts#L160-L188) — `baseline relevance and exposure; freshness at 220–267`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e50"></a>

**E50** — [`packages/skill/tool-skill/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/skill/tool-skill/src/index.ts#L153-L174) — `invocation checks and full Skill body result`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e51"></a>

**E51** — [`packages/browser/browser-extension/README.md`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/browser/browser-extension/README.md#L30-L54) — `grant, epoch, page, receipt and quiescence boundaries`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e52"></a>

**E52** — [`packages/test-support/session-snapshot/src/launcher.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/test-support/session-snapshot/src/launcher.ts#L119-L143) — `formal profile launch; environment inheritance`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e53"></a>

**E53** — [`docs/postmortem/0003-web-agent-gui-feedback-loop.md`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/docs/postmortem/0003-web-agent-gui-feedback-loop.md#L5-L46) — `resolved incident with Session evidence and corrections`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e54"></a>

**E54** — [`docs/postmortem/0005-web-merge-runtime-regressions.md`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/docs/postmortem/0005-web-merge-runtime-regressions.md#L5-L44) — `resolved incident and regression prevention`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e55"></a>

**E55** — [`docs/specs/2026-10-01-domain-runtime-plane-fc27-first-adapter.md`](https://github.com/changanhua/deepseek-harness/blob/7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2/docs/specs/2026-10-01-domain-runtime-plane-fc27-first-adapter.md) — `Phase A design authority`; commit `7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2`.

<a id="e56"></a>

**E56** — [`packages/planning/planning/src/context.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/planning/planning/src/context.ts#L5-L29) — `buildPlanningContext; opaque ResourceRefs`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e57"></a>

**E57** — [`apps/cli/src/plugin.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/apps/cli/src/plugin.ts#L120-L162) — `runPlugin profile package transaction`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e58"></a>

**E58** — [`packages/domain-runtime/domain-runtime/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2/packages/domain-runtime/domain-runtime/src/index.ts) — `Domain Artifact registry implementation`; commit `7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2`.

<a id="e59"></a>

**E59** — [`packages/domain-runtime/fc-sbc-domain/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2/packages/domain-runtime/fc-sbc-domain/src/index.ts) — `FC domain service implementation`; commit `7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2`.

<a id="e60"></a>

**E60** — [`outputs/issue-77/verification-report.md`](https://github.com/changanhua/deepseek-harness/blob/7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2/outputs/issue-77/verification-report.md) — `Phase A historical verification report; not current publication status`; commit `7e1aea5a4b8628ee5a31ed71e9adc094ae5b51d2`.

<a id="e61"></a>

**E61** — [`packages/goal/tool-goal/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/goal/tool-goal/src/index.ts#L188-L210) — `Goal prompt section`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

<a id="e62"></a>

**E62** — [`packages/planning/planning-delivery-bridge/src/index.ts`](https://github.com/changanhua/deepseek-harness/blob/b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3/packages/planning/planning-delivery-bridge/src/index.ts#L105-L168) — `Planning generation to Delivery Case and durable handoff`; commit `b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`.

## Dev Note

本审计不提出实施承诺。Watchlist 建议在满足所述证据与 ownership 检验前保持非权威假设。

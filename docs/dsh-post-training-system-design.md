# DSH Architecture Intelligence Layer：认知与后训练系统设计

日期：2026-08-25
证据基线：本地 checkout `17605f61be04443711cba6a8fa81cb1eaff66363`（分支 `runtime-awareness-clean`）；官方已发布基线 [`dsh-v0.1.1-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.2)，提交 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。

## 结论先行

第一版不应建设“以 Skill 为中心的案例知识库”，也不应直接训练模型。建议建设 **DSH Architecture Intelligence Layer**，以一条可检查的架构决策流水线工作：

```text
当前事实证据包
    +
用户需求
    ↓
架构决策包（Architecture Decision Packet，ADP）
    ↓
机器校验 + 独立语义 Review
    ↓
受约束的实现与真实验证
    ↓
候选经验 → 审核/验证 → Pattern/Case/Anti-pattern
```

核心抽象不是 Skill，也不是 Case，而是两个有版本的中间产物：

- **Evidence Capsule（证据包）**：由 Target Snapshot、Static/Source Manifest 和有范围的 Runtime Observations 组成，回答“这个 checkout、这个 profile、这个运行环境当前到底是什么”。
- **Architecture Decision Packet（ADP）**：回答“这项需求的角色、状态 owner、生命周期、持久化、并发、模型可见性与验证义务是什么”。

Skill 只负责驱动流程和加载所需材料；Case 是某次任务的不可变证据；Pattern 是跨案例验证后的迁移规则；Validator 把本可机械发现的错误挡在写代码之前。真正的模型微调放到 V2，前提是系统已经积累了版本明确、经过 Review 和运行验证的高质量轨迹。

## 证据边界

本设计使用以下当前事实，不把设计稿、模型判断或单次测试抬升为运行事实：

| 证据 | 当前结论 | 对系统设计的影响 |
|---|---|---|
| [官方仓库](https://github.com/deepseek-ai/deepseek-harness) 与 [rc.2 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.2) | DSH 仍处于 developer preview，并明确允许破坏性变化 | 所有 API 知识必须绑定版本；不能维护无版本的“DSH 常识” |
| [`docs/architecture.md`](../docs/architecture.md) | everything-is-a-plugin；事件有 durable/live/capability 域；model-visible 必须可由 session log 重建；seam 是 Service Definition / Service Provider / Consumer 三个角色的整体 | 这些少量规则适合进入常驻 Contract Kernel |
| 当前生成目录 | `capability-seams`、Cordis API、Tool、Config、Persistence、Module graph 六类生成物在本次核验中均为 fresh | 精确 API、事件、配置和依赖优先从生成物与源码检索，不复制进长提示词 |
| [`packages/context/runtime-facts`](../packages/context/runtime-facts/README.md) | Runtime Facts 由 owner 注册，区分 evaluation/freshness/exposure；自动上下文只投影同步 baseline，异步事实按需 inspect | “知识”与“当前现实”必须分层；运行状态不可从案例猜测 |
| [`packages/context/command-profile`](../packages/context/command-profile/README.md) | Command Knowledge Plane 保存候选及 provenance，但从不声称命令存在；存在性由 `runtime_inspect` 确认 | 检索结果是候选，不是事实；知识库自身不能充当运行时探针 |
| [`packages/task-queue`](../packages/task-queue/task-queue/README.md) 与 [`task-queue-local`](../packages/task-queue/task-queue-local/README.md) | 当前 Queue 由独立 Service Definition、单写者日志、调度 owner、两阶段 claim、恢复矩阵、粘性 fault、通知 outbox 和 Consumer 共同完成 | 高风险设计必须显式描述状态、生命周期、恢复与并发，而非只选包名 |
| [`runtime-awareness.behavior.e2e.ts`](../examples/headless-agent/tests/runtime-awareness.behavior.e2e.ts) | 已存在用真实模型、真实工具调用和 session 事件评价“已知则使用、未知则 inspect、不猜测”的行为测试 | 评测必须看外部轨迹，不能采信模型自评 |
| [`tool-skill` README](../packages/skill/tool-skill/README.md) | Skill catalog 只常驻摘要；正文按需加载；正文没有大小上限，正文变更也不进入 catalog digest | Skill 正文不适合承载庞大、易漂移的 DSH 事实库 |
| [`FORK-DIVERGENCE.md`](../FORK-DIVERGENCE.md) | 它描述的是 fork `master` 相对官方基线的人工维护差异；当前工作分支比该 master 还有新增能力 | provenance 必须同时记录 origin、branch、revision、path 与验证时间，不能只有 `OFFICIAL/LOCAL` 标签 |

## Phase A：发散

### A1. 根因树

```text
中等模型在 DSH 中产出“能跑但架构不对”的实现
├─ 任务识别失败
│  ├─ 不知道这是 capability、composition、durable state、UI/wire 还是 process change
│  ├─ 一个需求同时跨多个类型，只选了最显眼的一类
│  └─ 设计和实现没有阶段门，看到关键词就开始改代码
├─ DSH 心智模型缺失
│  ├─ 把 Tool、Service Definition、Provider、Consumer、Plugin、Preset、Settings 混成同一层
│  ├─ 把“有一个接口”误称为完整 seam
│  ├─ 把配置、知识、当前运行事实和模型上下文混为一体
│  └─ 不理解 Cordis effect、scope、pending、hot load/unload 的时间语义
├─ 当前事实不足
│  ├─ 不知道当前 branch/revision、fork 差异和实际 profile
│  ├─ 凭模型先验猜 API、服务键、事件名、配置字段
│  ├─ 把 proposed spec、旧 Case 或 README 当作当前实现
│  └─ 把“已注册/可解析/有凭证/可达/可操作”压成一个 ready
├─ 关系推理超载
│  ├─ seam 是角色图，状态是 owner 图，生命周期是时序图
│  ├─ 持久化、replay、恢复、并发、取消和 disposal 相互制约
│  ├─ host/client、session/process/worker、source/artifact 多个边界同时出现
│  └─ 长 prose 不能保证模型逐字段闭合这些关系
├─ 检索能力不足
│  ├─ 不知道先查生成目录、源码、Agent Note、Pattern 还是 Case
│  ├─ 搜到相似名字就停止，未核对消费者和失败路径
│  ├─ 长上下文稀释了关键规则
│  └─ 只有正例，无法识别“看似合理但错”的方案
├─ 约束不可执行
│  ├─ checklist 靠模型自觉逐条遵守
│  ├─ 状态 owner、生命周期、模型可见事件等缺项不会阻止实现
│  ├─ 测试只证明实现分支，没有验证真实 entry path 或运行世界
│  └─ Review 发现问题太晚，返工跨越多个包
├─ 反馈闭环断裂
│  ├─ 原始需求、错误初稿、finding、最终决策、代码和运行证据没有关联 ID
│  ├─ 一次成功被误升格为 Pattern
│  ├─ 失败只留在聊天或 PR comment，下一次无法检索
│  └─ 没记录使用了哪些知识，无法知道哪个 Pattern 真有帮助
└─ 模型固有限制
   ├─ 中等模型更易锚定首个相似案例
   ├─ 长上下文中的规则召回和跨段一致性较差
   ├─ 容易用流畅解释掩盖未验证假设
   └─ 遇到新 seam 时缺少可靠的自我升级条件
```

最主要的根因不是单纯“知识不足”，而是 **当前事实、决策表示、可执行约束和反馈治理同时缺失**。继续增加文档只能缓解其中一项，还可能放大锚定和版本污染。

### A2. 设计空间

#### A2.1 七种不同系统范式

| 范式 | 核心机制 | 最擅长解决 | 单独使用为何不足 | 结论 |
|---|---|---|---|---|
| Contract-Kernel-centric | 短 system prompt 固化少量带 ID 的不可违背规则 | 高频底线、低延迟 | 不能承载当前 API、复杂案例或运行状态；规则仍靠模型执行 | 必须有，但只能很小 |
| Skill-centric | Architect/Implementer/Reviewer Skill 编排步骤 | 触发流程、按需加载、角色分离 | Skill 正文会漂移且可能很长；流程不等于事实与验证 | 作为薄适配器，不做知识 owner |
| Retrieval-first | 按任务从源码、Pattern、Case 检索片段 | 降低常驻上下文、提供先例 | 检索错了会强化错误；没有结构时模型仍不会迁移 | 必须与分类、provenance、IR 联用 |
| Case-based reasoning | 以相似任务的初稿/修正/结果做类比 | 弱模型迁移、展示完整路径 | 容易过拟合偶然实现；Case 数量增长后相似度会误导 | Case 保留为证据，不能成为规范 |
| Architecture-IR / validator-centric | 把设计变成结构化 ADP，校验缺项与冲突 | seam、owner、生命周期、持久化、并发闭合 | 语义选择仍需模型/人判断；过重 IR 会妨碍小改动 | 作为核心，提供风险分级快路径 |
| Runtime-grounded | 自动读取 revision/profile/config/generated catalogs，必要时 probe live runtime | 消除幻觉 API、错误环境假设和旧版本污染 | 运行观察不能证明设计义务；并非所有任务都有活服务 | 作为证据包，严格限制事实种类 |
| Adversarial / multi-pass | 先独立重建，再挑战首选方案，必要时强模型升级 | 发现锚定、漏项与新 seam 风险 | 成本高；多个 Agent 可共享同一错误资料 | 高风险必做，同模型独立 pass 即可起步 |
| Trajectory distillation / model routing | 用验证轨迹做 SFT/DPO，难题路由强模型 | 长期降低推理成本，提高内化能力 | 没有干净轨迹会把版本特例和错误训练进去 | V2；先建数据治理和评测 |

最终选择是 **Runtime-grounded + Architecture-IR + Validator + Retrieval + 受控反馈** 的混合系统。Contract Kernel 和 Skill 负责入口；Case 和 Pattern 是数据；强模型和真正微调是后续增益，不是地基。

#### A2.2 四种 Agent 决策范式

1. **编译式决策**：需求先转成分类和 ADP；所有 required 字段闭合后才允许实现。适合 durable state、跨边界和新 capability。
2. **类比式决策**：先取最多三个 precedent，提取“相同约束/不同约束”，再把可迁移部分写入 ADP。适合已有 seam 的新 Provider 或 Consumer。
3. **证伪式决策**：Reviewer 先不读 Architect 的结论，只根据原始需求和 Evidence Capsule 形成独立 seam/owner 假设，再对比并尝试构造恢复、并发、卸载和 replay 反例。适合高风险设计。
4. **实验式决策**：当争议是“当前 runtime 到底怎样”时，用 `--dump-config`、生成目录、`runtime_inspect`、`cordis_inspect_*` 或最小真实组件实验取证。运行观察只回答被观察的问题，不替代持久性或兼容性证明。

四种范式按风险组合，不固定成一条笨重流水线：小改用编译式快路径；已有能力优先类比；新 seam 强制证伪；环境争议使用实验。

#### A2.3 知识组织方式的取舍

| 组织方式 | 优点 | 对中等模型的主要问题 | 最终位置 |
|---|---|---|---|
| 文档树 | 人可维护，适合完整解释 | 路径不等于任务意图；模型容易整篇加载 | 保存 canonical prose，不直接承担路由 |
| Pattern Library | 迁移规则简洁 | 适用条件不足时容易套模板 | 结构化记录，validated 后参与检索 |
| Case Library | 展示需求到运行结果的完整证据 | 相似表象会掩盖约束差异 | 先按 task signature 过滤，再取摘要 |
| Decision Tree / Task Taxonomy | 低成本识别风险和必查项 | 无法表达多标签和复杂依赖 | V0 的第一层 deterministic router |
| Capability/Seam Graph | 表达 Service Definition、Provider、Consumer 和消费者关系 | 手工维护必然漂移 | 复用源码生成的 capability/module/event graph |
| State Ownership Map | 直接暴露双 owner、错误派生与持久化遗漏 | 跨案例全局图会很快过时 | 每个 ADP 必填；Pattern 只存可迁移约束 |
| Ontology / Knowledge Graph | 可做关系查询和冲突分析 | 建模和维护成本高，易产生第二套 DSH 真相 | Later；只有真实查询失败数据支持时再建 |
| Searchable Snippets | 上下文小、定位精确 | 断章取义；缺少 authority 与适用范围 | 必须连同 provenance envelope 返回 |
| Executable Examples / Fixtures | 能验证行为并提供真实 entry path | 一个示例不等于一般设计规律 | 作为 Case evidence 和 Validator/Test 模板 |
| Structured Metadata | 可过滤、校验、废弃和统计 | schema 过重会拖慢小任务 | Evidence/ADP/Knowledge 的公共骨架 |

最适合中等模型的不是一种组织方式，而是四层调用顺序：**Task Taxonomy 缩小问题 → 结构化 metadata 过滤 → generated graph/source 定位事实 → Pattern/Case/Anti-pattern 提供有限先例**。正文和代码只在最后按 pointer 展开。最有迁移价值的信息是“约束差异、错误假设、failure mechanism、owner/lifecycle 决策和验证结果”，而不是最终代码全文。

### A3. 最值得保留的设计原语

1. 小型、带稳定规则 ID 的 DSH Contract Kernel。
2. Task/Risk Classifier。
3. Versioned Evidence Capsule。
4. 证据 provenance envelope。
5. Architecture Decision Packet（ADP）IR。
6. Capability role map（Service Definition / Provider / Consumer）。
7. State Ownership Matrix。
8. Lifecycle/Recovery state machine。
9. Boundary map（host/client/process/worker/session/wire/trust）。
10. Configuration/Secret ownership matrix。
11. Model-visible ↔ session-log obligation。
12. Bounded Retrieval Router。
13. Pattern record。
14. Immutable Case record。
15. Anti-pattern record。
16. Deterministic Design Validator。
17. Independent Semantic Reviewer。
18. Verification Matrix 与真实运行证据。
19. Candidate/Promotion/Deprecation ledger。
20. Paired Behavior Eval harness。

知识图谱、向量数据库、常驻服务、多 Agent 编排和自动微调都不是第一批原语。现有生成目录已提供相当一部分 capability/module/event 图；先做一个可检索的索引，不重复建设另一套图数据库。

### A4. 风险与失败模式

| 失败模式 | 为什么“多塞文档和案例”会放大它 | 防护 |
|---|---|---|
| Authority flattening | 官方源码、Local Contract、proposed spec、普通 Case 在 prompt 中看起来同等可信 | provenance 分轴；检索结果显示 authority/lifecycle/revision；冲突不静默合并 |
| Version poisoning | 旧 API 和新 API 同时存在，模型选择更熟悉的一版 | 每条事实绑定 revision/path/digest；source-anchor 漂移即 quarantine |
| Similarity trap | “也叫 queue”就类比 `ctx.jobs`，忽略跨进程持久性 | 先按约束分类，再检索；Case 必须列 transfer conditions 和 counter-signals |
| Positive-only bias | 只看到最终成功代码，不知道初稿为何错 | Case 保存错误方案和 findings；Anti-pattern 是一等条目 |
| Context dilution | 规则、源码、案例过多，关键 owner/lifecycle 条款被稀释 | 常驻 ≤1,200 tokens；每轮最多 3 个 precedent、6 个证据片段 |
| Premature architecture | Pattern 让 Agent 套模板，未理解需求就创建新 seam | Adapt/Invent 门禁；先列现有 extension point 和两个替代方案 |
| Pattern ossification | 一次成功变成永久规则，阻碍 DSH 迭代 | Pattern 晋升至少需要独立证据；记录适用/禁用条件和 revalidation trigger |
| Runtime overreach | 一次 HTTP 200、一个 listener 或一次命令成功被当成完整 vertical | 证据类型明确；观察事实不得推出未测试的 durable/replay/UX 结论 |
| Self-review illusion | 同一模型重复 checklist，仍保留相同盲点 | Reviewer 先独立重建分类/owner；机器校验先执行；高风险再升级模型或人 |
| Knowledge laundering | 模型生成的总结被写回库后看起来像人工规范 | model-generated 只能进入 candidate；promotion 需要 reviewer 与验证证据 |
| Retrieval invisibility | 不记录检索命中，无法知道错误由哪条知识诱发 | 每个 Run 记录 usedKnowledgeIds、rank、loadedTokens 和 outcome |
| Skill bloat | 把所有知识塞进三个 Skill，正文无限增长、body 变更不可感知 | Skill 只写流程、策略、入口、停止条件；事实留在版本化库中 |
| Benchmark contamination | Golden Case 同时进入检索和 holdout，指标虚高 | holdout 不进入索引；用近邻但非同题任务和 mutation tasks |
| Automatic promotion cascade | 成功任务自动产出 Pattern，错误在未来任务中复用 | 成功只生成 candidate；晋升必须显式授权，且可撤回/废弃 |

## Phase B：收敛决策

### B1. 最终核心组件

严格保留四个核心组件：

| 级别 | 组件 | 职责 |
|---|---|---|
| Must Have | Evidence Capsule Builder（Fact Engine） | 先锁定 repo/revision/profile，再采集静态源码事实和有范围的 runtime observation；不做架构判断，也不把“可注册”写成“正在运行” |
| Must Have | Architecture Packet Engine | 风险分类、受限检索、生成/维护 ADP；把自然语言需求转换成可检查决策 |
| Must Have | Validator + Reviewer | 机器拒绝缺项/冲突；语义 Reviewer 独立检查 seam、owner、生命周期和验证充分性 |
| Must Have | Knowledge & Eval Ledger | 保存 Run/Artifact/Candidate/Knowledge 关系，控制晋升/废弃，并执行 paired eval |
| Should Have | Architect 与 Reviewer Skills | 新增 Architect 入口并扩展现有 `dsh-code-review`；提供角色隔离，正文保持薄 |
| Should Have | Runtime probe adapters | 对接 `dsh --dump-config`、`runtime_inspect`、`cordis_inspect_*`；无运行时则明确 unavailable |
| Should Have | Implementer Skill | 消费 accepted ADP 并在偏离时生成 amendment；V0 可先用现有 AGENTS/测试规则加 handoff 模板 |
| Later | Strong-model router | 仅在新 seam、证据冲突或高风险 Review 未闭合时升级 |
| Later | Distillation/fine-tuning | 用 validated ADP、rejected alternatives、findings 和外部轨迹训练 |
| Later | UI/graph/vector service | 只有词法检索、人工 Review 或规模指标出现瓶颈后再做 |

Contract Kernel 和 Bounded Retriever 是共享 artifact/内部子系统，不增加独立运行服务：Architecture Packet Engine 使用它们生成 ADP，Validator 和 Reviewer 使用相同规则 ID 检查 ADP。

### B2. 必须常驻上下文的知识

只常驻一份 ≤1,200 model tokens、带稳定规则 ID 的 Contract Kernel。每条规则保存当前 revision 的来源指针，Validator finding 直接引用规则 ID；V0 不为追求数量扩展到 30～50 条。

| ID | 规则 |
|---|---|
| C01 | 当前 repo revision、profile 和 Evidence Capsule ID 未锁定时，不得声称当前 API 或运行状态。 |
| C02 | 新行为优先使用 documented extension point；修改 agent loop 必须更新架构文档。 |
| C03 | capability seam 必须说明 Service Definition、Service Provider 和 Consumer；单个角色不是完整 seam。 |
| C04 | 每个状态只有一个 authoritative owner；派生值说明来源和 freshness。 |
| C05 | 所有注册都是 effect，必须说明 reload、unload 和 dispose-to-quiescence。 |
| C06 | 任何 model-visible 输入都必须可由 session log 重建。 |
| C07 | durable state 必须说明持久化、恢复、replay、并发、取消和失败语义。 |
| C08 | 部署可调参数属于 validated config；默认值由 owner 的 `resolve(request): spec` 显式决定。 |
| C09 | misconfiguration 在最早可判定点失败，不静默跳过缺失 referent。 |
| C10 | Adapt/Compose 优先；Invent 必须通过 invention proof。 |
| C11 | 测试、HTTP、模型自评和 runtime observation 只证明各自观察的问题，不互相替代。 |
| C12 | ADP 未 accepted 不进入非机械实现；证据、未知项和设计偏离必须写入 artifact。 |

这些是高频、跨任务、低版本漂移的决策规则。具体服务方法、包名清单、Case 和测试命令不常驻；新规则只有在重复 finding 能编译成 deterministic check 时才进入 Kernel。

### B3. 必须按需检索的知识

- 当前 checkout 的源码、类型、JSDoc 和 generated catalogs。
- 当前 profile 的 `--dump-config` 与可选 live runtime observations。
- 相关 Agent Note、package README、defensive pattern、测试与 postmortem。
- 与任务分类匹配的 Pattern/Anti-pattern/Case。
- fork-local contract 与最新官方 tagged baseline 的差异。
- 精确命令、测试矩阵和发布/文档门禁。

理由：这些内容要么体积大，要么随版本、profile、scope 或环境变化；常驻会同时增加 token 成本和污染概率。

### B4. Skill 的边界

Skill 是 **流程策略 + 检索入口 + 停止条件**，不是事实库、案例库或最终权威。Skill 可以要求加载 Contract Kernel、调用 snapshot/retrieve/validate，不能复制当前 API 清单或嵌入大量案例。Skill 的输出是结构化 artifact，不是“我已检查”的自述。

### B5. Pattern、Case、Contract 的严格定义

- **Contract**：当前实现或仓库规则要求参与者履行的义务，有版本化权威来源；可决定设计是否无效。
- **Pattern**：在明确适用条件下、由多个证据支持的可迁移设计规则；帮助提出/比较方案，但不能覆盖 Contract。
- **Case**：某一任务、revision、环境和结果的不可变证据包；说明发生过什么，不自动规定未来必须怎么做。
- **Anti-pattern**：一种诱人方案及其失败机制、检测信号、误报条件和替代路径；是负向迁移知识。
- **Golden Case**：验证充分、迁移信息完整的 Case；仍然只是 Case，不能高于当前源码与 Contract。

### B6. 官方与本地体系的 provenance

不要用一个扁平枚举同时表达来源、类型和状态。每条记录用三个正交字段：

```yaml
provenance:
  origin: official | local-fork | local-worktree | external | model-generated
  artifact_kind: source | contract | example | pattern | case | anti-pattern | runtime-observation
  lifecycle: candidate | validated | current | superseded | deprecated | rejected | quarantined
  repository: https://github.com/deepseek-ai/deepseek-harness.git
  revision: b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
  path: packages/shell/shell/src/index.ts
  symbol: ShellExecutor
  line_hint: 42
  content_digest: sha256:...
  observed_at: 2026-08-25T00:00:00Z
  validation:
    methods: [source-read, focused-test]
    environment_ref: evidence:...
```

界面可派生展示 `OFFICIAL_CONTRACT`、`LOCAL_PATTERN` 等标签，但底层保留正交字段。branch 必须记录；dirty worktree 的 observation 不能伪装成已提交 source。

### B7. 新任务状态机

```text
INTAKE
  └─需求、范围、非目标齐全→ TARGET_LOCKED
TARGET_LOCKED
  └─repo、revision、branch/dirty scope、profile 或 unavailable 原因明确→ GROUNDED
GROUNDED
  └─Evidence Capsule 新鲜且关键事实有来源→ CLASSIFIED
CLASSIFIED
  └─任务类型、风险级别、必填 ADP sections 确定→ ALTERNATIVES
ALTERNATIVES
  └─现有 extension points 与至少两个可行/拒绝方案比较→ SELECTED
SELECTED
  └─Adapt/Invent 判定及证据成立→ CONTRACTED
CONTRACTED
  └─ADP schema + deterministic validators 全通过→ REVIEWED
REVIEWED
  ├─blocking finding→ ALTERNATIVES 或 CONTRACTED
  └─无 blocker→ IMPLEMENTABLE
IMPLEMENTABLE
  └─验证矩阵和文件职责明确→ IMPLEMENTING
IMPLEMENTING
  ├─发现设计事实不成立→ CONTRACTED（amendment）
  └─实现完成→ VERIFIED
VERIFIED
  ├─行为/模型/UI/运行环境需要真实验证→ RUNTIME_VALIDATED
  └─纯静态/机械改动→ CLOSED
RUNTIME_VALIDATED
  └─真实 entry path 与外部观察通过→ CLOSED
CLOSED
  └─Run artifacts 固化；有价值的新经验只进入 CANDIDATE
```

风险快路径：T0 机械/局部改动只需 condensed ADP；T1 单包行为需要 owner/lifecycle/verification；T2 新 seam、durable state、并发、跨边界或 model-visible 改动必须走完整状态机。

### B8. 何时允许创造新设计

满足以下全部条件才允许 `decision_mode: invent`：

1. 当前 generated capability map 和源码中没有满足需求义务的 extension point。
2. 至少两个适配方案被逐条证明不满足，而不是“没找到相似 Case”。
3. 新能力的三个 seam 角色或“不应成为 seam”的理由完整。
4. owner、生命周期、配置、持久化、恢复、并发、模型可见性与可观测性义务闭合。
5. 说明对 profile/bundle、host/client、wire、存储格式和兼容性的影响。
6. 有 proposed Agent Note、最小 vertical、负向测试和撤回/禁用路径。
7. 独立 Reviewer 或人类批准 invention finding。

“模型不知道怎么做”“没有 Case”“未来可能复用”都不是 invention 理由。

### B9. Reviewer 的工作方式

Reviewer 分两层：

1. **Deterministic Validator**：检查 ADP schema、证据 revision、角色完整性、唯一 owner、状态机终态、effect/dispose、持久化/replay/recovery、配置默认、model-visible event、host/client/wire、验证矩阵和 invention proof。
2. **Semantic Reviewer**：先根据原始需求和 Evidence Capsule 独立形成分类、首选 seam 和 owner 假设，再读取 Architect ADP，逐项构造失败场景。

Reviewer 必须覆盖：seam、state owner、lifecycle、effect ownership、host/client、persistence、restart/recovery、replay、concurrency、configuration plane、model-visible state、hidden state、observability、verification。每个 finding 包含 severity、rule ID、文件/证据、可触发的失败、修复义务和验证方法；没有证据的偏好只能作为 suggestion。

### B10. 新经验进入知识体系

```text
Run + Artifact + ADP + Review + Tests + Runtime Evidence
                         ↓
                   Candidate Extractor
                         ↓
             schema / source / dedupe / conflict
                         ↓
                  Human or authorized review
                    ↙               ↘
              reject/quarantine    validate
                                      ↓
                 Case / Anti-pattern / Pattern promotion
                                      ↓
                    source-anchor drift revalidation
                                      ↓
                     current / superseded / deprecated
```

只有以下事件生成 candidate：blocking finding 被修复、真实运行失败揭示新机制、同类 finding 重复出现、现有 Pattern 适用条件变化，或用户明确要求沉淀。普通成功任务不自动提炼 Pattern。模型可以 `propose`，不能自行 `promote`。

## 最终系统设计

### 1. 整体架构图

```text
User Requirement
       ↓
0. Target Lock
  └─ repo / revision / profile / dirty scope
       ↓
Intake + Deterministic Risk Triggers
       ↓
Evidence Capsule Builder ───────────────┐
  ├─ Target Snapshot                      │
  ├─ Static / Source Manifest             │
  └─ scoped Runtime Observations          │
       ↓                                  │
Task Classifier                           │
       ↓                                  │
Bounded Retriever ← Contract/Pattern/Anti-pattern/Case
       ↓                                  │
Architecture Packet Engine               │
  └─ Architecture Decision Packet (ADP)  │
       ↓                                  │
Deterministic Validator ──fail────────────┘
       ↓ pass
Independent Semantic Reviewer ──block──→ revise ADP
       ↓ accept
Implementer
       ↓
Focused Tests / Snapshots / Gates / Real Entry Path
       ↓
Verified Run Artifact
       ↓
Candidate Extractor
       ↓
Review + Validation + Promotion
       ↓
Knowledge & Eval Ledger ───────────────→ Retriever / Eval Corpus
```

### 2. 推荐目录结构

```text
.agents/
├── dsh-intelligence/                    # canonical, reviewable knowledge source
│   ├── contract-kernel/
│   │   ├── kernel.yaml                  # C01... rules + source refs
│   │   └── sources.yaml
│   ├── schemas/
│   │   ├── evidence-capsule.schema.json
│   │   ├── architecture-decision-packet.schema.json
│   │   ├── case.schema.json
│   │   ├── pattern.schema.json
│   │   └── anti-pattern.schema.json
│   ├── contract-index/                  # pointers + digests, not copied API prose
│   │   ├── repository-rules.yaml
│   │   └── generated-sources.yaml
│   ├── knowledge/
│   │   ├── patterns/
│   │   ├── anti-patterns/
│   │   ├── cases/
│   │   ├── candidates/
│   │   └── deprecated/
│   ├── retrieval/
│   │   ├── task-taxonomy.yaml
│   │   ├── routing-policy.yaml
│   │   └── token-budgets.yaml
│   └── evals/
│       ├── rubrics/
│       └── visible-tasks/                # examples only; never the holdout
├── skills/
│   ├── dsh-architect/SKILL.md
│   ├── dsh-implementer/SKILL.md
│   └── dsh-code-review/SKILL.md          # extend existing Reviewer entrypoint
scripts/
└── dsh-intelligence/
    ├── snapshot.ts
    ├── retrieve.ts
    ├── validate-adp.ts
    ├── propose-candidate.ts
    ├── promote.ts
    └── run-eval.ts
.dsh-intelligence/                       # generated, gitignored, rebuildable
├── index/
├── runs/<run-id>/
│   ├── evidence.json
│   ├── task.json
│   ├── adp.yaml
│   ├── review.json
│   ├── verification.json
│   └── knowledge-usage.json
└── private-evals/                       # never indexed or injected
```

目录推导：canonical 知识放 `.agents/`，因为它是开发/Agent 工作流而非 DSH runtime 产品能力；可执行检查放 `scripts/`；每次运行、索引和私有 holdout 都是可重建/不入库产物。V0 不新增 `packages/` 插件，避免把开发认知系统误建成 product seam。

### 3. 核心组件职责

| 组件 | 输入 | 输出 | 权威性 | 生命周期 | 常驻上下文 |
|---|---|---|---|---|---|
| Evidence Capsule Builder | repo/profile/runtime scope | `evidence.json` + source refs | 对已观察字段有范围/时间限定的事实权威；不拥有架构结论 | 每个 Run 新建；revision/profile 变化即失效 | 只常驻 ID、revision 与摘要 |
| Architecture Packet Engine | requirement、Evidence Capsule、最多 3 个 precedent | `adp.yaml`、未知项、alternatives | 决策候选；通过 Review 后才成为本任务 accepted design | 从 intake 到 close，可追加 amendment，不覆写旧版 | 常驻当前 ADP 摘要 |
| Validator + Reviewer | raw requirement、evidence、ADP、后续 diff/verification | machine errors、structured findings、accept/block | Validator 对 schema/rule 是权威；Reviewer 对语义是审核意见，不覆盖源码事实 | 每个 ADP revision 和实现 diff 运行 | 只注入 findings 摘要 |
| Knowledge & Eval Ledger | Run artifacts、findings、测试、runtime evidence、使用记录 | candidate、promoted records、metrics | 只有 validated/current 记录可参与正常检索；Case/Pattern 均低于 Contract | append-only lineage；支持 supersede/deprecate/quarantine | 不常驻，按需检索 |

### 4. Evidence Capsule（事实 IR）

Evidence Capsule 不把所有事实压成一个 `Runtime Manifest`。它把目标身份、静态能力和运行观察分开，避免 generated catalog 中“可以注册的能力”被误读为当前 profile 已 mount，或一次 live observation 被误读为持久 API 义务。

```yaml
schema_version: 1
id: evidence-...
created_at: 2026-08-25T00:00:00Z
target_snapshot:
  repository: ''
  revision: ''
  branch: ''
  upstream_base: ''
  dirty_paths: []
  profile: ''
  host_scope: ''
static_manifest:
  dump_config_ref: artifact:...
  generated_catalogs:
    - { kind: capability-seams, digest: sha256:..., source_ref: artifact:... }
  exact_source_refs: []
runtime_observations:
  - collector: runtime_inspect | cordis_inspect_query | cordis_inspect_self | real-entry-probe
    observed_at: 2026-08-25T00:00:00Z
    scope: { profile: '', process_id: '', client_id: '' }
    claim: ''
    artifact_ref: artifact:...
unavailable:
  - { fact: '', reason: not-mounted | no-live-instance | unsupported | not-requested }
conflicts: []
```

Target Lock 是生成 Capsule 的前置动作，不是模型自述。静态能力先从 fresh generated catalogs 和 exact source 读取；当前 Cordis 能力通过 `cordis_inspect_list` 发现 Provider，再用 `cordis_inspect_query` 查询，当前 Session 的动态 Plugin/Package 用 `cordis_inspect_self`；宿主事实和命令解析使用 `runtime_inspect`。没有 live instance 时记录 `unavailable`，不得用 Case 或配置推断运行状态。

### 5. Architecture Decision Packet（核心设计 IR）

```yaml
schema_version: 1
id: adp-...
revision: 1
task:
  raw_requirement_ref: artifact:...
  desired_outcomes: []
  non_goals: []
  scope: []
  risk_tier: T2
  classifications: [durable-state, orchestration, capability-seam]
evidence:
  capsule_id: evidence:...
  required_refs: []
  unresolved_facts: []
alternatives:
  - id: adapt-jobs
    mode: adapt
    satisfies: []
    violates: []
    evidence_refs: []
decision:
  selected_alternative: new-task-queue-seam
  mode: invent
  invention_proof:
    inspected_existing_seams: []
    rejected_adaptations: []
    missing_capability: ''
    why_composition_is_insufficient: ''
    approval_ref: ''
capability:
  service_definition: { package: '', service_key: '', vocabulary: [] }
  providers: []
  consumers: []
  existing_extension_points: []
state:
  - name: task-record
    authoritative_owner: ''
    source_of_truth: ''
    durability: process | session-log | domain-store | external
    mutation_serialization: ''
    replay: ''
    restart_recovery: ''
    cancellation: ''
    terminal_states: []
lifecycle:
  register: ''
  activate: ''
  hot_reload: ''
  dispose_to_quiescence: ''
  crash: ''
boundaries:
  host_client: []
  process_worker: []
  session_durable: []
  wire: []
  trust: []
configuration:
  owner: ''
  schema_ref: ''
  precedence: []
  resolve_point: ''
  hot_update_semantics: ''
  secrets: []
model_visibility:
  inputs: []
  session_event_or_projection: []
  replay: ''
  compaction: ''
observability:
  events: []
  diagnostics: []
  operator_actions: []
proof_obligations:
  - id: obligation-...
    rule_ids: [C03, C07]
    statement: ''
    evidence_refs: []
    falsification: ''
    verification_refs: []
verification:
  unit: []
  invariant_negative_controls: []
  integration: []
  snapshots: []
  real_entry_path: []
  runtime_acceptance: []
open_questions: []
```

IR 不是要求模型填写更多 prose，而是让遗漏可见、让 Validator 能拒绝不完整设计。T0/T1 使用 schema 的条件分支，只要求相关字段。

### 6. Agent 主流程

1. 执行 Target Lock，记录目标 repo、revision、branch/dirty scope、upstream base 和 profile；无法确定的字段写明 `unavailable`，此时不进入设计。
2. 读取原始需求，提取可观察结果、明确非目标、写入 `task.json`；不提出方案。
3. 生成 Evidence Capsule；只有任务涉及实际运行实例时才调用 `--dump-config`、`runtime_inspect` 或 `cordis_inspect_*`，每条运行观察保存 scope 和时间。
4. 运行确定性风险触发器：`durable/restart/queue` 强制 state+recovery；`ctx.* / provider` 强制 seam roles；`tool/prompt/model-visible` 强制 session-log；`UI/remote` 强制 host/client/wire；`settings/default/credential` 强制 configuration+secret。
5. 根据分类先查 generated catalog，再定位 exact source symbol；每个关键 API 至少有一个当前 revision source ref。
6. 检索最多三个 precedent：一个 Contract/official or local source precedent、一个 Pattern/Anti-pattern、一个 Case。读取摘要后只展开真正匹配的详情。
7. 写“相同约束/不同约束/不可迁移点”，防止直接复制 Case。
8. 生成至少两个 alternative；机械任务可声明 `single-obvious-path` 并给证据。每个方案写满足项、违反项、owner 与失败场景。
9. 选择 Adapt/Compose 或进入 invention proof；未通过就回到检索/alternatives。
10. 生成 ADP，逐个状态填写 owner、durability、mutation ordering、replay、recovery、cancellation、terminal state，并把每个关键选择写成可证伪的 proof obligation。
11. 运行 `validate-adp`；机器错误全部清零，不允许用 Reviewer prose 豁免 schema。
12. Reviewer 先独立形成 task class/seam/owner 假设，再对比 ADP，检查 15 个强制主题并输出 structured findings。
13. blocker 清零后形成 accepted ADP 和 verification matrix；Implementer 只能在此范围内实施。
14. 实现发现证据错误或必须改变 owner/seam/proof obligation 时，创建 ADP amendment，禁止静默偏离。
15. 运行 focused tests、negative controls、snapshot/gates 和所需真实 entry path；分别记录通过、失败、未运行和不适用。
16. 关闭 Run，计算指标；只有触发条件命中时生成 candidate，等待显式 promotion。

### 7. Retrieval Policy

#### 查询顺序

1. Evidence Capsule 中的 current revision/profile。
2. generated catalogs 定位 service/event/tool/config/persistence/module。
3. exact source/type/JSDoc 与直接消费者。
4. 当前 implemented Agent Note/README 获取 rationale 和限制。
5. Pattern/Anti-pattern。
6. version-compatible Case。

#### 何时查官方源码

- 依赖官方公共 API、事件、Service Definition 或 Loader/Cordis 语义时。
- 本地实现可能是 fork divergence，需要确定继承还是改写官方行为时。
- 当前本地文档与源码冲突时。
- 设计新 seam 或修改 agent-loop 等核心 extension point 时。

实际目标是 local fork 时，**先以目标 checkout 源码为准**；官方 tagged source 用于识别继承的 Contract 与 divergence，不覆盖本地已实现差异。

#### 何时查 Pattern、Case、Anti-pattern

- Pattern：分类完成后，用来生成 alternative 和验证义务。
- Case：已有相同约束组合时，用来观察完整迁移路径；必须先比较差异。
- Anti-pattern：T2 总是查一个；T1 在存在状态/生命周期/配置时查。
- postmortem/失败 Case：涉及 subprocess、并发、恢复、teardown、security 时强制查。

#### 预算

- precedent 最多 3 个。
- 一次模型 step 展开最多 6 个证据片段。
- 默认检索载荷 ≤6,000 model tokens；超额先压缩为结构化摘要并保留 pointer。
- 每个片段只保留与当前 ADP 字段有关的 source lines、Contract 和失败机制。

#### 冲突处理

同一 scope/revision 的事实冲突时不做 rank-average：创建 `evidence_conflict`，回到源码/运行观察；无法解除则 ADP 保留 open question，并阻止相关实现。不同 revision 的冲突按版本隔离，不称为知识矛盾。

### 8. Knowledge Precedence

优先级只在“回答同一问题、同一 scope”时适用：

```text
1. 当前 Evidence Capsule 中针对该事实类型的直接证据
   ├─ 运行事实：同一 profile/实例的 live observation
   └─ 设计/API 事实：当前 checkout 的 source/type/config
2. 当前 checkout 的 fresh generated catalogs
3. 当前仓库 Contract Kernel + 经源码核对的 implemented Contract/Agent Note
4. 最新已固定官方 tag 的 source/Contract（仅对本地未改写区域）
5. Validated Pattern / Anti-pattern
6. 与 revision/约束匹配的 Golden Case
7. 普通 verified Case
8. Proposed/Experimental/Candidate
9. 模型先验
```

运行观察只证明被观察状态，不能覆盖 API obligation、持久性保证或 rationale。Agent Note 解释为什么；源码和测试证明当前机制；二者问题类型不同，不能机械互相覆盖。

### 9. Case Schema

```yaml
schema_version: 1
id: case-task-queue-v1
title: Durable cross-session task queue
status: verified | golden | quarantined | deprecated
task_signature:
  classifications: [durable-state, orchestration, capability-seam]
  constraints: [cross-session, restart-survival, subprocess, model-consumer]
  risk_tier: T2
provenance: { origin: local-fork, artifact_kind: case, lifecycle: validated, revision: ... }
requirement_ref: artifact:...
evidence_capsule_ref: evidence:...
initial_attempt:
  artifact_ref: artifact:...
  wrong_assumptions: []
review_findings:
  - { severity: blocking, rule_id: lifecycle.recovery, mechanism: '', evidence_refs: [] }
accepted_adp_ref: adp:...
decision_summary:
  seam_choice: ''
  service_definition: ''
  providers: []
  consumers: []
  invariants: []
  state_owners: []
  lifecycle: []
  persistence_and_replay: []
  recovery_and_concurrency: []
  configuration: []
  migration_and_compatibility: []
implementation_refs: []
verification:
  tests: []
  negative_controls: []
  runtime_observations: []
  unverified_claims: []
transfer:
  reusable_constraints: []
  non_transferable_details: []
  counter_signals: []
rejected_alternatives: []
outcome_metrics: {}
knowledge_candidates: []
```

Case 保存指针和关键差异，不复制整段代码。Golden 条件：accepted implementation、针对 failure mechanism 的负向测试、所需真实 entry path、完整 transfer section；若行为需要 runtime evidence 而尚未验证，不得 Golden。

### 10. Pattern Schema

```yaml
schema_version: 1
id: pattern-owned-durable-scheduler
title: Scheduler owns subprocess lifecycle
status: candidate | validated | superseded | deprecated
statement: ''
problem_signature: []
forces: []
applies_when: []
does_not_apply_when: []
required_roles: []
state_ownership: []
lifecycle_obligations: []
decision_template: []
verification_obligations: []
detection_queries: []
evidence_cases: []
counter_examples: []
source_contract_refs: []
confidence: low | medium | high
provenance: {}
version_range:
  first_validated_revision: ''
  last_revalidated_revision: ''
revalidation_triggers: []
```

晋升要求：至少两个独立 verified Case，或一个权威 Contract 加一个真实 verified Case；Reviewer 明确适用/禁用条件；所有 source refs 当前有效。Pattern 不得只因为一次实现成功而晋升。

### 11. Anti-pattern Schema

```yaml
schema_version: 1
id: anti-pattern-recovered-pid-as-kill-authority
title: Treating a persisted PID as restart kill authority
status: candidate | validated | superseded | deprecated
tempting_solution: ''
why_it_looks_reasonable: ''
failure_mechanism: ''
violation_signals:
  static_queries: []
  adp_signals: []
  runtime_signals: []
harm: []
false_positive_conditions: []
safe_alternatives: []
repair_steps: []
verification_obligations: []
evidence_refs: []
provenance: {}
revalidation_triggers: []
```

Anti-pattern 的核心不是“不要这样”，而是可复现的失败机制、可搜索信号、误报条件与替代方案。

### 12. 三个核心 Skill 的边界

#### Architect Skill（V0 Must）

- 输入：原始需求、scope、Evidence Capsule ID。
- 负责：分类、检索路由、alternative 比较、ADP 生成、Validator 调用、unknown/invention 暴露。
- 不负责：实现代码、宣称测试通过、直接晋升知识、把 Case 当 Contract。
- 完成条件：ADP machine-valid，review-ready；不是“方案写完了”。

#### Implementer Skill（V1 Should）

- 输入：accepted ADP、verification matrix、明确文件 ownership。
- 负责：以测试驱动实现、同步 README/JSDoc/Agent Note、执行 focused checks、记录偏离。
- 不负责：静默换 seam/owner、扩大需求、修改 accepted ADP 历史、把 fixture 成功称为真实 vertical。
- 停止条件：出现设计事实错误或跨越 ADP scope，生成 amendment 并返回 Architect。

#### Reviewer Skill（V0 Must）

- 输入：原始需求、Evidence Capsule、ADP；实现后再接受 diff 与 verification。
- 负责：先独立重建、运行机器校验、追踪 source/consumer、构造 failure scenario、输出结构化 findings。
- 不负责：用个人偏好阻塞、代替 Validator、实现修复、自动 promotion。
- 完成条件：所有强制主题有 verdict/evidence；blocker 为零或明确 blocked。

因此需要三个角色边界，但 V0 只新增 Architect Skill，并给现有 `dsh-code-review` 增加 ADP/证据输入协议。Implementer 已有 `AGENTS.md`、测试规则与代码 Review 工作流可复用，第一版先提供 handoff schema，避免重复写一套庞大实现知识。

### 13. V0 验证切片与 MVP

#### Phase 0：3～5 个工作日验证切片

先验证 `Target Lock → Evidence Capsule → ADP → validate-adp` 能否减少设计错误，不先建设完整知识体系。

1. 定义 Evidence Capsule 和 ADP 两个最小 JSON Schema，只覆盖 target/evidence/alternatives/capability/state/lifecycle/proof obligations/verification。
2. 实现 `snapshot.ts` 的静态部分：repo、revision、branch/dirty scope、merge base 和 generated catalog digests；runtime adapters 暂按输入 artifact 接入。
3. 写 C01～C12 Contract Kernel，并实现八条高频硬检查：证据 pin、seam 三角色、唯一 owner、effect/dispose、durable recovery/replay、model-visible log、configuration owner、invention proof。
4. 新增 Architect 薄入口；Reviewer 直接复用现有 `dsh-code-review`，只增加 ADP/证据读取协议和结构化 finding 输出。
5. 用一个 Pattern、一个 Anti-pattern 和四个不直接复制 Task Queue 的 holdout tasks 跑 baseline/full paired trial。

验证切片通过条件：至少 3/4 任务降低 weighted blocking finding score；accepted ADP 的可静态判定 hallucinated symbol 为零；没有新增 P0；中位设计耗时不超过 baseline 的 1.5 倍。未通过时只修改 schema、Kernel 或硬检查，不继续扩建 Case Library。

#### Phase 1：切片通过后的 1～2 周 MVP

1. 补全 Evidence Capsule、ADP、Case、Pattern、Anti-pattern 五个 Schema，并增加 `--dump-config`、`runtime_inspect`、`cordis_inspect_*` adapter。
2. 用 YAML frontmatter + `rg`/小型 TypeScript 索引实现 lexical retrieval；不引入向量库。
3. 手工整理三个 Golden Case 候选：Task Queue、Runtime Facts、Command Profiles；整理两个 Anti-pattern：启动恢复覆盖并发写、Knowledge candidate 被当作 runtime fact。
4. 构造 8 个不直接复制 Golden Case 的 holdout tasks，覆盖 provider、tool、durable state、UI/wire、settings、model-visible、subprocess recovery 和无需新 seam 的反例。
5. 同一 V4-Flash 配置跑 baseline、Kernel+ADP、full system 三组；每题 2 个 seed，Reviewer 盲评。

#### MVP 验收

- 所有 accepted ADP schema-valid，关键 API 证据都有当前 revision pointer，每个 proof obligation 都有 falsification 与 verification reference。
- accepted ADP 中不存在可由当前生成目录/源码判定的 hallucinated symbol。
- full system 在至少 6/8 holdout tasks 上降低 weighted blocking finding score，且没有新增 P0。
- 中位检索载荷 ≤6,000 model tokens；总设计耗时不超过 baseline 的 1.5 倍。
- 每个 Run 可追溯 `requirement → target/evidence → ADP/proof obligations → review → verification → candidate`。

#### 现在明确不做

- 不做 DSH runtime plugin、Web Workbench 或常驻服务。
- 不做知识图谱、向量数据库、embedding/reranker。
- 不做自动修改 Contract、自动 promotion 或自动删除旧知识。
- 不做多 Agent 常态编排；Reviewer 独立 pass 足够验证价值。
- 不做 SFT/DPO/RL，也不导出未经验证的聊天轨迹。
- 不尝试穷举整个 DSH 源码成为案例库。

## Evolution Plan

### V0：外部认知脚手架

- 结构化证据、ADP、机器校验、词法检索、一个新 Architect Skill、扩展后的 `dsh-code-review`、人工 promotion。
- 目标：在写代码前减少错误 seam、owner 和生命周期漏项。

### V1：闭环开发系统

- Implementer Skill；从 diff/test/session log 自动关联 Run artifacts。
- 将高频 ADP 规则编译成代码静态检查、package invariant 或测试模板。
- source-anchor 漂移自动 quarantine；知识使用效果可统计。
- 高风险或 evidence conflict 才路由强模型/人类 Review。
- 若词法检索 precision@3 持续不足，再加轻量 FTS/BM25；仍不默认向量库。

### V2：受控蒸馏与模型后训练

- 从 accepted ADP 做 SFT：训练任务分类、owner/lifecycle 外化与检索选择，不训练易变 API 记忆。
- 从 rejected alternative / blocking finding / corrected ADP 构造 preference pairs 做 DPO。
- Validator 和真实运行结果可作为 outcome label，但不能把“测试绿”简化成全部 reward。
- 按 DSH tag/version 切分训练数据；API 符号作为检索内容，不作为永久模型知识。
- 新模型必须在 private holdout、mutation tasks 和 live shadow 上同时优于 V1 才替换默认路由。

## 评价体系

### 领先指标（设计阶段）

- Task classification exact-match / multi-label F1。
- Seam 首次选择正确率，以及三角色完整率。
- State owner 完整率与冲突数。
- lifecycle/restart/replay/concurrency obligation 覆盖率。
- hallucinated API/symbol 数。
- evidence pin rate、source freshness failure 数。
- retrieval precision@3、无用加载 token 比例。
- invention rate 与被 Reviewer 驳回率。

### 滞后指标（实现与运行）

- weighted blocking finding score：初始可用 `P0=8, P1=3, P2=1`，之后按真实返工校准。
- 首次 focused test 通过率与真实 entry path 通过率。
- Design Delta Rate：accepted ADP 后改变 seam、owner、存储格式或关键 proof obligation 的任务比例。
- 恢复/并发/取消遗漏导致的回归数。
- model-visible snapshot 漂移与 replay 不一致数。
- 用户人工纠正次数、设计/实现耗时、输入 token 成本。
- Knowledge pollution rate：晋升后在 revalidation 中被 quarantine/deprecate 的比例。

### 评测原则

使用相同模型、配置和工具权限做 paired trials；Reviewer 对组别盲评。测试集包含正常任务、近邻误导任务、缺失事实任务和 mutation tasks。结论必须来自 ADP、tool calls、session events、diff、test output 和 runtime observation，不采信“模型说自己检查过”。

## 示例：增加 `task_queue` 时系统如何改变行为

```text
需求进入
  ↓
Target Lock:
repo + revision + branch/dirty scope + profile
  ↓
Classifier: durable-state + orchestration + subprocess + cross-session + model-consumer，T2
  ↓
Evidence Capsule:
  - Static Manifest 从 current generated catalogs 与 exact source 读取 seam/API
  - Runtime Observations 只记录目标 profile/实例实际观察到的状态
  - ctx.jobs 是 background job registry，但当前需求要求跨进程恢复
  - ctx.subprocess 是进程生命周期 capability
  - model-visible 通知必须可由 session log 重建
  ↓
Retrieve:
  - capability-seam Contract
  - durable scheduler Pattern
  - recovered-PID / startup-recovery Anti-pattern
  ↓
Alternatives:
  A. 扩展 jobs-local：拒绝，process-local owner 不满足 restart
  B. 把 queue state 塞进单 session log：拒绝，跨 session host 状态 owner 错位
  C. 新 ctx.taskQueue Service Definition + durable local Provider + Tool/UI Consumers：选择
  ↓
ADP 强制填写:
  - Task/Notification owner
  - append/fsync/fold 顺序
  - pending→starting→running 两阶段
  - startup recovery 与 PID 非授权语义
  - scheduler 独占 spawn/terminate/wait
  - faulted、retry、cancel、outbox ACK CAS
  - tool ingress 与 shell trust boundary
  - session-log notification 与 replay
  - 每项关键选择的 proof obligation、falsification 和 verification reference
  ↓
Validator/Reviewer 在写代码前阻止:
  - 只有 Tool 没有 Service Definition/Provider
  - 没有重启恢复矩阵
  - 用持久 PID 跨重启 kill
  - pre-step flush 被误当作通知已 durable
  - 并发 mutation 无单一序列化 owner
  - maxConcurrent 被硬编码
  ↓
实现 + focused tests + real subprocess path
  ↓
startup recovery race 若首次出现，只生成 Anti-pattern candidate；验证后再晋升
```

原流程依赖 V4-Flash 自行记住十几个关系；新流程只要求它在有限候选中做语义判断，其余事实定位、字段完整性、机械冲突和晋升治理由系统承担。

## 最终取舍

这个系统首先是 **架构质量控制与学习数据生产系统**，其次才是知识库，最后才是模型训练系统。第一版成功的标志不是目录漂亮或 Case 数量多，而是：V4-Flash 在较小上下文中更早暴露未知项、更少创造错误 seam、更完整地指定 owner/lifecycle，并让 blocking finding 在实现前下降。

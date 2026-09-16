# 现场浏览器 Agent 领域交付 DAG

状态：现场纵切已通过，当前源码修复待重启现场复验。本文把 2026-09-12 至 2026-09-16 的现场 Session 时间线转成依赖明确的交付卡；它不以单个工具恢复、单元测试通过或模型口头声称完成来关闭总目标。

## Charter boundary

- **Approved outcome:** 用户从 Chrome 扩展发起网页任务后，DeepSeek-v4.1-flash 绑定正确页面对象，以有界证据完成读取、分析和页面展示；页面变化、未知写入、人工介入和委派都保留因果关系，只有验收条款满足且页面资源归宿明确时才报告完成。
- **Entry path:** Web Profile 中的 Chrome 扩展 `field-cordis` Session，调用标准 Agent preset 的 Browser、Cordis、Jobs 和 Subagent 能力。
- **Top-level closing condition:** source、生成声明、Profile 组合与现场 runtime 一致；受控故障矩阵通过；真实 DeepSeek-v4.1-flash 完成代表性纵切；Session 投影可回放其能力、证据、动作、委派、验收及资源处置，未决动作或资源不会被报告为完成。
- **Explicit non-goals:** 不新增通用 Workflow/Job/Subagent 状态机，不把 DOM 全文或截图写进领域投影，不让 `tool-browser` 的进程内 Map 成为权威，不承诺任意站点的一次性选择器。
- **Current charter status:** `live vertical passed; source/runtime revalidation pending`
- **Self-hosting:** `no — Codex 实现并由独立检查验证；最终 DSH 现场运行只做产品验收，不修改本次候选源码`

## Dependency graph

```text
I1 browser baseline ─┐
                     ├→ I3 tool bridge ─→ I5 composition ─→ I6 controlled acceptance ─→ I7 live acceptance
I2 task kernel ──────┘             │
                                   └→ I4 Cordis / Job / Subagent causality ─┘
```

## Delivery cards

### I1 — 浏览器基础契约与生命周期

- Role: `provider`
- Depends on: none
- Owns: Browser page/action/request identity、扩展能力握手、page-map 证据、region 资源真实状态和恢复回执。
- Advances: R1、R2、R5。
- Does not close: R3、R4、R6、R7；Charter 仍为 `in progress`。
- DoD: caller 在派发前持有 request id；真实扩展能力可发现；`document_replaced` 与 `target_url_stale` 分离；replace 不能绕过 page-map 保护；unknown 保留容量与清理义务。
- Verification and artifact: Browser definition/provider/Chrome focused tests、跨包 typecheck、历史失败回放。
- Failure/uncertainty: 断线或同文档 URL 漂移保留为 unresolved，不伪装成资源已消失。

### I2 — Session 持久 BrowserTask 领域核

- Role: `kernel`
- Depends on: none
- Owns: `Task/Acceptance`、`PageEvidence/TargetBinding`、`ActionAttempt/Receipt`、`PageResource/Lease`、`Capability/Authority` 及委派因果引用的 Session 事件、严格 fold 和 projection。
- Advances: R2、R3、R4、R5。
- Does not close: R1、R6、R7；Charter 仍为 `in progress`。
- DoD: Session log 是唯一权威；CAS 阻止陈旧写；unknown/in-flight 写、未满足验收或未处置资源均阻止 completed；V1 只有已释放或确证随文档/路由消失的资源才能关闭，`retained` 所有权转交仍是延期能力。
- Verification and artifact: replay、projection failure、target drift、capability drift、unknown、cleanup barrier、retained 拒绝与 delegation-not-acceptance 测试。
- Failure/uncertainty: 非法持久事件 fail closed，并在 projection failure 中保留首个错误。

### I3 — Browser 工具与 continuation bridge

- Role: `bridge`
- Depends on: I1、I2
- Owns: `tool-browser` 在动作派发前写 attempt、回执后 settle、观察后写 evidence、验收后 evaluate；旧 `BrowserTaskLoop` 仅保留续轮策略。
- Advances: R3、R4、R5。
- Does not close: R6、R7；Charter 仍为 `in progress`。
- DoD: 不静默换页；人工介入使相关证据失效；`observed` 只证明局部页面效果；最终完成来自 BrowserTask projection 而非工具文本。
- Verification and artifact: tool policy/loop tests、recorded Session replay、unknown request-status 恢复。
- Failure/uncertainty: 领域事件无法持久化时不派发写动作；回执持久化失败时保持 request id 并停止冲突写。

### I4 — Cordis、Job、Subagent 因果与资源桥

- Role: `bridge`
- Depends on: I2、I3
- Owns: 动态插件、Job、Subagent run/version/output 的轻量引用；Cordis region lease 的 acquired/release/vanished/unresolved 事实。
- Advances: R4、R5。
- Does not close: R6、R7；Charter 仍为 `in progress`。
- DoD: 委派成功只是工作事实，必须由 Acceptance 接收；插件停止只有 observed clear 或确证 document replacement 才关闭 lease；同文档 URL 漂移继续 cleanup pending。
- Verification and artifact: runner teardown/reconciliation tests，历史 `subagent_codex` Session 因果回放。
- Failure/uncertainty: Job/Subagent/Cordis 中断映射为 blocker，不丢失其稳定 identity。

### I5 — 组合、目录与文档

- Role: `composition`
- Depends on: I1、I2、I3、I4
- Owns: Base/Web bundle 组合、标准 Agent preset、package references、persistence/tool/Cordis catalogs、Browser 文档和 Agent Note。
- Advances: R1、R6。
- Does not close: R7；Charter 仍为 `in progress`。
- DoD: built Web Profile 同时具有 provider、BrowserTask 服务和模型工具；生成物只包含本能力或单独说明的前置修复；包 README 不再描述旧工具面。
- Verification and artifact: dump-config、catalog verifiers、typecheck、build、独立 composition test。
- Failure/uncertainty: source、generated declaration 或 live tool set 任一不一致都阻止进入现场验收。

### I6 — 受控网页故障矩阵

- Role: `acceptance`
- Depends on: I5
- Owns: 动态列表五项纵切及 SPA pushState、document replacement、iframe、多标签/弹窗、人工介入、unknown write、能力漂移、委派中断和 cleanup unknown 场景。
- Advances: R2、R3、R4、R5、R6。
- Does not close: R7；Charter 仍为 `in progress`。
- DoD: 独立 checker 从 Session projection 验证 coverage、目标、分析产物和资源 disposition；修复不得只在开发样本上升级结论。
- Verification and artifact: keyless recorded-session 证据、focused E2E、保存的验收报告。
- Failure/uncertainty: 留出样本一旦用于调试即转为回归集，需新的未披露样本关闭泛化结论。

### I7 — 真实 DeepSeek-v4.1-flash 现场验收

- Role: `acceptance`
- Depends on: I6
- Owns: 真实 Chrome 扩展入口、DeepSeek-v4.1-flash 路由、代表性任务及人工视觉判断。
- Advances: R7。
- Does not close: none。
- DoD: 在明确的正常用户 Profile、端口与已确认费用边界下完成真实纵切；保存 Session JSONL、模型工具调用、BrowserTask projection、页面结果和清理证据；独立审查确认无未决动作或资源。
- Verification and artifact: 现场 Session id、日志报告、页面截图/人工确认、最终五层证据清单。
- Failure/uncertainty: 实际扩展未连接、授权变化或需要验证码时进入 waiting，不以替代 provider 或模拟页面冒充现场通过。

## Requirement traceability

| Requirement | 含义 | Owning Issue(s) | Required evidence | Current status | Charter-closing? |
| --- | --- | --- | --- | --- | --- |
| R1 | 五个现场能力及调用身份不再随部署消失 | I1、I5 | capability handshake、tool catalog、live dump | implemented / verified | no |
| R2 | 页面与资源生命周期可区分 replaced、stale、unknown | I1、I2、I6 | provider/runner tests、projection replay | implemented / verified | no |
| R3 | 任务、验收、证据和目标绑定为 Session 权威 | I2、I3、I6 | durable events、projection、checker | implemented / verified | no |
| R4 | 动作和委派保持因果且不把局部成功当任务完成 | I2、I3、I4、I6 | attempt/delegation refs、acceptance facts | implemented / verified | no |
| R5 | V1 页面资源必须 released 或由文档/路由替换确证 vanished；retained 转交延期 | I1、I2、I4、I6 | lease projection、cleanup evidence | implemented / verified | no |
| R6 | 源码、生成物、组合和 built runtime 一致 | I5、I6 | build/catalog/dump/E2E | implemented / verified | no |
| R7 | 真实 DeepSeek-v4.1-flash 扩展纵切通过 | I7 | saved live Session and human page check | live vertical passed | yes |

### 现场可追溯证据

- `session-798a72f9-747d-4091-9b4a-d5f1f9ed0dd7` 运行 `browser-task-48e6b261-5381-4bc5-bbbf-0122cd4256b5`：seq 98 与 109 为 action receipt，seq 112 为 checker fact，seq 114 为 `completed`，seq 115 为 `verified`。这条纵切证明 DeepSeek-v4.1-flash 能在现场扩展入口以 BrowserTask 证据闭合任务。
- `session-472511c4-abad-44cd-9310-bd6e15c1f336`：`region_render` 请求 `29a597d4…` 在 seq 59/61 已观察到并处于 `active`；`region_clear` 请求 `21f89d7d…` 在 seq 121/123 已观察到，资源为 `released` / `clear-observed`；seq 135 为 checker fact，seq 137 为 `completed`，seq 138 为 `verified`。这条纵切证明页面资源可从现场渲染到有证据的恢复。

两条 Session 均来自 06:37 启动、端口 3080 的 runtime。它们构成 R7 的现场通过证据。现场随后暴露 schema、页面顺序和 `active` resource cleanup blocker 问题；这些修复已在源码和后续测试中闭环。`active` 资源不再阻止继续观察，但 V1 仍阻止 completion，直到资源被释放或确证随文档/路由消失；所有权转交尚未实现。该 runtime 尚未重启以验证这些后续修复，因此 R1–R6 的 `implemented / verified` 是源码、生成物、构建、目录以及 359 项后续聚焦测试的结论，不是新 master 的 3080 现场重启复验结论。

## Merge and review order

按 I1 → I2 → I3 → I4 → I5 → I6 → I7 的依赖顺序形成可审查的本地 master 提交。机械生成目录前置修复若与浏览器能力无关，单独成提交。**未授权 GitHub PR、push 或发布操作。**

## Risks and decisions required

- 真实模型验收继承 2026-09-11 已记录的 5 RMB 总预算，但执行前仍必须确认 provider 路由、剩余额度和本次样本清单。
- V1 不支持把最终面板 lease 转交给 Session/用户；任务关闭前必须清理或确证其已随页面消失。未来若实现 retained，必须先增加显式 owner-decision 事件和验收测试。
- `BrowserTask` 投影必须有界，只引用 Session seq/call id/digest/attachment，不复制页面正文、模型输出或截图 base64。

## Final gate

`R7 已有真实入口通过证据，但 Charter outcome 仍未关闭：必须以当前 master 重建并重启 3080，复验现场暴露的 schema、页面顺序与 active-resource 规则，再将该 runtime 的证据与全部可回放前置卡一并确认。`

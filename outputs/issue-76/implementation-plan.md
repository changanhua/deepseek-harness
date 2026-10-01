# Issue 76：SSP-WP1 实施计划

权威：[Issue 76](https://github.com/changanhua/deepseek-harness/issues/76)、[产品规格](../../docs/specs/2026-09-30-side-effect-safety-plane-fc27-first-adapter.md)、当前源码及 owner docs。基线为 `codex/side-effect-safety-plane`；不修改其它开发分支。

1. **所有权**：采用 `packages/guard/side-effect-safety` 一个 Host Service + Storage Domain consumer 包。guard 当前是 loop-hygiene family，但没有禁止 durable runtime guard 的依赖约束；扩展其 group map 为运行时防护，不新增顶级 group，也不为了尚不存在的第二存储实现拆空 provider 包。
2. **审批**：复用 `ctx.approval.request` 发起一次“激活精确摘要、预算和有效期”的确认；额外要求 Host adapter 提供可核验的人类确认身份及证据。`allowed-once` 字符串和 Planning adoption 都不是 durable authority；内核只保存完整冻结的授权记录，不暴露模型工具或 Remote mutator。
3. **Browser 对齐**：持久意图先于发送；SENT 表示可能发生；崩溃后只查询/对账，不 replay；查无 journal、timeout 和 lease expiry 不等于未发生。WP1 不导入或改造浏览器传输。
4. **Delivery 对齐**：PREPARED/SENT/UNKNOWN 映射 prepared/publishing/unknown；显式证据结算。Delivery 的 confirm-not-created 可以回 prepared，而本内核按更严格规格将原 action 永久终结为 NOT_APPLIED，新动作必须新 identity；不复制 publication workflow。
5. **存储 owner**：本包声明 `side_effect_safety` Storage Domain；一个有界 global snapshot 原子保存全部 execution/approval/action/lease。复用 Storage Domain 的落盘先于发布和单链写入。本 Service 额外序列化读改写，支持一个 Host writer 的 CAS；不宣称跨 Host 分布式锁。
6. **状态机**：PREPARED → SENT → CONFIRMED / NOT_APPLIED / UNKNOWN；UNKNOWN → RECONCILING → CONFIRMED / NOT_APPLIED / UNKNOWN。PREPARED 可 CANCELLED；任何已发送状态不可回 PREPARED。
7. **SENT commit**：execute 消费不可伪造、短时、单 action handle，在相同串行事务内重查当前审批、lease、policy、预算、revision，原子记 SENT + 消费预算，await durability 后才进入已绑定 executor；无公开 raw payload executor。
8. **UNKNOWN**：重启将孤立 SENT 持久化为 UNKNOWN，丢弃进程内 handle；UNKNOWN/RECONCILING 保留身份并阻断后续 action。reconcile 只调用 adapter 的只读 inspect，必须有证据才能终结；未决期间无清除/waiver 路径。
9. **预算**：批准 artifact 冻结 budget。每次 SENT 原子消费 intent 中的非负整数量纲；计数由 ledger 导出。NOT_APPLIED 也保留尝试预算，以保守上限避免重试退款扩权；domain dimension 缺少明确上限则拒绝。
10. **lease**：业务执行权绑定 execution、approval、domain target、runtime owner 和期限；同 target 独占，旧 lease/handle 不能推进新 epoch。它不是 Session 日志 writer 的 OS lock；本轮仅支持单 Host storage owner。
11. **幂等与 CAS**：request identity 与规范摘要绑定，重试返回原 action（包括终态）而不重复发送；同 identity 异摘要持久 BLOCKED。修改要求 expected revision，写失败不发布；完整 ledger 和预算同原子文档，重启检查关联一致性。
12. **未来 FC adapter**：approval-preview、risk-preflight、execution-gate、write-lease、transaction-readback、execution-dry-run 为 WP2 的复用输入；WP1 不 import FC 模块。
13. **外部缺口**：完整 inventory、市场权限/报价、solver proof、真实 executor、浏览器传输 requestId 映射均不实现；不产生真实外部 write。
14. **bypass 证明**：raw object、复制 handle、其它 adapter/实例 handle、重复 handle、过期 handle、policy 或 lease 在 admit 后变更、持久 SENT 失败均不得调用 executor；测试同时断言 ledger 和 synthetic invocation count。
15. **文档/验证**：新增 package README 双语、guard group 对应说明、Agent Note、计划和验收报告。运行 synthetic 测试（包括真实 JSON storage 重启、CAS、预算、批准失败和故障注入），Loader 组合测试、focused typecheck/lint、相关 package/docs 检查。全仓 baseline failure 单独记录，不顺手修。没有模型/Session/浏览器 UI 变化，不生成伪造的模型快照验收。

## 停止条件

SSP-WP1 证据完成后交付 commit/PR 并停止；不进入 SSP-WP2。若产品 invariant 与源码冲突，先报告再改变设计。

## 获准的实施内修正

用户在实证发现 Dynamic Cordis 可直接改写底层账本后，明确同意将最小存储权限修复纳入 #76。修复保留普通业务服务和静态 Host 能力，封闭 raw hub/facility/registry/backend/KV 身份及反射通路，向动态监听器提供 detached domain-change payload。它不建立任意 Host 代码沙箱。验证增加真实 keyless headless 拒绝 transcript。

连续失败预算使用持久 `sentRevision` 而不是 prepare 数组顺序；同毫秒时间戳与重启都不改变发送顺序。这是 WP1 确定性预算不变量，无兼容迁移 shim。

# RIR-WP1 部分交付与验证记录

- 实现基线：`master@b3b4c0183a77d2c13576d4eaaeeffb2b1c4676f3`
- 规格修订基线：`763469c77bea643dee7c3ce1c5ce23d88eb717d8`
- 状态：按用户 2026-10-01 的选择性交付要求收口；不宣称完整 WP1 验收通过
- 范围以 [正式规格](2026-10-01-requirement-investment-review-wp1.md) 为准；WP2/WP3 没有实现

## 已实现

独立 Assessment domain/local provider、Storage Domain 持久化、不可变输入与历史、可信 Host actor/workspace、持久请求预留与幂等、单次有界 LLM runtime 调用、无可执行工具、严格结果 schema、只读 Planning 关联与 drift 投影、可信 Remote，以及可选手工页面和 Plan/Focus 入口。默认 profile 不变，用户通过 personal-planning 的 investment-review.patch.yml 显式装配。

初次评估、历史读取与重新评估均不能调用 Planning mutation、Delivery 或 Queue。旧 Focus/Manual 输入不会用当前数据重建。未知模型后端身份明确 unknown。失败/取消后的请求预留不会自动再次花费模型用量，显式新 request id 才可开始新的尝试。

## 已执行的验证

- 聚焦测试：14 个测试文件，60 项通过，涵盖 domain/local、真实 Loader/Include 装配、实际 shipped patch 的隔离上下文、既有 LLM runtime（仅模型 adapter 为 fixture）、无工具执行、持久幂等、取消、错误输出、漂移、reload、UI 生命周期，以及 Planning 现有测试回归。
- Host / Client TypeScript aggregate 和新增 UI browser bundle 单独检查；最终结果以本 PR 的提交说明及 CI 为准，不把 fixture 测试称为真实模型质量验收。
- 新增/修改的 10 份文档对通过定向配对检查；Spec 目录遵循现有 manifest 排除，不改变检查规则。
- 新增服务没有空 invariant companion；沿用源头校验、原子写入与对应负向测试。

复现聚焦测试：

```sh
node node_modules/vitest/vitest.mjs run packages/requirement-assessment packages/client/ui-requirement-assessment/tests packages/client/ui-planning/tests
node --max-old-space-size=3072 node_modules/typescript/bin/tsc -b tsconfig.host.json
node --max-old-space-size=3072 node_modules/typescript/bin/tsc -b tsconfig.client.json
```

依赖使用现有 registry 解析版本，冻结 lockfile 安装检查。当前云环境 Node 安装不含开发头文件，本地 flock 使用此前获取的对应官方 Node 24.19.0 headers 按仓库相同编译参数构建；未提交二进制或改动 native 源码。原 tsx CLI 遇 IPC EPERM 时使用同一脚本的 `node --import tsx` 入口。

## 明确保留的缺口

1. 三个真实模型 Case 均为 **UNVERIFIED**：FC27 SBC Solver / Side-effect Safety Plane / RIR 自身。当前执行环境未配置实际模型路由凭据，没有编造模型输出、人工意见或决策增益。fixture 输出只用于机制回归。
2. 没有完成真实浏览器实页操作验收；组件测试、注册/卸载测试及 browser bundle 构建不能替代该验收。
3. 全仓文档/合规门禁存在既有失败，不能声称 CI 全绿。原文档基线 md-links 19、md-wrap 36、pairing 136，以及 package invariants 67；本任务不修无关缺陷。全仓 generated catalogs/graphs 的完整同步仍需处理已有 baseline drift 后复核，本交付只加入新 owner 的子系统页及服务分类。
4. 历史面板不持续轮询；同一对象外部变化后需点击刷新以获取最新 drift。不会因为 stale 自动重跑。重新评估保留旧用户补充材料，同时由 Host 重读当前 Planning。
5. 本地 provider 是单 Host、有界存储，没有归档/自动清理；长期达到容量上限会明确拒绝。未知已消耗请求需要人工决定是否以新 id 重试。

## 继续验收的最小路径

在已有可用模型 adapter/凭据的 DSH 环境设置 RIR provider/model，按 bundle README 装配可选 patch。通过手工页或 Plan/Focus 入口运行正式规格的三个 Case，保留实际输入、来源、原始输出、模型标识和人工比较。SSP 的未合并代码必须作为未合并能力标明，FC27 历史页面资料不能当实时事实。允许有依据地维持原决定或选择相同 route，不以命中预期路线验收。

整个验收只评估投资判断，不进行真实 FC、browser、Delivery 或 Queue 写操作。完成上述质量与实页检查前，PR 保持 Draft，不 merge。

## 分支并发变更适配

交付时发现远端 PR 已由另一操作将 master 合入，head 为 `33af00699fdbdc321469e321b421e4f22099bec8`。最终补丁改为针对该精确 head；三方应用仅在 Host tsconfig 的新增引用处冲突，已保留现有 Side-effect Safety 引用并追加 RIR 引用，其余变更干净合并。没有覆盖远端现有 SSP 代码，也没有由本任务再次合入 master。

补丁应用检查在该 head 上通过。上文 60 项测试及 Host/Client 类型检查仍对应原实现基线，未在适配后的整个树上重新运行；不能将补丁可应用等同为新基线全部验收通过。

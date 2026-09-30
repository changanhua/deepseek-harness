# Issue 77 Phase A 实施计划

## 权威与 reconnaissance

本任务产品权威为 Issue 77 及其 2026-10-01 Spec；实现事实以根/包/文档 AGENTS、architecture、capability-seams、browser/BrowserTask、planning/ResourceRef、Storage Domain 和现有源码为准。已检查 2026-09-10 页面模型、2026-09-26 FC handoff、2026-09-25 SBC 设计及 fc-web-app Skill/application-model/tool-bindings，逐个核对 main-read、page-model、inventory-snapshot、puzzle-solver、core、native-chemistry、quote-preflight、readiness 与相应 fixture 测试。

## 放置与依赖

新增 packages/domain-runtime 组：domain-runtime 只拥有 artifact 元数据合同与 provider registry，fc-sbc-domain 拥有 FC Reality/Plan 和 Storage Domain，tool-fc-sbc-domain 仅消费 typed FC service。browser 拥有浏览器 transport 与授权，planning 拥有 canonical Board，experimental 不应成为 released consumer 的依赖；均不适合拥有跨领域 artifact registry。更新组图、architecture、子系统页及包 README；使用 downstream personal identity 登记，不误归 upstream。

现有 FC JS 保留为算法唯一来源。FC owner 使用内部 typed bridge 与包级构建 alias 复用白名单纯模块；Host 发布包内包含纯计算实现，不发布指向 apps 的运行时路径，也不复制算法。readiness 总入口连带 approval preview / execution dry-run，因此只提取可共享的观察/候选 readiness 判断，不调用原执行评估链。native chemistry 本身需要页面服务，本阶段不运行，缺少验证时沿用 solver 的 provisional/missing-evaluator 语义。

## 公有 API 与所有权

通用服务 ctx.domainArtifacts，DomainArtifactRef/Header/View、DomainSourceRef、DomainDescriptor、DomainRuntimeProvider。注册、发现、按精确 ref 读取 header/payload、读取直接父 refs；重复 provider 和未知 domain fail closed。只验证 JSON、identity 和有界元数据，不解释 payload、不做中央持久化。注册为 Cordis effect，HMR 移除后新调用不可路由。

FC 服务 ctx.fcSbcDomain：captureReality、buildPlan、getStatus、readArtifact。只接受已取得的 typed read/probe observation；Phase A 不新增 live browser transport。来源内容显式字段投影；URL query/hash、DOM、token 和未声明字段不入持久 artifact。稳定实例身份与 provenance 保留。Storage Domain 是唯一持久 owner，schema 校验冷读，canonical SHA-256 内容身份，相同输入幂等。读返回 detached clone，写入以单一 owner 串行链实现不可变发布与总容量边界。

## 语义

完整库存必须同时有 club/SBC Storage 明确遍历结束证据、完整 coverage 与无身份错误/重复，visible-only 永不升级。group 的完整性独立保守判断。capture timestamp 是观察时间；未给 expiry 时 freshness unknown，有明确 expiry 才可判断 fresh/stale；后续读取计算 current freshness，不改 artifact header。Plan 固定 exact Reality ref，派生关系包含 digest。候选搜索上限、缺字段、未验证 chemistry/rating、partial 库存、quote missing 和任务类型各自显式报告；不把有限无结果称为数学无解。Phase A 无 real quote provider，绝不形成 ready-for-approval。

## 验证层次

- 单元：两个无关 fake providers，重复/未知/错引用、detached metadata/payload、完整 UTF-8 metadata 字节上限、abort、HMR disposal
- FC fixture：真实 main-read 输出合同、partial/重复/丢 identity、query/token/DOM 丢弃、稳定 digest、相同请求幂等与冲突、容量失败无发布
- Plan：existing solver golden fixtures，exact lineage，bounded empty/provisional 搜索，quote missing，旧 Reality 不变，同输入并发幂等，过期后不改历史
- 真实组合：test-only cordis.yml 经 Loader 启动实际 Storage JSON/Domain、registry、FC owner 与工具；写盘、完整 dispose、重新构建 Context/Loader 后读回同 artifact
- 模型界面：确定性真实 tools registry 测试 inspect/plan/status 的 artifact ref 与有界摘要，固定输出记录；不注入 browser/Planning/Safety 执行依赖，静态依赖与调用计数均确认外写为零
- 运行相关既有 FC 回归、focused TypeScript、包/文档约束和 diff check。全量 gate 或真实浏览器/模型未运行部分明确报告；无关基线问题只记录不修复

## 有界抽象与停止条件

只有 FC 已证明需要的身份、时间、coverage、lineage、发现和读取进入 generic contract；不建 ontology、workflow DSL、通用 solver、JSON invoke 或中央 payload 库。完成 WP1/2/3 与可控 WP3.5 后停止；不进入 Safety、Executor、真实 quote、任何 purchase/fill/submit/market/browser 外写，不修改 Planning/Thinking Desk，不合并 master。最终 verification-report 对应 Issue 的 15 项交付要求。

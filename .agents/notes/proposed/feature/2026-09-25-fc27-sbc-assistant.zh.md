# Agent Note: FC 27 SBC 助手

Status: proposed

[English](2026-09-25-fc27-sbc-assistant.md) | 中文

## Problem

个人浏览器助手可以操作 FC Web App 页面，但通用页面动作无法决定消耗哪些已有卡、购买哪些缺卡，也无法证明提交后的 SBC 确已完成。错价和结果不明的购买会损失金币或不可恢复的卡牌。用户希望先确认一份可审阅的 SBC 方案，然后自动采购和完成任务，不逐卡重复申请权限。

## Proposal

从现有浏览器助手入口增加 FC 27 拼图 SBC 能力。读取一组挑战、俱乐部及 SBC Storage 库存，确认 Web App 市场权限并取得带版本的报价，在共享卡池约束下求解整组。展示已有卡、保护卡、待买卡版本、单卡最高价、总预算和精确的提交范围。用户直接确认一次有期限的方案后，确定性的控制器在持久预留/实付预算账本约束下购买缺卡，采购结束及每关提交后核对库存，填入各关、检查 EA 页面显示的要求，并只提交已批准的关卡。每个不可逆动作都保留请求身份和读回证据。浏览器站点授权持续有效；方案变化或过期则需要重新确认方案。

[详细设计](../../../../docs/specs/2026-09-25-fc27-sbc-assistant.md) 负责流程、最小领域记录、失败状态、风险控制、交付切片和证据要求。FC 27 的简化 Item Score SBC 因部分提交也会耗卡，需要独立的求解器和执行器；首个纵切只覆盖传统拼图 SBC。

## Current implementation slice

这一切片现在还会为每个批准预览生成稳定的审阅摘要和规范化的 session / installation / tab / club / page / inventory 身份，并把该摘要贯穿 readiness、脱敏报告、JSON 样本包和侧栏预览，使后续执行能够发现“已审阅输入”和“执行输入”不再匹配的情况。

它还新增 `apps/chrome-extension/src/fc-sbc-execution-gate.js`，作为后续写动作前的纯执行 gate。该 gate 会比较已审阅摘要、当前身份、批准窗口、同标签写租约、购买价格上限和提交/填阵范围，然后只返回 ready 或 blocked，不购买、不填阵、不提交，也不写浏览器。

`apps/chrome-extension/src/fc-sbc-write-lease.js` 定义配套的纯写租约记录：它可以签发、校验和释放一个绑定批准摘要与页面身份的限时租约，已释放租约现在会阻塞 execution gate。它仍不获取真实浏览器锁，也不派发任何写动作。

首个源码切片新增 `apps/chrome-extension/src/fc-sbc-core.js` 及类型声明。它可以在整组候选阵容中排序方案，避免复用同一库存卡，拒绝锁卡以及过期或缺少观测时间的报价，创建有期限的方案批准，在请求前预留采购预算，结算已确认或未知的购买，并要求 EA 页面读回后才把提交请求视为完成；现在还会拒绝不属于选中方案的提交批准范围。`apps/chrome-extension/src/fc-sbc-page-probe.js` 新增自包含的只读 DOM 探针，用于报告已识别的 FC 页面、拼图与 Item Score 任务类型、可见挑战、市场权限文字证据，以及仅限可见页面的库存覆盖状态。`apps/chrome-extension/src/fc-sbc-inventory-snapshot.js` 新增纯完整库存快照合同，可把已经读到的俱乐部、SBC Storage 和可见卡牌行规整为求解器可用的卡实例，统计 Storage、锁卡与可交易卡，拒绝缺身份或重复实例，并记录覆盖未证明状态，但它本身不抓取 EA 页面。`apps/chrome-extension/src/fc-sbc-transaction-readback.js` 新增纯交易读回合同，可把已经观测到的购买新增卡、实际价格、余额变化、关卡完成和卡池变化分类为 confirmed、completed、unknown 或 blocked，而不发送购买或提交动作。`apps/chrome-extension/src/fc-sbc-field-audit.js` 会把探针、库存快照和交易读回结果转成 page/task/market/inventory/readback 字段覆盖，明确标出完整俱乐部库存采集、购买读回和提交读回等仍缺真实页面样本的部分。`apps/chrome-extension/src/fc-sbc-quote-preflight.js` 新增纯计算报价与风险预检，检查同平台、新鲜、正价报价和市场搜索上界；缺价、过期、无效、平台错配或搜索量超限都会在采购前阻塞批准。`apps/chrome-extension/src/fc-sbc-execution-dry-run.js` 新增纯执行预演，可从候选方案或批准快照派生采购队列与提交队列，计算预算预留和每卡搜索上限，并报告超预算或搜索量超限阻塞项，同时保持浏览器写入、购买、填阵和提交全部为 false。`apps/chrome-extension/src/fc-sbc-risk-preflight.js` 新增纯风险暴露预检，会量化计划购买数、市场搜索数、提交数、市场可见性和未知交易读回数量，并明确说明不能证明不会封禁。`apps/chrome-extension/src/fc-sbc-approval-preview.js` 新增纯批准预览，会汇总选中方案范围、预算、购买数、提交数、默认批准窗口、执行预演和风险状态，但不生成真实批准或浏览器动作。`apps/chrome-extension/src/fc-sbc-readiness.js` 将探针、库存快照、交易读回、字段审计、报价预检、执行 dry-run、风险预检、批准预览和求解输入合并成批准阻塞项、后续缺口和下一步安全动作，使页面、库存、交易、价格、执行、风险、批准范围或求解覆盖不足时进入明确的 draft-only 状态，而不是尝试执行；执行 dry-run 或风险预检为 blocked 时现在会关闭最终批准。`apps/chrome-extension/src/fc-sbc-comb-report.js` 会格式化脱敏的第一道梳理交接报告，只保留页面状态、计数、阻塞项、后续缺口、字段缺口、报价覆盖、批准预览摘要和可见要求/奖励行，并丢弃 URL 查询参数、私有实例 ID、卡牌文本样本和原始 DOM 片段。`apps/chrome-extension/src/fc-sbc-redacted-sample.js` 会生成机器可读 JSON 样本包，在同一隐私边界下补充库存统计、报价预检、可用时的库存快照聚合摘要、可用时的交易读回状态摘要、可用时的执行 dry-run、风险预检、批准预览与隐私标志。扩展侧栏现有 `SBC` 标签页，会对已固定目标页运行只读探针，展示 readiness 阻塞项、后续缺口、字段覆盖计数、字段缺口标签、无副作用执行 dry-run、风险暴露计数和封禁风险免责声明，以及批准预览的预算与范围计数，预览脱敏报告，并且只在用户点击对应交接按钮后，把报告或 JSON 样本包发送到当前对话。`apps/chrome-extension/src/assistant-runtime.js` 仅通过只读的 `dsh-assistant-fc-sbc-plan`、`dsh-assistant-fc-sbc-probe` 和 `dsh-assistant-fc-sbc-readiness` 消息暴露规划、探针和 readiness 能力。它尚未从 EA 抓取完整 FC 库存、证明真实市场权限、购买卡牌、填阵、提交 SBC、持久化领域运行或强制同标签页写入租约。

## Ownership boundary

复用现有 Browser 定义、经认证的 Chrome 提供者、精确页面身份、授权 epoch、请求日志和状态查询。FC 挑战解析及页面交互归扩展适配器，市场报价归可替换提供者，优化归本地求解器。由 Session 支撑的领域运行持有不可变的方案批准、预算账本、动作记录和结果；该 Session 的模型工具只读取及提出方案，只有绑定批准方案的领域执行器可以购买或提交。运行期间按页面限制其他 DSH Session 对该标签页的写动作。模型文字不能授权额外花费，也不能把局部点击回执当作任务完成。通用 BrowserTask 的续轮与动作预算不负责整组多关采购运行。

本提案补充[个人浏览器助手 V2 提案](2026-09-20-personal-browser-assistant-v2.zh.md)和现行 Browser 操作决策，不改变通用目标、权限或清理规则；两项提案均未取代对方。

## Alternatives considered

**复制现行 FodderGG 客户端和求解器。**其发布的用户脚本动态加载远端更新的代码，托管求解器也不是已确认可供 DSH 复用的授权源码；它的 FC 27 流程只作为产品参照，不直接纳入依赖。

**让模型用通用 Browser 工具逐步点击整组任务。**这会让价格上限、卡实例身份、批准范围和未知成交恢复停留在非结构化提示里，而通用任务循环的动作数也有上限。领域方案和确定性执行器将这些义务写成明确合同。

**每张卡单独审批。**用户已经确认精确的卡牌清单与上限，再逐卡询问会增加操作负担。一次方案确认覆盖列明的购买与提交；超出方案的动作需暂停并提供修订方案。

## Acceptance criteria

在真实 FC 27 Web App 上，用户从已安装的 DSH 扩展批准一份方案后，完成一组拼图 SBC，并看见真实购买、消耗的具体卡实例、余额变化、完成的关卡、奖励及未决动作。缺卡购买、填阵和获准提交均从 EA 页面状态独立核验。市场权限缺失在批准前阻止执行；未知购买保留预算预留且不得盲目重试；过期报价、目标变化、锁卡、批准过期、跨 Session 写入和超预算均停止执行。源码、生成声明、组合、运行时和真实行为证据一致，才能称 Epic 完成。

## Risks

EA 禁止游戏内自动化并明确提及自动购买工具；减少动作与限制花费不能证明不会封禁。报价可能过期，浏览器权限或页面模型可能变化，提交也不可撤销。首个交付须在真实账号上验证当前 FC 27 字段及交易读回，才能声称支持现场流程；现有代码或第三方插件都不是该纵切已经可用的证据。

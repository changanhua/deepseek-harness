# 需求评估 Quick Review

[English](README.md) | 中文

通过现有 LLM runtime 运行 RIR-WP1 Quick Review。必须明确配置 `provider`、`model`、`dshBaseline`、`maxInputBytes`、`maxOutputBytes`、`maxOutputTokens`、`timeoutMs`。不能可靠识别 DSH 基线时使用 `unknown`。不创建第二套 agent loop。

## 权限与生命周期

`requirementAssessmentReview.review(access, input, signal)` 将可信 Host 权限与严格用户输入分开。评估前一次性读取 Planning，保留准确上下文、Focus 内容、手工证据及模型请求。用户证据一律标记未核验。资源引用是 opaque 定位符，不自动抓取。

Provider 在调用模型前持久预留 request id。并发相同调用共享结果，已完成重试恢复原结果。中断、拒绝或格式错误保留预留，防止重启后重复花费；用户可明确使用新 request id 重试。重新评估在调用前验证旧结果属于同一 subject。

Runner 不提供工具、工具执行器、Delivery、Queue 或 Planning mutation 路径。拒绝工具调用、不完整流、截断、错误/拒绝 JSON 与 schema 不符输出。输入字节限制包含完整请求包装，输出限制计算每个流块，包含 reasoning 与 metadata。调用者取消、超时和插件卸载取消评估，卸载等待在途工作结束；adapter 必须遵守 runtime 取消合同。

## 不变量策略

不发布 invariant companion（No invariant companion is published）：immutable 结果和预留由 provider 拥有，本包只保留操作期间的 promise。

## Model Experience

### 固定 Quick Review

#### What the model sees

`ctx.requirementAssessmentReview`: 固定版本系统指令、八维/三个反事实测试/三类 allocation schema，以及一份冻结证据请求。不提供工具。五种 route 均为建议，不含总分。

#### Token effect

每次明确请求触发一次有界模型调用；无效输出不会通过追加调用修复。部署配置输入字节及输出 token，pending request id 不自动重试。

#### KV Cache effect

稳定 system 前缀可由 provider 缓存，每份证据独立，不改写会话历史。

## Known Limitations and Deferred Work

- 记录配置的 runtime route 和 settings；runtime 无可信证明时，实际后端模型身份明确为 unknown
- 失败预留需要明确新 request id；自动恢复可能造成重复计费
- Mock composition 测试证明 runtime 合同，不证明投资判断质量；三个真实模型验收案例仍需单独验证
- Deep Review、自动研究和 Outcome Learning 不属于 WP1

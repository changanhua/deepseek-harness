# 需求评估 Quick Review

[English](README.md) | 中文

通过现有 LLM runtime 运行 RIR-WP1 Quick Review。必须明确配置 `provider`、`model`、`dshBaseline`、`maxInputBytes`、`maxOutputBytes`、`maxOutputTokens`、`timeoutMs`。不能可靠识别 DSH 基线时使用 `unknown`。不创建第二套 agent loop。

## 权限与生命周期

`requirementAssessmentReview.review(access, input, signal, candidateSource)` 将可信 Host access 与严格用户输入分开。Planning subject 只读取一次 Planning；Candidate subject 必须通过独立可信 source 参数提供 owner 捕获的不可变 revision、与 digest 匹配的文本及证据。缺少 source 的原始 Candidate 输入在消耗前被拒绝。保留精确上下文、Focus 内容、证据与模型请求。用户证据始终为 unverified，不透明资源引用不会被抓取。

provider 在模型派发前持久预留请求，并在异步调用准备后重新检查 Host 授权。并发相同请求共享结果，完成后的重试恢复原结果。Candidate 请求摘要还绑定 actor kind 和 id，防止另一 actor 复用已预留 key。中断、拒绝或格式错误的尝试保留 reservation，避免重启后重复消耗；用户可显式使用新 request id。重新评估在消耗前验证被替代 subject。

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

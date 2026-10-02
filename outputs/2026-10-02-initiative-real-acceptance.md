# Initiative PR83 真实验收记录

2026-10-02 UTC。原始 PR83 head 为 `f4fb5aa16441ba7aac94b22770d74feb36240943`，RIR 输入源为 `1ecc97fc89bc4c968f4fdca0868e1d0ce06d5ff7`；本地整合提交为 `d297341fd5904285105b4e49760ab7c5066c91f8`。验收时存在未提交实现差异，不能把该整合提交单独当成被测实现。各轮 [证据](2026-10-02-initiative-real-acceptance-evidence/manifest.json) 保存当时 HEAD、差异摘要、相关源码摘要及六个实际加载构建入口的 SHA-256。

## 结果与证据

第三轮真实 SDK 进程验收通过。用户消息要求分析已观察到的 fresh-checkout import 失败及既有 `build:ts` 解决办法，没有要求创建 Candidate；已组合的产品指引允许主动提案。模型调用 `initiative_record`，成功回执的 Candidate id 与持久 owner、Session id 相符。来源频率和跨平台范围仍未知，Candidate 中保留既有方案、反证和不构建选项。

Human 通过真实 Commands 入口完成版本 2 调查并请求 RIR。现有 RIR runner 经 `deepseek-official/deepseek-flash` 发出无工具评估请求，严格 schema 验证后保存一个固定 Assessment。Candidate 版本 2、内容摘要、保存文本与 Assessment subject 相同；修订到版本 3 后关系为 drift。Human 明确选择版本 2 的旧 Assessment 晋升，持久 intent 与待审 Planning Proposal 保留其完整 baseline、Human rationale 和 baseline 摘要。

进程关闭后，外部控制器按各 owner 的实际 schema 独立读取 JSON 存储；仅有一个 pending Proposal，canonical items、handoffs 和 reviews 均为空。重启后用相同 operator、请求 key 和 payload 回放 assess/promote，回执不变，逻辑请求数与实际 HTTP 尝试数均保持 5。此独立读取与模型执行隔离，但控制器和实现由同一个 Codex 编写，不冒充独立作者审查。详见 [第三轮事件及 owner 证据](2026-10-02-initiative-real-acceptance-evidence/attempt-3.json)。

## 失败保留

- [第一轮](2026-10-02-initiative-real-acceptance-evidence/attempt-1.json)：4 次真实 HTTP 请求。模型使用小写状态、将证据引用数组写成字符串，被严格输入 schema 拒绝，继而触及旧的 4 次 Candidate 调用额度。没有有效 Candidate 验收结论。产品指引补全枚举与引用对象结构；较高自主授权下，后续 fixture 的单轮上限设为 8 次 Candidate 请求加 1 次评估。
- [第二轮](2026-10-02-initiative-real-acceptance-evidence/attempt-2.json)：4 次 Candidate 请求加 1 次 RIR 请求。主动 Candidate 成功，RIR 输出多余 `component2` 字段，被严格 schema 拒绝；未提交 Assessment 或晋升。没有放宽校验或自动修复输出，使用新隔离轮次重新请求。
- 第三轮：4 次 Candidate 请求加 1 次 RIR 请求，完整链路通过。RIR route 为 `EXPERIMENT`，仅建议最小实验，不授予执行权限。没有自动 accept Proposal、运行实验或派发 Delivery。

## 用量与限制

三轮累计 14 次逻辑请求、14 次实际 HTTP 尝试，adapter 报告未缓存输入 13,107 tokens、缓存输入 19,840 tokens、输出 10,901 tokens。把全部输入都按峰时未缓存 ¥2/百万 tokens、输出按 ¥8/百万 tokens 估算，约 ¥0.154；这是 [官方定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) 下的保守估算，不是已核实账单或货币硬上限。Codex 自身用量不在此数中。

HTTP body 在派发前检查 UTF-8 字节数、配置模型、输出 tokens 和 thinking disabled，失败请求也计入持久额度，禁止重定向；provider 重试配置为 0。实际后端模型身份缺少 adapter attestation，仍标记 unavailable。fresh 仅指 Candidate 内容匹配当前 head，不证明当前 DSH、能力、模型质量或引用真实性。未验收 GUI、自动冷启动、长期主动提案质量或 abrupt SIGKILL。

发布证据替换本机目录和用户目录，不包含请求 headers、凭据或完整 streaming 通知。原始请求正文、所有通知、失败、owner 文件和原始文件摘要保留在本机 Temp 的三个验收目录；公开摘要可核对原始文件，但公开脱敏内容不用于替代原始输入的字节摘要。

## 集中审查

Candidate review 的请求摘要绑定 actor kind/id，堵住 Assessment 已提交、Candidate receipt 尚未落盘时另一 actor 复用同 key 的窗口。源文本必须与固定 subject digest 匹配；派发前在异步 prepareCall 后重新授权，持久 owner 在提交时继续重新授权。查询校验 Assessment Workspace，关闭 provider 显示 unavailable；prepared promotion 恢复保留原 baseline。

聚焦测试覆盖上述授权、actor、摘要、foreign Workspace、missing/closed provider、回执丢失和 prepared promotion 恢复。最终交付的源码检查与 CI 状态单独记录，不将这份真实模型运行证据解释为所有仓库检查通过。

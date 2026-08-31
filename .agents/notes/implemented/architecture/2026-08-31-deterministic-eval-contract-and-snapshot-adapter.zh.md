# Agent Note: 确定性 Eval 约定与快照适配器

Status: implemented

[English](2026-08-31-deterministic-eval-contract-and-snapshot-adapter.md) | 中文

## 问题

DSH 已有录制会话的回放与快照基础设施，但没有包级词汇来比较 Provider/model/Preset 路由、保留未完成运行的不确定性，或生成一份稳定的机器报告和人类报告。否则，调用方可能把取消的运行当作模型失败、通过同一个 transcript 比较多个路由，或者让报告顺序跟随不确定的完成顺序。

现有的 [ACP 快照决策](../testing/2026-06-19-acp-snapshot-tests.zh.md)拥有录制、回放、fixture（测试前置数据）投影、应用启动和快照归一化。Eval 需要消费该机制，同时不能重复它，也不能把测试支持包变成产品服务。

## 决策

`@deepseek-ai/dsh-eval` 拥有严格的 `EvalSuite` 与 `EvalRun` schema、四种 `EvalOutcome` 值、确定性折叠、顺序套件执行和 JSON/Markdown 报告构造。它是带 invariant 配套插件的纯库，不发布 Cordis 服务、工具、Profile、持久化层或 evaluator 提示词。

每个套件固定 schema 版本、套件版本、源码 revision 与默认路由矩阵，然后至少比较两个显式 Provider/model/Preset 路由。每个 case 声明确定性 Workspace 准备、成功条件、允许的 evaluator，并为每个路由精确命名一个独立 `first-call-order` fixture。重复身份、未知字段、缺失 fixture 或跨路由共享 session 文件都是无效证据。

通用 runner 按路由再按 case 的顺序串行执行。这会保留 `llm-replay` 的首次调用顺序绑定，并让报告顺序不依赖进程完成顺序。具体执行器接收精确的路由、case、fixture、权限答案与 AbortSignal；它不能替换结果 `EvalRun` 中记录的 provenance。

结果按 `invalid` 高于 `infrastructure-uncertain`、高于 `failed`、高于 `passed` 的优先级折叠。空折叠、缺失结果、取消、Host/执行器异常或 Session 事实缺失不能成为模型失败或通过。模型 grader 记录独立 Provider/model/prompt 版本，且不能覆盖确定性失败。

`@deepseek-ai/dsh-eval-session-snapshot` 把通用 runner 适配到现有 ACP 快照 harness。它把 fixture 与 Workspace 路径限制在一个根目录下，在启动前验证 Provider/model provenance，转发 replay 输入，启动选定应用/Profile，并比较归一化持久化 session 日志。它还返回 Session/fixture 证据、持久 Provider usage 分桶与分离的 Agent/evaluator 延迟，同时让运行异常保持为基础设施不确定。

机器报告与 Markdown 报告使用套件路由/case 顺序，保留源码 revision、环境、可见 Tool/Skill 表面、Session 与 fixture provenance，统计四种结果，聚合成功率、失败样本以及拆分 Token/延迟指标，并合成显式不确定性而非丢弃缺失证据。

## 考虑过的替代方案

**使用模型 judge 或 embedding 分数。** 否决，因为第一道门禁必须无密钥、透明、确定且可回放。语义或事实 evaluator 以后可以消费相同的运行记录，而无需重新定义此结果词汇。

**把回放与快照机制放进 Eval 包。** 否决，因为快照子系统已经拥有录制、首次调用顺序回放、应用启动、归一化与清理。薄适配器会保留该 owner，并让 Eval 约定可被其他执行器使用。

**为每个被比较路由复用一个 transcript。** 否决，因为一个 fixture 无法证明路由 provenance，并会隐藏每种 Provider/model/Preset 组合的录制成本。适配器会拒绝所记录 Provider/model 与请求路由不同的 fixture。

**并发执行路由与 case。** 否决，因为回放按首次调用顺序把实时 session 绑定到录制脚本。在 replay 拥有更强的稳定绑定键以前，串行路由/case 执行是确定性基线。

**把 invalid 与基础设施不确定性折叠为 failure。** 否决，因为格式错误的证据和中断的 harness 都不能说明模型行为。保留两种分类可以防止虚假的回归结论和虚假的通过。

## 后果

每个被比较路由都有自己的录制 fixture 后，Eval 报告可以在无密钥环境中重复生成。增加路由会成倍增加录制与审查工作，复制或错误标注的 fixture 会在执行前失败。

包测试固定严格解析、fixture 覆盖、路由 provenance、结果优先级、取消、执行器异常、确定性顺序、报告格式、快照比较和真实 session-snapshot 子进程路径。仓库内 `minimal-v1` 套件包含十个 Case 与二十个独立路由 fixture；其无密钥报告字节稳定，并包含成功、任务失败、grader 失败和基础设施不确定样本。

该套件为两条路由都启动快照 harness 的脚本化 ACP agent。独立聚焦证据还通过 ACP 启动已发布 Loader/Profile，并 replay 一份 manifest 标记为真实 Provider 录制的 fixture，在无凭据条件下验证持久 Session usage 分桶。新的实时调用仍是显式凭据操作，而不是默认测试。

本记录保留包拓扑、证据分类与败选方案，因为未来 evaluator 与 runner 适配器必须保留它们。ACP 快照决策继续有效，未被取代或归档。

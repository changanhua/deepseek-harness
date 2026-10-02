# Agent Note: 可信 Eval 来源、Attempt 工作目录与资源预算

Status: implemented

[English](2026-10-02-trusted-eval-producers-and-resource-budgets.md) | 中文

## Problem

解析后的评测意图无法证明谁批准了预算豁免、哪个仓库 revision 实际存在，或是否还有资源支付下一次模型请求。这些事实属于不同 owner。将它们混进调用方 JSON 会允许自我认证；另造调度器或 Git 生命周期只会重复职责，而不会改善证据。

## Decision

项目 Plan 实现接受受信根目录下、由 Host 批准的完整内容身份。Workspace 访问使用存活 registry 对象和 Host 授权回调。发现结果不含路径。解析检查当前可用性与内容身份，准入随后重新验证 owner 签发的不可变解析对象，再提交幂等运行标识，不执行 subject、grader 或 verifier。

Eval 工作目录桥接取得 provider 签发的完整 revision，并使用真实 Queue Attempt id 打开现有 RepositoryWorkspace 租约。准备阶段从确切 commit 复制受限 fixture blob。确定且已静止的完成会移除检出；不确定性会保留检出并产生 Queue unknown Attention。独占准备标记拒绝在重启后复用不确定目录。本桥接既不拥有 Git 状态转换，也不替换 Queue。

Budget 拥有统一的版本化持久账本，保存作用域、预留、决策、实际用量和未知结果。父作用域约束子级。LLM 适配器最终派发边界覆盖直接请求和预备请求，并在调用前持久认领、重新检查存活状态。未知用量保留预留。存储失败会关闭准入；容量检查在调用开始前为终态证据预留空间。

交互式例外使用现有审批服务，并绑定单个 request/attempt 及其耗尽的 ask 作用域，不能越过拒绝的祖先或将未用额度转给后续请求。Session 和 Goal 身份来自存活 owner；Workflow 子任务共享运行作用域并保留 Session 绑定。人工命令可配置、撤销作用域及核对未知用量。自动 Activation 与独立评测决策仍是单独的调用方。

Storage Domain 在打开介质前检查声明的后端保证，真正执行持久 owner 已表达的要求，而非把声明当作证明。共享基础 profile 将 JSON 后端和 Domain 路由到投影缓存使用的相同 realm；可选私有账本增加命名后端路由。

## Alternatives considered

**信任解析后的 Plan 或受目录约束的项目文件。** 不采用，因为目录约束只确认位置，而 Host 批准确认完整的获准内容，包括凭据绑定和豁免。

**仅在 Agent 中间件或指定适配器执行预算。** 不采用，因为直接请求、预备请求和重试路径必须共享最终派发决策。最终检查由 LLM 运行时拥有，资源策略仍归预算 owner。

**释放不确定预留或重试中断的审批。** 不采用，因为缺失用量不是零用量，中断审批不是同意。持久不确定性需要核对或另一项明确获准的 attempt。

**替换 RepositoryWorkspace、Queue 容量或 Token Meter。** 不采用，因为检出所有权、调度容量和测量用量已有 owner。新调用方增加用户策略并连接证据，不重复这些机制。

## Consequences

Host 配置、owner 私有同步存储和作用域绑定是明确的部署要求。输入估算会标记，没有可信上界的图片请求会被拒绝，不可变作用域不能静默扩额，保留历史受配置容量限制。Tool 预检检查已注册契约，不声称实现字节认证。完整执行、验证器可信性、自动 Activation 和远程 Provider 记账不属于这些 producer。

[Eval 契约决策](2026-08-31-deterministic-eval-contract-and-snapshot-adapter.zh.md)和[后台任务决策](2026-06-20-generic-long-running-tool-runtime.zh.md)继续保持活动状态；其回放/证据及生命周期/容量职责没有被取代。本次改动不归档既有决策记录。[Eval 参考](../../../../docs/subsystems/eval.zh.md)、[Budget 参考](../../../../docs/subsystems/budget.zh.md)和[配置指南](../../../../docs/cookbook/trusted-eval-and-budget.zh.md)拥有当前使用细节。
